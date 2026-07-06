// X0b acceptance (docs/design/multi-platform.md §1-X0 / §6): the REAL entityClient
// runs its normal flow over the DIRECT adapter — zero express, zero supertest, zero
// fetch on that side — and the results field-compare against the SAME flow driven
// over the real HTTP app (supertest) in this file. One client, two backends, one
// contract: same bodies, same error statuses/messages (ApiError parity), and an
// unlisted path fails loudly instead of half-working.
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
import { openVault, type StudyVault } from "../../core/vault";
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
  directVault = await openVault({ rootDir: await tmp("vault") });
  const sealed = createSealedRuntime({
    vault: directVault,
    identityDir: await tmp("id"),
    now: () => NOW
  });
  direct = createDirectTransport({ vault: directVault, sealed, now: () => NOW });
  configureVaultTransport(direct);

  // HTTP side: the SAME flow over the real express app, for field comparison.
  httpVault = await openVault({ rootDir: await tmp("http-vault") });
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
});
