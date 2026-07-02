import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterAll, describe, expect, it, vi } from "vitest";
import { openVault, type StudyVault } from "../core/vault";
import { createApp } from "./app";
import {
  createMemoryConsolidationScheduler,
  MEMORY_DIGESTS_FILE_NAME,
  MEMORY_PROFILE_OVERRIDES_FILE_NAME
} from "./memory";

// MEM-1 — the learner-memory capture endpoints (batch append / since+limit read /
// prune / the capture switch) and the §6.2 privacy invariant: memory NEVER rides an
// export. MEM-2 — the tiers: consolidation (events→digests + raw compaction),
// digests/profile reads, the override layer, clear-all, and the guard extension
// (digests/profile/overrides never ride an export either). Vault-fixture idiom
// mirrors svpack.test.ts (tmp vault + injected identity dir + pinned clock per app).

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

// —— MEM-2: tiers — consolidation (events→digests + §2 raw compaction), the digests
// read, profile facts + the override layer, and clear-all. The pinned clock makes the
// whole pipeline deterministic: NOW = 2026-07-01T12:00Z ⇒ the 14d raw boundary is
// 2026-06-17T00:00Z, so OLD (06-10) freezes+prunes and RECENT (06-2x) stays raw. ——
const BOUNDARY = "2026-06-17T00:00:00.000Z";
const OLD_TS = "2026-06-10T08:00:00.000Z";

async function seedTiers(app: App): Promise<void> {
  await request(app)
    .post("/api/memory/events")
    .send({
      events: [
        { verb: "open", ts: OLD_TS, subject: { contentType: "markdown" }, sessionId: "s0" },
        { verb: "note.review", ts: "2026-06-20T08:00:00.000Z", subject: { contentType: "quiz" }, payload: { result: "fail" } },
        { verb: "note.review", ts: "2026-06-20T09:00:00.000Z", subject: { contentType: "quiz" }, payload: { result: "fail" } },
        { verb: "note.review", ts: "2026-06-21T09:00:00.000Z", subject: { contentType: "quiz" }, payload: { result: "fail" } },
        { verb: "note.create", ts: "2026-06-21T10:00:00.000Z", subject: { contentType: "flashcard" }, sessionId: "s1" }
      ]
    })
    .expect(201);
}

describe("memory tiers — consolidation (MEM-2)", () => {
  it("POST /api/memory/consolidate rolls events into day digests, prunes the old raw tail, and is idempotent", async () => {
    const { app, vault } = await makeApp("consolidate");
    await seedTiers(app);

    const first = (await request(app).post("/api/memory/consolidate").expect(200)).body.consolidated;
    expect(first.frozenThrough).toBe(BOUNDARY);
    expect(first.consolidatedAt).toBe(new Date(NOW).toISOString());
    expect(first.prunedEvents).toBe(1); // the 06-10 event froze into digests and left raw
    expect(first.rows).toBeGreaterThan(0);

    // Raw compaction really happened (§2): only the 4 recent events remain.
    const events = await vault.stores.memoryEvents.list();
    expect(events).toHaveLength(4);
    expect(events.every((event) => Date.parse(event.createdAt) >= Date.parse(BOUNDARY))).toBe(true);

    // The digest tier is persisted in its own vault.storage file…
    const digestsPath = path.join(vault.paths.studyDir, MEMORY_DIGESTS_FILE_NAME);
    const persisted = JSON.parse(await readFile(digestsPath, "utf8"));
    expect(persisted.frozenThrough).toBe(BOUNDARY);
    // …with the pruned event's day FROZEN in rows (the long tail outlives the raw stream).
    const frozenDay = persisted.rows.find(
      (row: { date: string; dimension: string }) => row.date === "2026-06-10" && row.dimension === "overall"
    );
    expect(frozenDay).toMatchObject({ events: 1, counts: { open: 1 } });

    // Idempotent: a duplicate pass changes nothing and prunes nothing.
    const second = (await request(app).post("/api/memory/consolidate").expect(200)).body.consolidated;
    expect(second.prunedEvents).toBe(0);
    expect(second.rows).toBe(first.rows);
    expect(JSON.parse(await readFile(digestsPath, "utf8"))).toEqual(persisted);
    expect(await vault.stores.memoryEvents.list()).toHaveLength(4);
  });

  it("GET /api/memory/digests serves the LIVE view (pre-consolidation) with a dimension filter", async () => {
    const { app } = await makeApp("digests");
    await seedTiers(app);

    // No consolidate call yet — the read still sees everything (live merge).
    const all = (await request(app).get("/api/memory/digests").expect(200)).body;
    expect(all.meta.frozenThrough).toBe(BOUNDARY);
    expect(all.digests.length).toBe(all.meta.rows);
    const quizRow = all.digests.find(
      (row: { dimension: string; bucket: string; date: string }) =>
        row.dimension === "contentType" && row.bucket === "quiz" && row.date === "2026-06-20"
    );
    expect(quizRow).toMatchObject({ review: { pass: 0, fail: 2, skip: 0 }, events: 2 });

    const filtered = (await request(app).get("/api/memory/digests?dimension=contentType").expect(200)).body;
    expect(filtered.digests.length).toBeGreaterThan(0);
    expect(filtered.digests.every((row: { dimension: string }) => row.dimension === "contentType")).toBe(true);
    expect(filtered.meta.rows).toBe(all.meta.rows); // meta counts the whole tier, not the filter

    await request(app).get("/api/memory/digests?dimension=not-a-dimension").expect(400);
  });
});

describe("memory tiers — profile facts + overrides (MEM-2)", () => {
  it("GET /api/memory/profile derives deterministic facts with digestMeta (doc retention defaults)", async () => {
    const { app } = await makeApp("profile");
    await seedTiers(app);

    const { facts, overrides, digestMeta } = (await request(app).get("/api/memory/profile").expect(200)).body;
    expect(overrides).toEqual({ facts: [] });

    // 弱项: quiz failed 3/3 graded attempts ⇒ over both thresholds.
    const weak = facts.find((fact: { key: string }) => fact.key === "weak:contentType:quiz");
    expect(weak).toMatchObject({ kind: "weak", title: "弱项:quiz", pinned: false, hidden: false });
    expect(weak.value).toContain("100%");
    // 活跃 + 常用 derive alongside.
    expect(facts.map((fact: { key: string }) => fact.key)).toEqual(
      expect.arrayContaining(["activity:last-active", "activity:streak", "top:verbs", "top:content-types"])
    );

    expect(digestMeta.captureEnabled).toBe(true);
    expect(digestMeta.events).toBe(5); // raw stream still uncompacted
    expect(digestMeta.retention).toEqual({ rawEventDays: 14, digestDays: 365 });
    expect(digestMeta.frozenThrough).toBe(BOUNDARY);
  });

  it("PUT /api/memory/profile stores the override layer; overrides survive consolidation + fact recompute", async () => {
    const { app, vault } = await makeApp("overrides");
    await seedTiers(app);

    const put = await request(app)
      .put("/api/memory/profile")
      .send({ facts: [{ key: "weak:contentType:quiz", pinned: true, note: "考试当天生病了" }, { key: "top:verbs", hidden: true }] })
      .expect(200);
    expect(put.body.overrides.facts).toHaveLength(2);

    // Persisted in its own file (the 长期 override layer).
    const overridesPath = path.join(vault.paths.studyDir, MEMORY_PROFILE_OVERRIDES_FILE_NAME);
    expect(JSON.parse(await readFile(overridesPath, "utf8")).facts).toHaveLength(2);

    // Facts RECOMPUTE (consolidation compacts raw events) — overrides still apply.
    await request(app).post("/api/memory/consolidate").expect(200);
    const { facts, overrides } = (await request(app).get("/api/memory/profile").expect(200)).body;
    expect(overrides.facts).toHaveLength(2);
    expect(facts[0].key).toBe("weak:contentType:quiz"); // pinned floats first
    expect(facts[0]).toMatchObject({ pinned: true, note: "考试当天生病了" });
    expect(facts.find((fact: { key: string }) => fact.key === "top:verbs")).toMatchObject({ hidden: true });

    // Bad bodies are refused wholesale (400) and leave the stored document alone.
    await request(app).put("/api/memory/profile").send({ facts: [{ key: "" }] }).expect(400);
    await request(app).put("/api/memory/profile").send({ facts: [{ key: "x", pinned: "yes" }] }).expect(400);
    expect(JSON.parse(await readFile(overridesPath, "utf8")).facts).toHaveLength(2);
  });

  it("§6.4 capture OFF only stops capture: the profile stays viewable and says so", async () => {
    const { app } = await makeApp("capture-off-profile");
    await seedTiers(app);
    await request(app).put("/api/memory/settings").send({ captureEnabled: false }).expect(200);

    const { facts, digestMeta } = (await request(app).get("/api/memory/profile").expect(200)).body;
    expect(digestMeta.captureEnabled).toBe(false);
    // Existing memory still fully readable (the user owns it) — facts still derive.
    expect(facts.find((fact: { key: string }) => fact.key === "weak:contentType:quiz")).toBeTruthy();
    // …and digests too.
    const { digests } = (await request(app).get("/api/memory/digests").expect(200)).body;
    expect(digests.length).toBeGreaterThan(0);
  });

  it("DELETE /api/memory clears EVERY tier (events + digests + overrides); the switch survives", async () => {
    const { app, vault } = await makeApp("clear-all");
    await seedTiers(app);
    await request(app).post("/api/memory/consolidate").expect(200);
    await request(app)
      .put("/api/memory/profile")
      .send({ facts: [{ key: "weak:contentType:quiz", pinned: true }] })
      .expect(200);
    await request(app).put("/api/memory/settings").send({ captureEnabled: false }).expect(200);

    const { cleared } = (await request(app).delete("/api/memory").expect(200)).body;
    expect(cleared).toEqual({ events: 4, digests: true, overrides: true });

    expect(await vault.stores.memoryEvents.list()).toHaveLength(0);
    await expect(readFile(path.join(vault.paths.studyDir, MEMORY_DIGESTS_FILE_NAME), "utf8")).rejects.toThrow();
    await expect(
      readFile(path.join(vault.paths.studyDir, MEMORY_PROFILE_OVERRIDES_FILE_NAME), "utf8")
    ).rejects.toThrow();

    const profile = (await request(app).get("/api/memory/profile").expect(200)).body;
    expect(profile.facts).toEqual([]);
    expect(profile.overrides).toEqual({ facts: [] });
    expect(profile.digestMeta.rows).toBe(0);
    // The capture SWITCH is a setting, not memory — deliberately untouched (§6.4).
    expect(profile.digestMeta.captureEnabled).toBe(false);
    expect((await request(app).get("/api/memory/digests").expect(200)).body.digests).toEqual([]);
  });
});

describe("memory tiers — the idle/threshold scheduler", () => {
  it("debounces appends into ONE trailing pass; the count threshold fires immediately", async () => {
    vi.useFakeTimers();
    try {
      const vault = await openVault({ rootDir: await tmp("scheduler-vault") });
      const scheduler = createMemoryConsolidationScheduler(
        { vault, now: () => NOW },
        { debounceMs: 1000, threshold: 10 }
      );

      const digestsPath = path.join(vault.paths.studyDir, MEMORY_DIGESTS_FILE_NAME);
      await expect(readFile(digestsPath, "utf8")).rejects.toThrow(); // nothing yet

      scheduler.notifyAppended(1);
      scheduler.notifyAppended(1); // pushes the trailing timer out
      await vi.advanceTimersByTimeAsync(999);
      await expect(readFile(digestsPath, "utf8")).rejects.toThrow(); // still idle-waiting
      await vi.advanceTimersByTimeAsync(1);
      await scheduler.dispose(); // drain the in-flight pass
      expect(JSON.parse(await readFile(digestsPath, "utf8")).frozenThrough).toBe(BOUNDARY);

      // Threshold: no timer needed — a burst consolidates at once.
      await rm(digestsPath, { force: true });
      scheduler.notifyAppended(10);
      await scheduler.dispose();
      expect(JSON.parse(await readFile(digestsPath, "utf8")).frozenThrough).toBe(BOUNDARY);
    } finally {
      vi.useRealTimers();
    }
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
          { verb: "export", subject: { sourceId, layerId: anchor.layerId }, sessionId: "s1" },
          // MEM-2 fuel: enough graded failures that a 弱项 fact derives over this vault.
          { verb: "note.review", subject: { sourceId, contentType: "markdown" }, payload: { result: "fail" }, sessionId: "s1" },
          { verb: "note.review", subject: { sourceId, contentType: "markdown" }, payload: { result: "fail" }, sessionId: "s1" },
          { verb: "note.review", subject: { sourceId, contentType: "markdown" }, payload: { result: "fail" }, sessionId: "s1" }
        ]
      })
      .expect(201);
    const stored = await vault.stores.memoryEvents.list();
    expect(stored).toHaveLength(6); // the guard is meaningful: memory EXISTS at export time

    // MEM-2: EVERY tier exists at export time — digests persisted, facts derivable,
    // and a user override with unmistakable marker text.
    await request(app).post("/api/memory/consolidate").expect(200);
    const OVERRIDE_MARKER = "GUARD-OVERRIDE-私密更正-9f3";
    await request(app)
      .put("/api/memory/profile")
      .send({ facts: [{ key: "weak:contentType:markdown", pinned: true, note: OVERRIDE_MARKER }] })
      .expect(200);
    const profile = (await request(app).get("/api/memory/profile").expect(200)).body;
    expect(profile.facts.length).toBeGreaterThan(0); // the 长期 tier is real, not vacuous
    expect(profile.digestMeta.rows).toBeGreaterThan(0); // so is the 中长期 tier

    // Export the layer through the single export choke point (buildStudyPack).
    const exported = (await request(app).post(`/api/layers/${anchor.layerId}/export`).send({}).expect(200)).body;
    const packJson = JSON.stringify(exported);

    // Zero memory in the pack: no record type, no mem_ ids, none of the stored events.
    expect(packJson).not.toContain("memoryEvent");
    expect(packJson).not.toContain("mem_");
    for (const event of stored) expect(packJson).not.toContain(event.id);
    expect(packJson).not.toContain("sessionId");

    // Zero MEM-2 tier data either: no digest rows/verbs, no facts, no override text.
    expect(packJson).not.toContain("frozenThrough");
    expect(packJson).not.toContain("note.review");
    expect(packJson).not.toContain("弱项");
    expect(packJson).not.toContain("weak:contentType");
    expect(packJson).not.toContain(OVERRIDE_MARKER);
    expect(packJson).not.toContain("digest");

    // …and the pack still carries the layer's REAL content (the export itself works).
    expect(packJson).toContain("Mnemonic: powerhouse.");
    expect(exported.pack.notes).toHaveLength(1);
    expect(exported.pack.anchors).toHaveLength(1);
  });
});
