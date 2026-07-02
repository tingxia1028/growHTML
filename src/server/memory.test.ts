import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { openVault, type StudyVault } from "../core/vault";
import { createApp } from "./app";

// MEM-1 — the learner-memory capture endpoints (batch append / since+limit read /
// prune / the capture switch) and the §6.2 privacy invariant: memory NEVER rides an
// export. Vault-fixture idiom mirrors svpack.test.ts (tmp vault + injected identity
// dir + pinned clock per app).

type App = ReturnType<typeof createApp>;
type Ctx = { app: App; vault: StudyVault; identityDir: string };

const madeDirs: string[] = [];
async function tmp(tag: string): Promise<string> {
  const d = await mkdtemp(path.join(os.tmpdir(), `memory-${tag}-`));
  madeDirs.push(d);
  return d;
}
afterAll(async () => {
  await Promise.all(madeDirs.map((d) => rm(d, { recursive: true, force: true })));
});

// July 1 2026 12:00Z — the pinned arrival clock for events sent without a client ts.
const NOW = Date.UTC(2026, 6, 1, 12);

async function makeApp(tag: string): Promise<Ctx> {
  const vault = await openVault({ rootDir: await tmp(`${tag}-vault`) });
  const identityDir = await tmp(`${tag}-id`);
  const app = createApp({ vault, identityDir, now: () => NOW });
  return { app, vault, identityDir };
}

const ULID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const T1 = "2026-07-01T08:00:00.000Z";
const T2 = "2026-07-01T09:00:00.000Z";
const T3 = "2026-07-01T10:00:00.000Z";

async function seedThree(app: App): Promise<void> {
  await request(app)
    .post("/api/memory/events")
    .send({
      events: [
        { verb: "open", ts: T1, sessionId: "s1" },
        { verb: "note.create", ts: T2, sessionId: "s1" },
        { verb: "ai.ask", ts: T3, sessionId: "s1" }
      ]
    })
    .expect(201);
}

describe("memory routes — events", () => {
  it("appends a validated batch and reads it back oldest-first with a server envelope", async () => {
    const { app, vault } = await makeApp("batch");

    const res = await request(app)
      .post("/api/memory/events")
      .send({
        events: [
          { verb: "note.create", subject: { sourceId: `src_${ULID}`, contentType: "markdown" }, ts: T1, sessionId: "s1" },
          { verb: "ai.ask", payload: { commandId: "anchor.ask-ai" }, ts: T2, sessionId: "s1" }
        ]
      })
      .expect(201);
    expect(res.body.appended).toBe(2);

    const list = (await request(app).get("/api/memory/events").expect(200)).body;
    expect(list.total).toBe(2);
    expect(list.events).toHaveLength(2);
    expect(list.events[0].verb).toBe("note.create");
    expect(list.events[0].id).toMatch(/^mem_/);
    expect(list.events[0].type).toBe("memoryEvent");
    expect(list.events[0].createdAt).toBe(T1);
    expect(list.events[0].subject).toEqual({ sourceId: `src_${ULID}`, contentType: "markdown" });
    expect(list.events[1].verb).toBe("ai.ask");
    expect(list.events[1].payload).toEqual({ commandId: "anchor.ask-ai" });

    // Without a client ts the SERVER clock stamps the envelope.
    await request(app).post("/api/memory/events").send({ events: [{ verb: "search" }] }).expect(201);
    const all = await vault.stores.memoryEvents.list();
    expect(all).toHaveLength(3);
    expect(all.find((e) => e.verb === "search")?.createdAt).toBe(new Date(NOW).toISOString());
  });

  it("rejects invalid verbs, malformed subject ids, empty and oversize batches (400)", async () => {
    const { app, vault } = await makeApp("invalid");

    await request(app).post("/api/memory/events").send({ events: [{ verb: "not-a-verb" }] }).expect(400);
    await request(app)
      .post("/api/memory/events")
      .send({ events: [{ verb: "note.create", subject: { sourceId: "bogus" } }] })
      .expect(400);
    await request(app).post("/api/memory/events").send({ events: [] }).expect(400);
    await request(app)
      .post("/api/memory/events")
      .send({ events: Array.from({ length: 101 }, () => ({ verb: "read" })) })
      .expect(400);

    expect(await vault.stores.memoryEvents.list()).toHaveLength(0);
  });

  it("filters with since (at-or-after) and caps with limit", async () => {
    const { app } = await makeApp("since");
    await seedThree(app);

    const since = (await request(app).get(`/api/memory/events?since=${encodeURIComponent(T2)}`).expect(200)).body;
    expect(since.events.map((e: { verb: string }) => e.verb)).toEqual(["note.create", "ai.ask"]);
    expect(since.total).toBe(3);

    const limited = (await request(app).get("/api/memory/events?limit=1").expect(200)).body;
    expect(limited.events.map((e: { verb: string }) => e.verb)).toEqual(["open"]);

    const both = (
      await request(app).get(`/api/memory/events?since=${encodeURIComponent(T2)}&limit=1`).expect(200)
    ).body;
    expect(both.events.map((e: { verb: string }) => e.verb)).toEqual(["note.create"]);

    await request(app).get("/api/memory/events?since=not-a-date").expect(400);
    await request(app).get("/api/memory/events?limit=0").expect(400);
  });

  it("prunes events captured before the cutoff", async () => {
    const { app, vault } = await makeApp("prune");
    await seedThree(app);

    // No cutoff → 400 (never an accidental "delete everything").
    await request(app).delete("/api/memory/events").expect(400);
    await request(app).delete("/api/memory/events?before=not-a-date").expect(400);

    const noop = (await request(app).delete(`/api/memory/events?before=${encodeURIComponent(T1)}`).expect(200)).body;
    expect(noop.deleted).toBe(0);

    const pruned = (await request(app).delete(`/api/memory/events?before=${encodeURIComponent(T3)}`).expect(200)).body;
    expect(pruned.deleted).toBe(2);

    const rest = await vault.stores.memoryEvents.list();
    expect(rest).toHaveLength(1);
    expect(rest[0].verb).toBe("ai.ask");
  });
});

describe("memory routes — the capture switch", () => {
  it("settings roundtrip: default ON, PUT persists across app instances, bad PUTs 400", async () => {
    const { app, vault, identityDir } = await makeApp("settings");

    expect((await request(app).get("/api/memory/settings").expect(200)).body).toEqual({
      settings: { captureEnabled: true }
    });

    expect(
      (await request(app).put("/api/memory/settings").send({ captureEnabled: false }).expect(200)).body
    ).toEqual({ settings: { captureEnabled: false } });
    expect((await request(app).get("/api/memory/settings").expect(200)).body.settings.captureEnabled).toBe(false);

    // Persisted in the vault (memory-settings.json), not app memory: a fresh app sees it.
    const again = createApp({ vault, identityDir, now: () => NOW });
    expect((await request(again).get("/api/memory/settings").expect(200)).body.settings.captureEnabled).toBe(false);

    await request(app).put("/api/memory/settings").send({ captureEnabled: "nope" }).expect(400);
    await request(app).put("/api/memory/settings").send({}).expect(400);
  });

  it("capture OFF drops batches with 204 and stores NOTHING; ON resumes", async () => {
    const { app, vault } = await makeApp("switch");

    await request(app).put("/api/memory/settings").send({ captureEnabled: false }).expect(200);
    const dropped = await request(app)
      .post("/api/memory/events")
      .send({ events: [{ verb: "note.create" }, { verb: "ai.ask" }] })
      .expect(204);
    expect(dropped.body).toEqual({});
    expect(await vault.stores.memoryEvents.list()).toHaveLength(0);
    expect((await request(app).get("/api/memory/events").expect(200)).body.total).toBe(0);

    await request(app).put("/api/memory/settings").send({ captureEnabled: true }).expect(200);
    await request(app).post("/api/memory/events").send({ events: [{ verb: "note.create" }] }).expect(201);
    expect(await vault.stores.memoryEvents.list()).toHaveLength(1);
  });
});

// —— §6.2: "Never exported" — the guard test MEM-1 promises. buildStudyPack reads only
// the layer's anchors+notes, so memory is structurally outside every export; this pins
// that invariant against future refactors of the export path. ——
describe("export guard — memory never rides a study pack", () => {
  const HTML =
    "<article><h1>Cell Biology</h1><p>Intro to the cell.</p>" +
    "<p>The mitochondrion is the powerhouse of the cell.</p></article>";
  const QUOTE = "The mitochondrion is the powerhouse of the cell.";

  it("a layer export contains ZERO memory records while the vault holds captured events", async () => {
    const { app, vault } = await makeApp("guard");

    // A real layer: source + anchor + note (the svpack.test seeding idiom).
    const sourceId = (
      await request(app).post("/api/sources/html").send({ title: "Cell Biology", content: HTML }).expect(201)
    ).body.source.id;
    const anchor = (
      await request(app)
        .post("/api/anchors")
        .send({ sourceId, anchorKind: "html_selection", studyId: `seed-${sourceId}`, quote: QUOTE })
        .expect(201)
    ).body.anchor;
    const note = (
      await request(app)
        .post("/api/notes")
        .send({ sourceId, anchorIds: [anchor.id], contentType: "markdown", content: "Mnemonic: powerhouse." })
        .expect(201)
    ).body.note;

    // Captured behavior REFERENCING that exact content — the worst case for a leak.
    await request(app)
      .post("/api/memory/events")
      .send({
        events: [
          { verb: "open", subject: { sourceId }, sessionId: "s1" },
          { verb: "note.create", subject: { sourceId, anchorId: anchor.id, noteId: note.id }, sessionId: "s1" },
          { verb: "export", subject: { sourceId, layerId: anchor.layerId }, sessionId: "s1" }
        ]
      })
      .expect(201);
    const stored = await vault.stores.memoryEvents.list();
    expect(stored).toHaveLength(3); // the guard is meaningful: memory EXISTS at export time

    // Export the layer through the single export choke point (buildStudyPack).
    const exported = (await request(app).post(`/api/layers/${anchor.layerId}/export`).send({}).expect(200)).body;
    const packJson = JSON.stringify(exported);

    // Zero memory in the pack: no record type, no mem_ ids, none of the stored events.
    expect(packJson).not.toContain("memoryEvent");
    expect(packJson).not.toContain("mem_");
    for (const event of stored) expect(packJson).not.toContain(event.id);
    expect(packJson).not.toContain("sessionId");

    // …and the pack still carries the layer's REAL content (the export itself works).
    expect(packJson).toContain("Mnemonic: powerhouse.");
    expect(exported.pack.notes).toHaveLength(1);
    expect(exported.pack.anchors).toHaveLength(1);
  });
});
