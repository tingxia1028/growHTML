// STORE-SQL Stage-5 GUARD (docs/implementation/sqlite-migration-build-spec.md §Stage-5) — the FTS5
// candidate-filter must be a strict PARITY layer over today's in-memory scan: same hits, same ranker
// order, for every query class. The oracle is a JSONL-backed vault (which NEVER touches FTS → the
// pure scan) seeded IDENTICALLY to the SQLite-backed vault (which routes CJK≥3 queries through the
// `<table>_fts` MATCH pre-filter). Any divergence between the two engines is a recall/order bug.
//
// Covered: a note whose ONLY hit is via an ANCHOR QUOTE (quotes are denormalized into the note FTS
// doc), a CJK note found by a PINYIN query (routed to the scan — decision (b)), a CJK≥3 literal query
// (routed through FTS), the anchor-quote-EDIT write-amplification (old quote no longer hits, new one
// does), and both the direct transport AND the Express-parity service path.
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEntityId } from "../../core/ids";
import { anchorSchema, noteSchema, sourceSchema, type AnchorRecord, type NoteRecord } from "../../core/schema";
import { type StudyVault } from "../../core/vault";
import { openTestVault } from "../../core/testing/openTestVault";
import { createSealedRuntime, type SealedRuntime } from "../svpack";
import { createDirectTransport } from "./directTransport";
import { searchVault, type NoteSearchHit, type SearchHit } from "./search";

const stamp = (iso: string) => ({ createdAt: iso, updatedAt: iso });

type Harness = { vault: StudyVault; sealed: SealedRuntime; dir: string };

async function openHarness(engine: "sqlite" | "jsonl"): Promise<Harness> {
  const dir = await mkdtemp(path.join(os.tmpdir(), `search-fts-${engine}-`));
  const prior = process.env.STORE_ENGINE;
  if (engine === "jsonl") process.env.STORE_ENGINE = "jsonl";
  else delete process.env.STORE_ENGINE; // unset ⇒ sqlite (the default)
  try {
    const vault = await openTestVault({ rootDir: dir });
    const sealed = createSealedRuntime({ vault, identityDir: path.join(dir, "identity"), now: () => Date.now() });
    return { vault, sealed, dir };
  } finally {
    if (prior === undefined) delete process.env.STORE_ENGINE;
    else process.env.STORE_ENGINE = prior;
  }
}

async function seedSource(h: Harness, title: string, updatedAt: string) {
  const record = sourceSchema.parse({
    id: createEntityId("source"),
    type: "source",
    schemaVersion: 1,
    ...stamp(updatedAt),
    createdBy: "user",
    sourceType: "html",
    title,
    path: `sources/${createEntityId("source")}.html`,
    contentHash: `sha256:${"a".repeat(64)}`
  });
  await h.vault.stores.sources.upsert(record);
  return record;
}

async function seedAnchor(h: Harness, sourceId: string, quote: string, id = createEntityId("anchor")): Promise<AnchorRecord> {
  const record = anchorSchema.parse({
    id,
    type: "anchor",
    schemaVersion: 1,
    ...stamp("2026-06-01T00:00:00.000Z"),
    createdBy: "user",
    sourceId,
    anchorKind: "html_selection",
    quote,
    studyId: "p-1",
    selector: '[data-study-id="p-1"]'
  });
  await h.vault.stores.anchors.upsert(record);
  return record;
}

async function seedNote(h: Harness, input: {
  id?: string;
  sourceId?: string;
  anchorIds?: string[];
  contentType?: string;
  content: unknown;
  updatedAt: string;
}): Promise<NoteRecord> {
  const record = noteSchema.parse({
    id: input.id ?? createEntityId("note"),
    type: "note",
    schemaVersion: 1,
    ...stamp(input.updatedAt),
    createdBy: "user",
    sourceId: input.sourceId,
    anchorIds: input.anchorIds ?? [],
    contentType: input.contentType ?? "markdown",
    content: input.content,
    visibility: "private"
  });
  await h.vault.stores.notes.upsert(record);
  return record;
}

const ids = (hits: SearchHit[]) => hits.map((h) => h.id);
const noteHits = (hits: SearchHit[]) => hits.filter((h): h is NoteSearchHit => h.family === "note");

// A shared corpus with STABLE ids so the sqlite and jsonl vaults can be seeded byte-identically and
// their searchVault outputs compared record-for-record.
type Fixture = { sIds: string[]; aId: string; nIds: string[] };
function makeFixture(): Fixture {
  return {
    sIds: [createEntityId("source"), createEntityId("source")],
    aId: createEntityId("anchor"),
    nIds: [createEntityId("note"), createEntityId("note"), createEntityId("note"), createEntityId("note")]
  };
}

async function seedCorpus(h: Harness, f: Fixture) {
  // Sources (stable ids so ordering matches across engines).
  const s0 = sourceSchema.parse({
    id: f.sIds[0], type: "source", schemaVersion: 1, ...stamp("2026-06-01T00:00:00.000Z"),
    createdBy: "user", sourceType: "html", title: "浮力实验讲义",
    path: `sources/${f.sIds[0]}.html`, contentHash: `sha256:${"a".repeat(64)}`
  });
  const s1 = sourceSchema.parse({
    id: f.sIds[1], type: "source", schemaVersion: 1, ...stamp("2026-06-02T00:00:00.000Z"),
    createdBy: "user", sourceType: "html", title: "关于浮力的网页",
    path: `sources/${f.sIds[1]}.html`, contentHash: `sha256:${"b".repeat(64)}`
  });
  await h.vault.stores.sources.upsert(s0);
  await h.vault.stores.sources.upsert(s1);

  await seedAnchor(h, f.sIds[0], "阿基米德原理指出浮力等于排开液体的重量", f.aId);

  // n0: prefix hit on "浮力"; n1: substring hit older; n2: substring newest; n3: NO content hit —
  // only its anchor quote matches "阿基米德" (the quote-only-hit case).
  await seedNote(h, { id: f.nIds[0], sourceId: f.sIds[0], content: "浮力定律与压强", updatedAt: "2026-06-11T00:00:00.000Z" });
  await seedNote(h, { id: f.nIds[1], sourceId: f.sIds[0], anchorIds: [f.aId], content: "关于浮力的第一条笔记", updatedAt: "2026-06-10T00:00:00.000Z" });
  await seedNote(h, { id: f.nIds[2], sourceId: f.sIds[1], contentType: "quiz", content: { question: "什么是浮力?", options: ["A", "B"], answerIndex: 0 }, updatedAt: "2026-06-12T00:00:00.000Z" });
  await seedNote(h, { id: f.nIds[3], sourceId: f.sIds[0], anchorIds: [f.aId], content: "见右侧标注", updatedAt: "2026-06-05T00:00:00.000Z" });
}

describe("STORE-SQL Stage-5 FTS candidate filter — parity with the in-memory scan (sqlite vs jsonl)", () => {
  let sqlite: Harness;
  let jsonl: Harness;

  beforeEach(async () => {
    sqlite = await openHarness("sqlite");
    jsonl = await openHarness("jsonl");
    const f = makeFixture();
    await seedCorpus(sqlite, f);
    await seedCorpus(jsonl, f);
  });

  afterEach(async () => {
    sqlite?.vault.close();
    jsonl?.vault.close();
    await rm(sqlite.dir, { recursive: true, force: true });
    await rm(jsonl.dir, { recursive: true, force: true });
  });

  // The core guard: identical output for every query class, including the ones that ROUTE through
  // FTS (CJK ≥ 3) and the ones that must FALL BACK to the scan (short CJK, pinyin, quote-only).
  const queries = [
    "浮力",        // 2-char CJK → below the trigram floor → scan
    "浮力定律",     // 4-char CJK literal → FTS pre-filter
    "阿基米德",     // 4-char CJK, hits a note ONLY via its anchor quote → FTS (quote denormalized)
    "关于浮力的网页", // exact source title → FTS
    "fuli",        // roman full pinyin → scan (decision b)
    "fl",          // roman initials, < 3 → scan
    "什么是浮力"     // 5-char CJK into a quiz note's search text → FTS
  ];

  for (const q of queries) {
    it(`"${q}" → sqlite (FTS-routed) === jsonl (pure scan), hits + order preserved`, async () => {
      const fromSqlite = await searchVault({ vault: sqlite.vault, sealed: sqlite.sealed }, { q });
      const fromScan = await searchVault({ vault: jsonl.vault, sealed: jsonl.sealed }, { q });
      expect(fromSqlite).toEqual(fromScan);
    });
  }

  it("a note found ONLY via its anchor quote survives the FTS pre-filter (quote denormalized into the note FTS doc)", async () => {
    const hits = await searchVault({ vault: sqlite.vault, sealed: sqlite.sealed }, { q: "阿基米德" });
    // n3's content "见右侧标注" does NOT contain the query — it is in the result set ONLY because its
    // anchor quote (denormalized into its FTS doc) matches. If FTS had dropped it, it would be absent.
    const quoteOnly = noteHits(hits).find((h) => h.title === "见右侧标注");
    expect(quoteOnly).toBeDefined();
    expect(quoteOnly?.snippet).toContain("阿基米德");
  });

  it("a CJK note is found by a PINYIN query (routed to the scan, NOT dropped by FTS)", async () => {
    const byPinyin = await searchVault({ vault: sqlite.vault, sealed: sqlite.sealed }, { q: "fulidingl" });
    // n0's search text "浮力定律与压强" romanizes to fulidinglvyayaqiang → prefix-hit on "fulidingl".
    expect(noteHits(byPinyin).length).toBeGreaterThan(0);
    expect(noteHits(byPinyin).some((h) => h.title === "浮力定律与压强")).toBe(true);
  });

  it("parity holds over the direct transport AND the service (mobile searches identically)", async () => {
    const q = "浮力定律"; // FTS-routed
    const transport = createDirectTransport({ vault: sqlite.vault, sealed: sqlite.sealed });
    const direct = await transport.request<{ hits: SearchHit[] }>("GET", `/api/search?q=${encodeURIComponent(q)}`);
    const service = await searchVault({ vault: sqlite.vault, sealed: sqlite.sealed }, { q });
    const scan = await searchVault({ vault: jsonl.vault, sealed: jsonl.sealed }, { q });
    expect(direct.hits).toEqual(service); // transport == service
    expect(service).toEqual(scan); // service (FTS) == scan (jsonl)
  });
});

describe("STORE-SQL Stage-5 — anchor-quote-edit write-amplification (FTS doc refresh)", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await openHarness("sqlite");
  });

  afterEach(async () => {
    h?.vault.close();
    await rm(h.dir, { recursive: true, force: true });
  });

  it("editing an anchor's quote refreshes the FTS docs of notes referencing it (found by the NEW quote, not the OLD)", async () => {
    const source = await seedSource(h, "讲义", "2026-06-01T00:00:00.000Z");
    const anchor = await seedAnchor(h, source.id, "阿基米德原理指出浮力");
    // The note's own content does NOT contain either quote — it is found ONLY via the anchor quote.
    await seedNote(h, { sourceId: source.id, anchorIds: [anchor.id], content: "见右侧标注", updatedAt: "2026-06-05T00:00:00.000Z" });

    // Found by the ORIGINAL quote text (routed through FTS: 4-char CJK).
    const before = await searchVault({ vault: h.vault, sealed: h.sealed }, { q: "阿基米德" });
    expect(noteHits(before).length).toBe(1);

    // Edit the anchor's quote (the write-amplification trigger). Junction unchanged; quote text changes.
    await h.vault.stores.anchors.upsert({ ...anchor, quote: "帕斯卡定律描述压强传递", updatedAt: "2026-06-06T00:00:00.000Z" });

    // The note is NOW found by the NEW quote text …
    const byNew = await searchVault({ vault: h.vault, sealed: h.sealed }, { q: "帕斯卡定律" });
    expect(noteHits(byNew).length).toBe(1);
    expect(noteHits(byNew)[0].snippet).toContain("帕斯卡");
    // … and NO LONGER by the OLD quote text (the stale FTS doc was refreshed away).
    const byOld = await searchVault({ vault: h.vault, sealed: h.sealed }, { q: "阿基米德" });
    expect(noteHits(byOld).length).toBe(0);
  });

  it("restoring a trashed anchor re-indexes referencing notes — liveness transition, not just quote text (S5 review BLOCKING guard)", async () => {
    const source = await seedSource(h, "讲义", "2026-06-01T00:00:00.000Z");
    const anchor = await seedAnchor(h, source.id, "阿基米德原理指出浮力");
    // The note is findable ONLY via its anchor quote — its own content lacks the query.
    const note = await seedNote(h, { sourceId: source.id, anchorIds: [anchor.id], content: "见右侧标注", updatedAt: "2026-06-05T00:00:00.000Z" });

    // Baseline: found by the quote (FTS-routed, CJK ≥ 3).
    expect(noteHits(await searchVault({ vault: h.vault, sealed: h.sealed }, { q: "阿基米德" })).length).toBe(1);

    // (1) Soft-delete the anchor — quote TEXT unchanged, so the text-only change-detector would skip the fan-out.
    await h.vault.stores.anchors.upsert({ ...anchor, deletedAt: "2026-06-06T00:00:00.000Z", updatedAt: "2026-06-06T00:00:00.000Z" });
    // (2) Re-save the note for an unrelated reason → its FTS doc is rebuilt, the now-trashed anchor's quote
    //     resolves to "" → the note doc is blanked of the quote.
    await h.vault.stores.notes.upsert({ ...note, content: "见右侧标注(修订)", updatedAt: "2026-06-07T00:00:00.000Z" });
    // (3) Restore the anchor — clear deletedAt, quote STILL unchanged (text-only detector would skip again).
    await h.vault.stores.anchors.upsert({ ...anchor, updatedAt: "2026-06-08T00:00:00.000Z" });

    // With the liveness-transition fan-out the note's FTS doc regained the quote → still found. Under the
    // old text-only detector this was [] — the note the scan still finds but FTS silently missed.
    expect(noteHits(await searchVault({ vault: h.vault, sealed: h.sealed }, { q: "阿基米德" })).length).toBe(1);
  });
});
