// X0b acceptance (docs/design/multi-platform.md §1-X0 / §6): the REAL entityClient
// runs its normal flow over the DIRECT adapter — zero express, zero supertest, zero
// fetch on that side — and the results field-compare against the SAME flow driven
// over the real HTTP app (supertest) in this file. One client, two backends, one
// contract: same bodies, same error statuses/messages (ApiError parity), and an
// unlisted path fails loudly instead of half-working.
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ApiError,
  configureVaultTransport,
  entityClient,
  resetVaultTransport,
  type VaultTransport
} from "../../client/data/entityClient";
import { fixtureHtmlBody } from "../../core/fixtures/golden";
import { type StudyVault } from "../../core/vault";
import { openTestVault } from "../../core/testing/openTestVault";
import { installServerKits } from "../../kits/server";
import { createApp } from "../app";
import { createSealedRuntime } from "../svpack";
import { createDirectTransport, DirectTransportUnsupportedError } from "./directTransport";

// Same bootstrap the server entry performs (idempotent): kit content specs must be
// registered so createNote validates kit contentTypes in the direct host too.
installServerKits();

// Pinned clock (memory envelopes) so both backends stamp identical timestamps.
const NOW = Date.UTC(2026, 6, 1, 12);
const EVENT_TS = "2026-07-01T08:00:00.000Z";

const QUOTE = "Render Thread submits rendering commands.";
const SELECTOR = '[data-study-id="p-render-thread"]';

// ULID-shaped entity ids are the only legitimate difference between the two vaults;
// normalize them away when comparing rendered markup byte-for-byte.
const normalizeIds = (html: string) => html.replace(/[a-z]+_[0-9A-HJKMNP-TV-Z]{26}/g, "<id>");

let tempDirs: string[] = [];
async function tmp(tag: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), `direct-transport-${tag}-`));
  tempDirs.push(dir);
  return dir;
}

let directVault: StudyVault;
let direct: VaultTransport;
let httpVault: StudyVault;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  // Direct side: entityClient over createDirectTransport — services called in-process.
  directVault = await openTestVault({ rootDir: await tmp("vault") });
  const sealed = createSealedRuntime({
    vault: directVault,
    identityDir: await tmp("id"),
    now: () => NOW
  });
  direct = createDirectTransport({ vault: directVault, sealed, now: () => NOW });
  configureVaultTransport(direct);

  // HTTP side: the SAME flow over the real express app, for field comparison.
  httpVault = await openTestVault({ rootDir: await tmp("http-vault") });
  app = createApp({ vault: httpVault, identityDir: await tmp("http-id"), now: () => NOW });
});

afterEach(async () => {
  resetVaultTransport();
  // STORE-SQL Stage-3: both vaults default to sqlite → release their `.db`/`-wal` handles BEFORE
  // rm (Windows can't unlink an open `.db`). Safe no-op under STORE_ENGINE=jsonl.
  directVault?.close();
  httpVault?.close();
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

describe("direct transport acceptance — entityClient with no HTTP", () => {
  it("runs ingest → anchor → note → list → memory through entityClient and matches the HTTP flow", async () => {
    // —— The flow over the DIRECT adapter, via entityClient's real methods ——
    const ingested = await entityClient.ingestHtml("Render Thread", fixtureHtmlBody);
    const source = ingested.source;
    const { anchor } = await entityClient.createAnchor({
      sourceId: source.id,
      studyId: "p-render-thread",
      selector: SELECTOR,
      quote: QUOTE
    });
    const { note } = await entityClient.createNote({
      sourceId: source.id,
      anchorIds: [anchor.id],
      contentType: "markdown",
      content: "A manual note."
    });
    const { notes } = await entityClient.notes(source.id);
    const { notes: byAnchor } = await entityClient.notesByAnchor(anchor.id);
    const { anchors } = await entityClient.anchors(source.id);
    const { layers } = await entityClient.layers(source.id);
    const rendered = await entityClient.rendered(source.id);
    await entityClient.postMemoryEvents([
      { verb: "note.create", subject: { sourceId: source.id, noteId: note.id }, sessionId: "s1", ts: EVENT_TS }
    ]);
    const events = await direct.request<{ events: Array<Record<string, unknown>>; total: number }>(
      "GET",
      "/api/memory/events"
    );
    const { settings } = await entityClient.memorySettings();

    // —— The SAME flow over HTTP (supertest), collected for comparison ——
    const httpIngested = (
      await request(app).post("/api/sources/html").send({ title: "Render Thread", content: fixtureHtmlBody }).expect(201)
    ).body;
    const httpSource = httpIngested.source;
    const httpAnchor = (
      await request(app)
        .post("/api/anchors")
        .send({ sourceId: httpSource.id, studyId: "p-render-thread", selector: SELECTOR, quote: QUOTE })
        .expect(201)
    ).body.anchor;
    const httpNote = (
      await request(app)
        .post("/api/notes")
        .send({ sourceId: httpSource.id, anchorIds: [httpAnchor.id], contentType: "markdown", content: "A manual note." })
        .expect(201)
    ).body.note;
    const httpNotes = (await request(app).get(`/api/sources/${httpSource.id}/notes`).expect(200)).body.notes;
    const httpByAnchor = (await request(app).get(`/api/notes?anchorId=${httpAnchor.id}`).expect(200)).body.notes;
    const httpAnchors = (await request(app).get(`/api/sources/${httpSource.id}/anchors`).expect(200)).body.anchors;
    const httpLayers = (await request(app).get(`/api/sources/${httpSource.id}/layers`).expect(200)).body.layers;
    const httpRendered = (await request(app).get(`/api/sources/${httpSource.id}/rendered`).expect(200)).body;
    await request(app)
      .post("/api/memory/events")
      .send({
        events: [{ verb: "note.create", subject: { sourceId: httpSource.id, noteId: httpNote.id }, sessionId: "s1", ts: EVENT_TS }]
      })
      .expect(201);
    const httpEvents = (await request(app).get("/api/memory/events").expect(200)).body;
    const httpSettings = (await request(app).get("/api/memory/settings").expect(200)).body.settings;

    // —— Field-compare the essentials (ids are per-vault; everything else must match) ——
    // Source: same title/type and the SAME contentHash (study-id injection is
    // deterministic, so both vaults stored byte-identical content).
    expect(source.title).toBe(httpSource.title);
    expect(source.sourceType).toBe(httpSource.sourceType);
    expect(source.contentHash).toBe(httpSource.contentHash);
    expect(ingested.injected).toEqual(httpIngested.injected);

    // Anchor: same kind/target/quote; stamped with each side's owned layer.
    expect(anchor.anchorKind).toBe("html_selection");
    expect(anchor.anchorKind).toBe(httpAnchor.anchorKind);
    expect(anchor.sourceId).toBe(source.id);
    if (anchor.anchorKind === "html_selection") {
      expect(anchor.studyId).toBe(httpAnchor.studyId);
      expect(anchor.selector).toBe(httpAnchor.selector);
    }
    expect(anchor.quote).toBe(httpAnchor.quote);
    expect((anchor as { layerId?: string }).layerId).toBeTruthy();
    expect(httpAnchor.layerId).toBeTruthy();

    // Note: same content/type, defaulted into exactly one (owned) layer on both sides.
    expect(note.contentType).toBe(httpNote.contentType);
    expect(note.content).toBe(httpNote.content);
    expect(note.anchorIds).toEqual([anchor.id]);
    expect(httpNote.anchorIds).toEqual([httpAnchor.id]);
    expect(note.layerIds).toHaveLength(1);
    expect(httpNote.layerIds).toHaveLength(1);

    // Lists see exactly the one note / painted anchor on both sides.
    expect(notes.map((entry) => entry.id)).toEqual([note.id]);
    expect(httpNotes.map((entry: { id: string }) => entry.id)).toEqual([httpNote.id]);
    expect(byAnchor.map((entry) => entry.id)).toEqual([note.id]);
    expect(httpByAnchor.map((entry: { id: string }) => entry.id)).toEqual([httpNote.id]);
    expect(anchors.map((entry) => entry.id)).toEqual([anchor.id]);
    expect(httpAnchors.map((entry: { id: string }) => entry.id)).toEqual([httpAnchor.id]);

    // Layers: same lazily-created set (owned + kit-seeded preset stages), same titles.
    expect(layers.map((layer) => layer.title).sort()).toEqual(
      httpLayers.map((layer: { title: string }) => layer.title).sort()
    );
    expect(layers.map((layer) => layer.role ?? "owned").sort()).toEqual(
      httpLayers.map((layer: { role?: string }) => layer.role ?? "owned").sort()
    );

    // Rendered read model: byte-identical markup once per-vault ids are normalized.
    expect(rendered.content).toContain(QUOTE);
    expect(normalizeIds(rendered.content)).toBe(normalizeIds(httpRendered.content));

    // Memory: the batch landed with identical envelopes (pinned ts) on both sides.
    expect(events.total).toBe(1);
    expect(httpEvents.total).toBe(1);
    expect(events.events[0].verb).toBe("note.create");
    expect(events.events[0].verb).toBe(httpEvents.events[0].verb);
    expect(events.events[0].createdAt).toBe(EVENT_TS);
    expect(events.events[0].createdAt).toBe(httpEvents.events[0].createdAt);
    expect(events.events[0].sessionId).toBe(httpEvents.events[0].sessionId);
    expect(String(events.events[0].id)).toMatch(/^mem_/);
    expect(settings).toEqual({ captureEnabled: true });
    expect(settings).toEqual(httpSettings);

    // Capture switch OFF: the direct POST resolves undefined (≙ HTTP 204 + drop) —
    // the same fire-and-forget contract the http side answers with 204.
    await entityClient.putMemorySettings({ captureEnabled: false });
    await expect(
      entityClient.postMemoryEvents([{ verb: "ai.ask", sessionId: "s1", ts: EVENT_TS }])
    ).resolves.toBeUndefined();
    expect((await direct.request<{ total: number }>("GET", "/api/memory/events")).total).toBe(1);
    await request(app).put("/api/memory/settings").send({ captureEnabled: false }).expect(200);
    await request(app)
      .post("/api/memory/events")
      .send({ events: [{ verb: "ai.ask", sessionId: "s1", ts: EVENT_TS }] })
      .expect(204);
    expect((await request(app).get("/api/memory/events").expect(200)).body.total).toBe(1);

    // Mutations round out the subset: patch a layer, delete the note, delete the source.
    const owned = layers.find((layer) => layer.importMode === "owned" && layer.role === undefined);
    const { layer: patched } = await entityClient.patchLayer(owned!.id, { enabled: false });
    expect(patched.enabled).toBe(false);
    expect((await entityClient.notes(source.id)).notes).toEqual([]); // lens filter applies
    await entityClient.patchLayer(owned!.id, { enabled: true });
    // D3a: a STYLE-ONLY patch round-trips (must not 400 on the refine guard) and persists.
    const { layer: styled } = await entityClient.patchLayer(owned!.id, {
      style: { color: "#ff0000", decoration: "underline" }
    });
    expect(styled.style).toEqual({ color: "#ff0000", decoration: "underline" });
    await expect(entityClient.deleteNote(note.id)).resolves.toEqual({ ok: true });
    await expect(entityClient.deleteSource(source.id)).resolves.toEqual({ ok: true });
    expect((await entityClient.sources()).sources).toEqual([]);
  });

  it("serves the W2 attachment bundle (excerpt + notes) with HTTP parity", async () => {
    // Direct side: ingest a source + a note, then read the bundle over the direct adapter.
    const { source } = await entityClient.ingestHtml("Bundle Doc", fixtureHtmlBody);
    await entityClient.createNote({ sourceId: source.id, contentType: "markdown", content: "bundle note" });
    const direct1 = await direct.request<{ bundle: { title: string; type: string; excerpt?: string; notes: unknown[] } }>(
      "GET",
      `/api/sources/${source.id}/bundle`
    );

    // HTTP side: the SAME flow over the real app.
    const httpSource = (
      await request(app).post("/api/sources/html").send({ title: "Bundle Doc", content: fixtureHtmlBody }).expect(201)
    ).body.source;
    await request(app)
      .post("/api/notes")
      .send({ sourceId: httpSource.id, contentType: "markdown", content: "bundle note" })
      .expect(201);
    const http1 = (await request(app).get(`/api/sources/${httpSource.id}/bundle`).expect(200)).body;

    // Same title/type/notes; excerpt is deterministic (study-id injection is stable).
    expect(direct1.bundle.title).toBe("Bundle Doc");
    expect(direct1.bundle.title).toBe(http1.bundle.title);
    expect(direct1.bundle.type).toBe(http1.bundle.type);
    expect(direct1.bundle.notes).toEqual([{ contentType: "markdown", text: "bundle note" }]);
    expect(direct1.bundle.notes).toEqual(http1.bundle.notes);
    expect(direct1.bundle.excerpt).toBe(http1.bundle.excerpt);

    // ?includeNotes=false drops the notes on both backends.
    const directNoNotes = await direct.request<{ bundle: { notes: unknown[] } }>(
      "GET",
      `/api/sources/${source.id}/bundle?includeNotes=false`
    );
    const httpNoNotes = (await request(app).get(`/api/sources/${httpSource.id}/bundle?includeNotes=false`).expect(200)).body;
    expect(directNoNotes.bundle.notes).toEqual([]);
    expect(httpNoNotes.bundle.notes).toEqual([]);
  });

  it("runs the MEM-2 tier flow (consolidate → digests → profile → overrides → clear) with HTTP parity", async () => {
    // Same seed on both sides: an OLD event (freezes+prunes at the pinned 14d
    // boundary, 2026-06-17) + three graded failures that derive a 弱项 fact.
    const seed = [
      { verb: "open" as const, subject: { contentType: "markdown" }, ts: "2026-06-10T08:00:00.000Z", sessionId: "s1" },
      { verb: "note.review" as const, subject: { contentType: "quiz" }, payload: { result: "fail" }, ts: "2026-06-20T08:00:00.000Z", sessionId: "s1" },
      { verb: "note.review" as const, subject: { contentType: "quiz" }, payload: { result: "fail" }, ts: "2026-06-20T09:00:00.000Z", sessionId: "s1" },
      { verb: "note.review" as const, subject: { contentType: "quiz" }, payload: { result: "fail" }, ts: "2026-06-21T09:00:00.000Z", sessionId: "s1" }
    ];
    const overrides = { facts: [{ key: "weak:contentType:quiz", pinned: true, note: "统一更正" }] };

    // —— Direct side, through entityClient's real bindings ——
    await entityClient.postMemoryEvents(seed);
    const consolidated = (await entityClient.consolidateMemory()).consolidated;
    const digests = await entityClient.memoryDigests();
    const filtered = await entityClient.memoryDigests("contentType");
    await entityClient.putMemoryProfile(overrides);
    const profile = await entityClient.memoryProfile();

    // —— The SAME flow over HTTP ——
    await request(app).post("/api/memory/events").send({ events: seed }).expect(201);
    const httpConsolidated = (await request(app).post("/api/memory/consolidate").expect(200)).body.consolidated;
    const httpDigests = (await request(app).get("/api/memory/digests").expect(200)).body;
    const httpFiltered = (await request(app).get("/api/memory/digests?dimension=contentType").expect(200)).body;
    await request(app).put("/api/memory/profile").send(overrides).expect(200);
    const httpProfile = (await request(app).get("/api/memory/profile").expect(200)).body;

    // Pinned clock + no per-vault ids in this seed ⇒ byte-identical bodies.
    expect(consolidated).toEqual(httpConsolidated);
    expect(consolidated.prunedEvents).toBe(1);
    expect(JSON.stringify(digests)).toBe(JSON.stringify(httpDigests));
    expect(JSON.stringify(filtered)).toBe(JSON.stringify(httpFiltered));
    expect(filtered.digests.every((row) => row.dimension === "contentType")).toBe(true);
    expect(JSON.stringify(profile)).toBe(JSON.stringify(httpProfile));
    expect(profile.facts[0]).toMatchObject({ key: "weak:contentType:quiz", pinned: true, note: "统一更正" });
    expect(profile.digestMeta.retention).toEqual({ rawEventDays: 14, digestDays: 365 });

    // Invalid override document → the SAME 400 ("Invalid request") both sides.
    const badPut = await direct
      .request("PUT", "/api/memory/profile", { facts: [{ key: "" }] })
      .catch((err: unknown) => err);
    expect(badPut).toBeInstanceOf(ApiError);
    expect((badPut as ApiError).status).toBe(400);
    const httpBadPut = (
      await request(app).put("/api/memory/profile").send({ facts: [{ key: "" }] }).expect(400)
    ).body;
    expect((badPut as ApiError).message).toBe(httpBadPut.error);

    // Clear-all parity: every tier wiped on both sides.
    const cleared = await entityClient.clearMemory();
    const httpCleared = (await request(app).delete("/api/memory").expect(200)).body;
    expect(cleared).toEqual(httpCleared);
    expect(cleared.cleared).toEqual({ events: 3, digests: true, overrides: true });
    expect((await entityClient.memoryProfile()).facts).toEqual([]);
    expect((await request(app).get("/api/memory/profile").expect(200)).body.facts).toEqual([]);
  });

  it("runs the REV-3 review-schedule flow (read → grade → advance → skip echo) with HTTP parity", async () => {
    const AT = "2026-07-01T08:00:00.000Z";
    // Legacy vault law on both sides: no file ⇒ {}.
    expect((await entityClient.reviewSchedule()).schedule).toEqual({});
    expect((await request(app).get("/api/review/schedule").expect(200)).body.schedule).toEqual({});

    // First grade materializes the row; pinned `at` ⇒ byte-identical bodies.
    const graded = await entityClient.recordReviewGrade({ noteId: "n1", result: "pass", at: AT });
    const httpGraded = (
      await request(app).post("/api/review/grade").send({ noteId: "n1", result: "pass", at: AT }).expect(200)
    ).body;
    expect(graded).toEqual(httpGraded);
    expect(graded.schedule).toMatchObject({ intervalDays: 1, streak: 1, lastResult: "pass" });

    // Read-back parity + skip echoes the current row without advancing it.
    const readBack = (await entityClient.reviewSchedule()).schedule;
    expect(JSON.stringify(readBack)).toBe(
      JSON.stringify((await request(app).get("/api/review/schedule").expect(200)).body.schedule)
    );
    const skipped = await entityClient.recordReviewGrade({ noteId: "n1", result: "skip", at: AT });
    expect(skipped.schedule).toEqual(graded.schedule);

    // Malformed grade → the SAME 400 ("Invalid request") both sides.
    const bad = await entityClient
      .recordReviewGrade({ noteId: "n1", result: "good" as never })
      .catch((err: unknown) => err);
    expect(bad).toBeInstanceOf(ApiError);
    expect((bad as ApiError).status).toBe(400);
    const httpBad = (
      await request(app).post("/api/review/grade").send({ noteId: "n1", result: "good" }).expect(400)
    ).body;
    expect((bad as ApiError).message).toBe(httpBad.error);
  });

  it("lists PRO-1 triggers with HTTP parity (empty vault ⇒ [], seeded ⇒ same body)", async () => {
    // Fresh vaults on both sides ⇒ no trigger definitions ⇒ [].
    expect((await entityClient.triggers()).triggers).toEqual([]);
    expect((await request(app).get("/api/triggers").expect(200)).body.triggers).toEqual([]);

    // Seed the SAME definition into both stores directly (no user-authoring route in
    // PRO-1) and compare the list bodies byte-for-byte.
    const seed = {
      id: "trigger_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      type: "trigger" as const,
      schemaVersion: 1 as const,
      createdAt: "2026-07-01T08:00:00.000Z",
      updatedAt: "2026-07-01T08:00:00.000Z",
      createdBy: "system" as const,
      name: "复习推动",
      description: "",
      enabled: true,
      when: { kind: "schedule" as const, atLocalTime: "19:00" },
      actionRef: { kind: "navigate" as const, target: "review.panel" },
      reason: "该复习了",
      constraints: { dailyCap: 2, quietHours: { start: "22:00", end: "08:00" }, minGapMinutes: 180, onlyWhenIdle: true },
      metadata: {}
    };
    await directVault.stores.triggers.upsert(seed);
    await httpVault.stores.triggers.upsert(seed);
    const direct = (await entityClient.triggers()).triggers;
    const http = (await request(app).get("/api/triggers").expect(200)).body.triggers;
    expect(JSON.stringify(direct)).toBe(JSON.stringify(http));
    expect(direct[0].when).toEqual({ kind: "schedule", atLocalTime: "19:00" });
  });

  it("records + reads trigger FIRE STATE (fire/snooze/dismiss) with HTTP parity", async () => {
    const ID = "trigger_01ARZ3NDEKTSV4RRFFQ69G5FAV";
    // Absent ⇒ {} both sides.
    expect((await entityClient.triggerFires()).fires).toEqual({});
    expect((await request(app).get("/api/triggers/fires").expect(200)).body.fires).toEqual({});

    // A surfaced fire records lastFiredAt + the per-day count identically both sides.
    const fired = await entityClient.recordTriggerFire(ID, { localDayKey: "2026-07-05", firedAt: 1000 });
    const httpFired = (
      await request(app).post(`/api/triggers/${ID}/fire`).send({ localDayKey: "2026-07-05", firedAt: 1000 }).expect(200)
    ).body;
    expect(fired.state).toEqual(httpFired.state);
    expect(fired.state).toMatchObject({ lastFiredAt: 1000, firedByDay: { "2026-07-05": 1 } });

    // Snooze + read-back parity.
    const snoozed = await entityClient.snoozeTrigger(ID, 999_000);
    const httpSnoozed = (await request(app).post(`/api/triggers/${ID}/snooze`).send({ snoozedUntil: 999_000 }).expect(200)).body;
    expect(snoozed.state.snoozedUntil).toBe(999_000);
    expect(JSON.stringify(snoozed.state)).toBe(JSON.stringify(httpSnoozed.state));

    // Dismiss lifts the snooze both sides.
    expect((await entityClient.dismissTrigger(ID)).state.snoozedUntil).toBeUndefined();
    expect((await request(app).post(`/api/triggers/${ID}/dismiss`).send({}).expect(200)).body.state.snoozedUntil).toBeUndefined();
  });

  it("maps typed service failures to the SAME ApiError(status/message) http produces", async () => {
    // NotFound: identical status AND message, and the client-facing class is ApiError
    // exactly as if the http transport had parsed a 404 response.
    const directError = await entityClient.deleteNote("note_missing").catch((err: unknown) => err);
    expect(directError).toBeInstanceOf(ApiError);
    expect((directError as ApiError).status).toBe(404);
    const httpBody = (await request(app).delete("/api/notes/note_missing").expect(404)).body;
    expect((directError as ApiError).message).toBe(httpBody.error); // "Note not found"

    // Domain validation (typed ValidationError → 400, same message as the http body).
    const badType = await entityClient
      .createNote({ contentType: "not-a-registered-type", content: "x" })
      .catch((err: unknown) => err);
    expect(badType).toBeInstanceOf(ApiError);
    expect((badType as ApiError).status).toBe(400);
    const httpBadType = (
      await request(app).post("/api/notes").send({ contentType: "not-a-registered-type", content: "x" }).expect(400)
    ).body;
    expect((badType as ApiError).message).toBe(httpBadType.error);

    // Zod shape failure → the error-middleware body ("Invalid request") on both sides.
    const badShape = await entityClient
      .createAnchor({ sourceId: "src_missing" }) // no quote, no rect → schema refine fails
      .catch((err: unknown) => err);
    expect(badShape).toBeInstanceOf(ApiError);
    expect((badShape as ApiError).status).toBe(400);
    const httpBadShape = (
      await request(app).post("/api/anchors").send({ sourceId: "src_missing" }).expect(400)
    ).body;
    expect((badShape as ApiError).message).toBe(httpBadShape.error); // "Invalid request"
  });

  it("refuses paths outside the documented subset, naming them", async () => {
    const error = await direct
      .request("POST", "/api/chat", { messages: [{ role: "user", content: "hi" }] })
      .catch((err: unknown) => err);
    expect(error).toBeInstanceOf(DirectTransportUnsupportedError);
    expect(error).not.toBeInstanceOf(ApiError); // loud, not a fake status code
    expect((error as Error).message).toContain("POST /api/chat");

    // A known path with an unrouted METHOD is refused the same way.
    await expect(direct.request("PUT", "/api/notes")).rejects.toBeInstanceOf(DirectTransportUnsupportedError);
    // The HTTP-only streams are explicitly out (SSE chat / binary assets).
    await expect(direct.request("GET", "/api/assets/asset_x")).rejects.toThrow("GET /api/assets/asset_x");
  });

  // —— PLAT-LAYER Part-3 COVERAGE GUARD ——————————————————————————————————————————
  // The permanent regression guard: EVERY path entityClient can call is either
  // ROUTED by directTransport (a call reaches a handler — it may 4xx, but it never
  // throws DirectTransportUnsupportedError) OR classified UNROUTED (a call MUST throw
  // DirectTransportUnsupportedError — desktop-only / HTTP-only, loud not silent). A new
  // entityClient method that forgets its transport row lands in neither list and this
  // test fails, forcing the decision. Keep in sync with entityClient.ts's call sites.

  // ROUTED: method + a representative path (params are dummies — a 404/400 is fine,
  // we only assert the call is NOT refused as unsupported).
  const ROUTED: Array<[string, string]> = [
    ["GET", "/api/sources"],
    ["POST", "/api/sources/html"],
    ["DELETE", "/api/sources/src_x"],
    ["PATCH", "/api/sources/src_x"],
    ["GET", "/api/sources/src_x/rendered"],
    ["GET", "/api/sources/src_x/bundle"],
    ["POST", "/api/sources/authored"],
    ["PATCH", "/api/sources/src_x/content"],
    ["GET", "/api/sources/src_x/share-status"],
    ["POST", "/api/sources/src_x/fork"],
    ["GET", "/api/sources/src_x/anchors"],
    ["POST", "/api/anchors"],
    ["GET", "/api/sources/src_x/notes"],
    ["GET", "/api/notes"],
    ["POST", "/api/notes"],
    ["PATCH", "/api/notes/note_x"],
    ["DELETE", "/api/notes/note_x"],
    ["GET", "/api/sources/src_x/patches"],
    ["POST", "/api/patches"],
    ["PATCH", "/api/patches/patch_x"],
    ["GET", "/api/concepts"],
    ["POST", "/api/concepts"],
    ["GET", "/api/concepts/concept_x"],
    ["DELETE", "/api/concepts/concept_x"],
    ["POST", "/api/concepts/concept_x/merge"],
    ["GET", "/api/relations"],
    ["POST", "/api/relations"],
    ["DELETE", "/api/relations/relation_x"],
    ["GET", "/api/graph"],
    ["GET", "/api/operations"],
    ["POST", "/api/operations"],
    ["GET", "/api/operations/operation_x"],
    ["PATCH", "/api/operations/operation_x"],
    ["DELETE", "/api/operations/operation_x"],
    ["GET", "/api/operation-prefs"],
    ["PUT", "/api/operation-prefs"],
    ["GET", "/api/triggers"],
    ["GET", "/api/triggers/fires"],
    ["POST", "/api/triggers/trigger_x/fire"],
    ["POST", "/api/triggers/trigger_x/snooze"],
    ["POST", "/api/triggers/trigger_x/dismiss"],
    ["GET", "/api/plugin-prefs"],
    ["PUT", "/api/plugin-prefs"],
    ["PUT", "/api/plugin-prefs/catalog"],
    ["GET", "/api/sources/src_x/layers"],
    ["PATCH", "/api/layers/layer_x"],
    ["POST", "/api/sources/src_x/layers"],
    ["DELETE", "/api/layers/layer_x"],
    ["POST", "/api/layers/layer_x/export"],
    ["POST", "/api/layers/import/preview"],
    ["POST", "/api/layers/import/commit"],
    ["GET", "/api/svpack"],
    ["DELETE", "/api/svpack/pack_x"],
    ["POST", "/api/assets"],
    ["GET", "/api/assets/asset_x/meta"],
    ["POST", "/api/memory/events"],
    ["GET", "/api/memory/settings"],
    ["PUT", "/api/memory/settings"],
    ["GET", "/api/memory/events"],
    ["POST", "/api/memory/consolidate"],
    ["GET", "/api/memory/digests"],
    ["GET", "/api/memory/profile"],
    ["PUT", "/api/memory/profile"],
    ["DELETE", "/api/memory"],
    ["GET", "/api/review/schedule"],
    ["POST", "/api/review/grade"],
    ["GET", "/api/workspace"],
    ["PUT", "/api/workspace"],
    ["GET", "/api/workspace/onboarding"],
    ["PUT", "/api/workspace/onboarding"],
    ["GET", "/api/workspace/ui-prefs"],
    ["PUT", "/api/workspace/ui-prefs"],
    ["GET", "/api/about"],
    ["GET", "/api/vault"]
  ];

  // UNROUTED (must throw DirectTransportUnsupportedError): desktop-only ingestion (need
  // server-side file/network/unzip), the HTTP-only AI/stream/byte lanes, and the svpack
  // crypto family (need identityDir + device-key/ledger internals not on the direct host).
  const UNROUTED: Array<[string, string]> = [
    // Ingestion (B4 — the 4 the v1 dropped): URL-fetch / live web / local-file / .xmind unzip.
    // Mobile parity: get a direct-core impl (URL-fetch + unzip shims) when the mobile track
    // needs in-app import — tracked, not silently missing.
    ["POST", "/api/sources/url"],
    ["POST", "/api/sources/web-live"],
    ["POST", "/api/sources/local-file"],
    ["POST", "/api/notes/import-xmind"],
    // Asset local-file import (native path) + raw asset BYTE stream (Range/streaming).
    ["POST", "/api/assets/local-file"],
    ["GET", "/api/assets/asset_x"],
    // AI lanes are HTTP-only by design (the direct host carries no provider — DELTA 2).
    ["POST", "/api/chat"],
    ["POST", "/api/chat/synthesize"],
    ["POST", "/api/chat/stream"],
    ["POST", "/api/agent/stream"],
    ["POST", "/api/kits/generate"],
    ["POST", "/api/notes/generate-block"],
    ["POST", "/api/notes/classify"],
    // svpack crypto family — need identityDir + the device-key/ledger surface (a future
    // extraction when the mobile track needs in-app publish/import of protected packs).
    ["POST", "/api/layers/layer_x/export-svpack"],
    ["POST", "/api/svpack/inspect"],
    ["POST", "/api/svpack/open"],
    ["POST", "/api/svpack/commit"],
    ["GET", "/api/svpack/identity"],
    // AI provider config + managed gateway (A3b/G-A3b) — HTTP-only (key store, env,
    // network gateway origin) with no direct-host equivalent.
    ["GET", "/api/ai/providers"],
    ["PUT", "/api/ai/providers/config"],
    ["PUT", "/api/ai/providers/active"],
    ["PUT", "/api/ai/providers/prov_x/key"],
    ["DELETE", "/api/ai/providers/prov_x/key"],
    ["POST", "/api/ai/providers/prov_x/test"],
    ["GET", "/api/ai/providers/prov_x/detect"],
    ["POST", "/api/ai/providers/prov_x/managed/request-code"],
    ["POST", "/api/ai/providers/prov_x/managed/verify"],
    ["GET", "/api/ai/providers/prov_x/managed/balance"],
    ["POST", "/api/ai/providers/prov_x/managed/topup"],
    ["POST", "/api/ai/providers/prov_x/managed/logout"]
  ];

  it("COVERAGE GUARD: every entityClient path is either routed or throws Unsupported", async () => {
    // A path is UNSUPPORTED iff the error is a DirectTransportUnsupportedError. A routed
    // handler may still reject (404/400 ApiError) — that is coverage, not a gap.
    const asUnsupported = async (method: string, path: string): Promise<boolean> => {
      try {
        await direct.request(method, path, {});
        return false; // resolved ⇒ routed
      } catch (err) {
        return err instanceof DirectTransportUnsupportedError;
      }
    };

    const wronglyUnsupported: string[] = [];
    for (const [method, path] of ROUTED) {
      if (await asUnsupported(method, path)) wronglyUnsupported.push(`${method} ${path}`);
    }
    const wronglyRouted: string[] = [];
    for (const [method, path] of UNROUTED) {
      if (!(await asUnsupported(method, path))) wronglyRouted.push(`${method} ${path}`);
    }

    // Loud lists (the worklist), so a failure names exactly what's mis-classified.
    expect({ wronglyUnsupported, wronglyRouted }).toEqual({ wronglyUnsupported: [], wronglyRouted: [] });
  });

  it("COVERAGE GUARD is DRIFT-PROOF: every /api path literal in entityClient.ts is classified", () => {
    // The two arrays above are hand-maintained; on their own a NEW entityClient path added without a
    // guard row would land in neither and pass silently. Source-DERIVE the universe so that can't happen:
    // read entityClient.ts, extract every "/api/…" path literal it can reach, canonicalize the param
    // segments (entityClient's `${id}` and the guard's `_x`/`:name` dummies → a uniform `:x`), and assert
    // every one is a known routed-or-unrouted DECISION. A future path with no guard row fails RIGHT HERE.
    const canon = (p: string): string =>
      p
        .replace(/\?.*$/, "")
        .split("/")
        .map((seg) =>
          // A WHOLE-segment param (entityClient `${id}` / a `:name` / the guard's `_x` dummy) → `:x`;
          // a literal segment with a trailing `${…}` query-string suffix (NOT a path param, e.g.
          // `bundle${query}`, or `graph${qs ? …}` which the path regex truncates at the ternary `?`)
          // → drop everything from the first `${` on, keep the literal prefix.
          /^(\$\{[^}]*\}|:\w+|\w+_x)$/.test(seg) ? ":x" : seg.replace(/\$\{.*$/, "")
        )
        .join("/");
    const classified = new Set([...ROUTED, ...UNROUTED].map(([, p]) => canon(p)));
    const src = readFileSync(path.resolve("src/client/data/entityClient.ts"), "utf8");
    const found = new Set<string>();
    for (const m of src.matchAll(/['"`](\/api\/[^'"`?\s]*)/g)) found.add(canon(m[1]));
    const unclassified = [...found].filter((p) => !classified.has(p)).sort();
    expect(unclassified).toEqual([]);
  });

  it("PARITY: the newly-routed Part-3 endpoints match their app.ts Express siblings", async () => {
    // Seed one source on each side so the source-scoped routes have real targets.
    const { source } = await entityClient.ingestHtml("Parity Doc", fixtureHtmlBody);
    const httpSource = (
      await request(app).post("/api/sources/html").send({ title: "Parity Doc", content: fixtureHtmlBody }).expect(201)
    ).body.source;

    // —— PATCH /api/sources/:id (updateSourceMetadata — the setActiveKit path) ——
    const directMeta = await entityClient.updateSourceMetadata(source.id, { activeKitIds: ["textbook"] });
    const httpMeta = (
      await request(app).patch(`/api/sources/${httpSource.id}`).send({ metadata: { activeKitIds: ["textbook"] } }).expect(200)
    ).body;
    expect(directMeta.source.metadata).toEqual({ activeKitIds: ["textbook"] });
    expect(directMeta.source.metadata).toEqual(httpMeta.source.metadata);

    // —— Concepts: create → detail → merge ——
    const { concept: a } = await entityClient.createConcept({ name: "Alpha", aliases: ["A"] });
    const { concept: b } = await entityClient.createConcept({ name: "Beta" });
    const httpA = (await request(app).post("/api/concepts").send({ name: "Alpha", aliases: ["A"] }).expect(201)).body.concept;
    const httpB = (await request(app).post("/api/concepts").send({ name: "Beta" }).expect(201)).body.concept;
    expect(a.name).toBe(httpA.name);
    expect(a.aliases).toEqual(httpA.aliases);

    const detail = await entityClient.conceptDetail(a.id);
    const httpDetail = (await request(app).get(`/api/concepts/${httpA.id}`).expect(200)).body;
    expect(detail.concept.name).toBe(httpDetail.concept.name);
    expect(detail.notes).toEqual(httpDetail.notes);

    const merged = await entityClient.mergeConcept(b.id, a.id);
    const httpMerged = (await request(app).post(`/api/concepts/${httpB.id}/merge`).send({ targetConceptId: httpA.id }).expect(200)).body;
    expect(merged.mergedFrom).toBe(b.id);
    expect(merged.concept.name).toBe(httpMerged.concept.name);

    // list concepts parity (one concept left after the merge on both sides)
    expect((await entityClient.concepts()).concepts.map((c) => c.name).sort()).toEqual(
      (await request(app).get("/api/concepts").expect(200)).body.concepts.map((c: { name: string }) => c.name).sort()
    );

    // Delete-concept body shape parity.
    const del = await entityClient.deleteConcept(a.id);
    const httpDel = (await request(app).delete(`/api/concepts/${httpA.id}`).expect(200)).body;
    expect(del).toMatchObject({ ok: true, deletedConceptId: a.id });
    expect({ ...del, deletedConceptId: "<id>" }).toEqual({ ...httpDel, deletedConceptId: "<id>" });

    // —— Relations: create → list → delete (+ 404 parity) ——
    const { concept: c1 } = await entityClient.createConcept({ name: "C1" });
    const { concept: c2 } = await entityClient.createConcept({ name: "C2" });
    const { relation } = await entityClient.createRelation({
      from: { type: "concept", id: c1.id },
      to: { type: "concept", id: c2.id },
      relationKind: "related"
    });
    expect(relation.relationKind).toBe("related");
    expect((await entityClient.relations()).relations.map((r) => r.id)).toEqual([relation.id]);
    await expect(entityClient.deleteRelation(relation.id)).resolves.toEqual({ ok: true });
    const missingRel = await entityClient.deleteRelation("relation_missing").catch((e: unknown) => e);
    const httpMissingRel = (await request(app).delete("/api/relations/relation_missing").expect(404)).body;
    expect((missingRel as ApiError).status).toBe(404);
    expect((missingRel as ApiError).message).toBe(httpMissingRel.error);

    // —— Operations: create → get → patch → list → delete ——
    const { operation } = await entityClient.createOperation({
      name: "Summarize",
      mode: "simple",
      instruction: "Summarize the passage"
    });
    const httpOp = (
      await request(app).post("/api/operations").send({ name: "Summarize", mode: "simple", instruction: "Summarize the passage" }).expect(201)
    ).body.operation;
    expect(operation.name).toBe(httpOp.name);
    expect(operation.mode).toBe(httpOp.mode);
    const gotOp = (await direct.request<{ operation: { name: string } }>("GET", `/api/operations/${operation.id}`)).operation;
    expect(gotOp.name).toBe("Summarize");
    const { operation: patchedOp } = await entityClient.updateOperation(operation.id, { name: "Summarize v2" });
    expect(patchedOp.name).toBe("Summarize v2");
    expect((await entityClient.operations()).operations.map((o) => o.name)).toEqual(["Summarize v2"]);
    await expect(entityClient.deleteOperation(operation.id)).resolves.toEqual({ ok: true });
    await expect(direct.request("GET", `/api/operations/${operation.id}`)).rejects.toBeInstanceOf(ApiError);

    // —— Operation prefs GET/PUT ——
    const prefs = { order: ["op_a"], disabled: ["op_b"], params: {} };
    const savedPrefs = await entityClient.saveOperationPrefs(prefs);
    const httpSavedPrefs = (await request(app).put("/api/operation-prefs").send(prefs).expect(200)).body;
    expect(savedPrefs.prefs.order).toEqual(["op_a"]);
    expect(JSON.stringify(savedPrefs)).toBe(JSON.stringify(httpSavedPrefs));
    expect(JSON.stringify((await entityClient.operationPrefs()))).toBe(
      JSON.stringify((await request(app).get("/api/operation-prefs").expect(200)).body)
    );

    // —— Plugin prefs GET/PUT + catalog ——
    const pluginPrefs = {
      disabledContributions: ["plugin.x/contribution"],
      viewerAssociations: { byContentType: {}, byNoteId: {} },
      userKits: []
    };
    const savedPlugin = await entityClient.putPluginPrefs(pluginPrefs);
    const httpSavedPlugin = (await request(app).put("/api/plugin-prefs").send(pluginPrefs).expect(200)).body;
    expect(savedPlugin.prefs.disabledContributions).toEqual(["plugin.x/contribution"]);
    expect(JSON.stringify(savedPlugin)).toBe(JSON.stringify(httpSavedPlugin));
    const catalog = { catalogState: { installedPlugins: ["plugin.x"], installedKits: null } };
    const savedCatalog = await entityClient.putPluginCatalog(catalog);
    const httpSavedCatalog = (await request(app).put("/api/plugin-prefs/catalog").send(catalog).expect(200)).body;
    expect(JSON.stringify(savedCatalog)).toBe(JSON.stringify(httpSavedCatalog));
    expect(JSON.stringify((await entityClient.pluginPrefs()))).toBe(
      JSON.stringify((await request(app).get("/api/plugin-prefs").expect(200)).body)
    );

    // —— Workspace GET/PUT + onboarding + ui-prefs ——
    const ws = { activeLayoutId: "main", layouts: [{ id: "main", name: "Main", mode: "dock" as const, nodes: [], layout: {} }] };
    const savedWs = await entityClient.saveWorkspace(ws);
    const httpSavedWs = (await request(app).put("/api/workspace").send(ws).expect(200)).body;
    expect(savedWs.workspace.activeLayoutId).toBe("main");
    expect(JSON.stringify(savedWs)).toBe(JSON.stringify(httpSavedWs));
    expect(JSON.stringify((await entityClient.workspace()))).toBe(
      JSON.stringify((await request(app).get("/api/workspace").expect(200)).body)
    );
    const onboarding = { dismissed: true, completedAt: null, doneSteps: ["seed"], sampleSourceId: null };
    expect(JSON.stringify(await entityClient.putOnboardingState(onboarding))).toBe(
      JSON.stringify((await request(app).put("/api/workspace/onboarding").send(onboarding).expect(200)).body)
    );
    expect(JSON.stringify(await entityClient.putUiPrefs({ locale: "en" }))).toBe(
      JSON.stringify((await request(app).put("/api/workspace/ui-prefs").send({ locale: "en" }).expect(200)).body)
    );

    // —— Layers: create custom → export → delete ——
    const { layer: customLayer } = await entityClient.createLayer(source.id, { title: "My Layer" });
    const httpCustomLayer = (
      await request(app).post(`/api/sources/${httpSource.id}/layers`).send({ title: "My Layer" }).expect(201)
    ).body.layer;
    expect(customLayer.title).toBe("My Layer");
    expect(customLayer.role).toBe(httpCustomLayer.role);
    const exported = await entityClient.exportLayer(customLayer.id);
    const httpExported = (await request(app).post(`/api/layers/${httpCustomLayer.id}/export`).send({}).expect(200)).body;
    expect(exported.pack.layer.title).toBe("My Layer");
    expect(exported.pack.layer.title).toBe(httpExported.pack.layer.title);
    await expect(entityClient.deleteLayer(customLayer.id)).resolves.toEqual({ ok: true });

    // —— Assets: base64 import + meta, and the MAX_INLINE_IMAGE_BYTES cap parity ——
    const tinyPng =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const imported = await entityClient.importImageBase64({ dataBase64: tinyPng, mimeType: "image/png", fileName: "d.png" });
    const httpImported = (
      await request(app).post("/api/assets").send({ dataBase64: tinyPng, mimeType: "image/png", fileName: "d.png" }).expect(201)
    ).body;
    expect(imported.asset.mimeType).toBe("image/png");
    expect(imported.asset.byteSize).toBe(httpImported.asset.byteSize);
    const gotMeta = await entityClient.assetMeta(imported.assetId);
    expect(gotMeta.asset.id).toBe(imported.assetId);
    // Oversize → the SAME 400 message both sides (cap on decoded byte length).
    const oversize = "A".repeat(Math.ceil(((8 * 1024 * 1024 + 16) * 4) / 3));
    const directCap = await entityClient
      .importImageBase64({ dataBase64: oversize, mimeType: "image/png" })
      .catch((e: unknown) => e);
    const httpCap = (
      await request(app).post("/api/assets").send({ dataBase64: oversize, mimeType: "image/png" }).expect(400)
    ).body;
    expect((directCap as ApiError).status).toBe(400);
    expect((directCap as ApiError).message).toBe(httpCap.error);

    // —— svpack manager list (empty ⇒ [] both sides) ——
    expect((await entityClient.sealedImports()).packs).toEqual([]);
    expect((await request(app).get("/api/svpack").expect(200)).body.packs).toEqual([]);
    const missingPack = await entityClient.deleteSealedImport("pack_missing").catch((e: unknown) => e);
    expect((missingPack as ApiError).status).toBe(404);

    // —— about + vault readouts ——
    const about = await entityClient.about();
    const httpAbout = (await request(app).get("/api/about").expect(200)).body;
    expect(about.app).toBe(httpAbout.app);
    expect(about.version).toBe(httpAbout.version);
    const vaultInfo = await entityClient.vaultInfo();
    expect(typeof vaultInfo.paths.rootDir).toBe("string");
  });
});
