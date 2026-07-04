// SEARCH-1 engine acceptance (docs/design/global-search.md §2/§4): the searchVault
// service over a seeded temp vault — both server families, REGISTRY-DRIVEN note text
// (a fixture NoteContentSpec is searchable with zero engine code), anchors surfacing
// through their notes (quote hit → quote snippet), pinned rank order (prefix before
// substring; recency inside a tier), the per-family cap, CJK substring, the empty
// query, and direct-transport parity (mobile searches identically).
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createEntityId } from "../../core/ids";
import { registerNoteContentSpec } from "../../core/notes/contentTypes";
import { anchorSchema, noteSchema, sourceSchema, type NoteRecord } from "../../core/schema";
import { openVault, type StudyVault } from "../../core/vault";
import { createSealedRuntime, type SealedRuntime } from "../svpack";
import { createDirectTransport } from "./directTransport";
import { MAX_HITS_PER_FAMILY, searchVault, type NoteSearchHit, type SourceSearchHit } from "./search";

// The registry-driven claim (design §2): a NEW content spec is searchable the moment
// it registers — the engine never learns about it. Registered once for this file.
registerNoteContentSpec({
  contentType: "search-fixture",
  schema: z.object({ label: z.string(), body: z.string() }),
  createDefault: () => ({ label: "", body: "" }),
  toSearchText: (c) => `${(c as { label: string }).label}\n${(c as { body: string }).body}`
});

let tempDir = "";
let vault: StudyVault;
let sealed: SealedRuntime;

const stamp = (iso: string) => ({ createdAt: iso, updatedAt: iso });

async function seedSource(title: string, updatedAt: string) {
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
  await vault.stores.sources.upsert(record);
  return record;
}

async function seedAnchor(sourceId: string, quote: string) {
  const record = anchorSchema.parse({
    id: createEntityId("anchor"),
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
  await vault.stores.anchors.upsert(record);
  return record;
}

async function seedNote(input: {
  sourceId?: string;
  anchorIds?: string[];
  contentType?: string;
  content: unknown;
  updatedAt: string;
}): Promise<NoteRecord> {
  const record = noteSchema.parse({
    id: createEntityId("note"),
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
  await vault.stores.notes.upsert(record);
  return record;
}

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "study-vault-search-"));
  vault = await openVault({ rootDir: tempDir });
  sealed = createSealedRuntime({
    vault,
    identityDir: path.join(tempDir, "identity"),
    now: () => Date.now()
  });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

const noteHits = (hits: Awaited<ReturnType<typeof searchVault>>) =>
  hits.filter((hit): hit is NoteSearchHit => hit.family === "note");
const sourceHits = (hits: Awaited<ReturnType<typeof searchVault>>) =>
  hits.filter((hit): hit is SourceSearchHit => hit.family === "source");

describe("searchVault — families, rank, cap", () => {
  it("empty / blank query → no hits (the palette's empty state is client business)", async () => {
    await seedSource("浮力实验讲义", "2026-06-01T00:00:00.000Z");
    expect(await searchVault({ vault, sealed }, { q: "" })).toEqual([]);
    expect(await searchVault({ vault, sealed }, { q: "   " })).toEqual([]);
  });

  it("CJK substring across notes + sources, pinned rank order (prefix first, recency inside a tier), source hop info", async () => {
    const s1 = await seedSource("浮力实验讲义", "2026-06-01T00:00:00.000Z"); // prefix
    const s2 = await seedSource("关于浮力的网页", "2026-06-02T00:00:00.000Z"); // substring
    await seedSource("Pressure basics", "2026-06-03T00:00:00.000Z"); // no hit
    const anchor = await seedAnchor(s1.id, "阿基米德原理指出浮力等于排开液体的重量");

    const n1 = await seedNote({
      sourceId: s1.id,
      anchorIds: [anchor.id],
      content: "关于浮力的第一条笔记",
      updatedAt: "2026-06-10T00:00:00.000Z" // substring, older
    });
    const n2 = await seedNote({
      sourceId: s1.id,
      content: "浮力定律与压强",
      updatedAt: "2026-06-11T00:00:00.000Z" // prefix → first
    });
    const n3 = await seedNote({
      sourceId: s2.id,
      contentType: "quiz",
      content: { question: "什么是浮力?", options: ["A", "B"], answerIndex: 0 },
      updatedAt: "2026-06-12T00:00:00.000Z" // substring, newest → beats n1 in-tier
    });
    const n4 = await seedNote({
      sourceId: s1.id,
      anchorIds: [anchor.id],
      content: "见右侧标注", // content does NOT match — only its anchor quote does
      updatedAt: "2026-06-05T00:00:00.000Z"
    });

    const hits = await searchVault({ vault, sealed }, { q: "浮力" });
    expect(noteHits(hits).map((hit) => hit.id)).toEqual([n2.id, n3.id, n1.id, n4.id]);
    expect(sourceHits(hits).map((hit) => hit.id)).toEqual([s1.id, s2.id]);
    // Notes precede sources in the flat list (the client groups by family anyway).
    expect(hits.findIndex((hit) => hit.family === "source")).toBe(noteHits(hits).length);

    // Source hop info on a note hit (design §1: contentType icon + title + source context).
    const first = noteHits(hits)[0];
    expect(first.contentType).toBe("markdown");
    expect(first.sourceId).toBe(s1.id);
    expect(first.sourceTitle).toBe("浮力实验讲义");
    const anchored = noteHits(hits).find((hit) => hit.id === n1.id);
    expect(anchored?.anchorId).toBe(anchor.id);
  });

  it("anchors surface through their notes: a quote-only hit snippets the QUOTE (design §1)", async () => {
    const source = await seedSource("讲义", "2026-06-01T00:00:00.000Z");
    const anchor = await seedAnchor(source.id, "阿基米德原理指出浮力等于排开液体的重量");
    const note = await seedNote({
      sourceId: source.id,
      anchorIds: [anchor.id],
      content: "见右侧标注",
      updatedAt: "2026-06-05T00:00:00.000Z"
    });

    const hits = await searchVault({ vault, sealed }, { q: "阿基米德" });
    const hit = noteHits(hits).find((candidate) => candidate.id === note.id);
    expect(hit).toBeDefined();
    expect(hit?.snippet).toContain("阿基米德");
    // The note's own text still names the row (its search text is non-empty).
    expect(hit?.title).toBe("见右侧标注");
  });

  it("registry-driven note text: a fixture spec's toSearchText is searchable with zero engine code", async () => {
    const note = await seedNote({
      contentType: "search-fixture",
      content: { label: "能量守恒", body: "机械能转换实验" },
      updatedAt: "2026-06-06T00:00:00.000Z"
    });

    const byLabel = await searchVault({ vault, sealed }, { q: "能量守恒" });
    expect(noteHits(byLabel).map((hit) => hit.id)).toEqual([note.id]);
    expect(noteHits(byLabel)[0].title).toBe("能量守恒"); // first line of the spec's text
    const byBody = await searchVault({ vault, sealed }, { q: "机械能" });
    expect(noteHits(byBody).map((hit) => hit.id)).toEqual([note.id]);
    // A standalone note has no source hop.
    expect(noteHits(byBody)[0].sourceId).toBeUndefined();
  });

  it("caps each family at MAX_HITS_PER_FAMILY (linear scan, no paging in V1)", async () => {
    for (let index = 0; index < MAX_HITS_PER_FAMILY + 5; index += 1) {
      await seedNote({
        content: `capword note ${index}`,
        updatedAt: `2026-06-10T00:00:${String(index % 60).padStart(2, "0")}.000Z`
      });
    }
    const hits = await searchVault({ vault, sealed }, { q: "capword" });
    expect(noteHits(hits).length).toBe(MAX_HITS_PER_FAMILY);
  });

  it("English matching is case-folded", async () => {
    const source = await seedSource("Buoyancy Lab", "2026-06-01T00:00:00.000Z");
    const hits = await searchVault({ vault, sealed }, { q: "buoyancy" });
    expect(sourceHits(hits).map((hit) => hit.id)).toEqual([source.id]);
  });
});

describe("searchVault — SEARCH-2 filters (additive; empty filter = SEARCH-1 parity)", () => {
  it("no-filter path is byte-identical to omitting the filters field", async () => {
    const source = await seedSource("浮力实验讲义", "2026-06-01T00:00:00.000Z");
    await seedNote({ sourceId: source.id, content: "浮力定律与压强", updatedAt: "2026-06-11T00:00:00.000Z" });
    const withoutField = await searchVault({ vault, sealed }, { q: "浮力" });
    const withEmpty = await searchVault({ vault, sealed }, { q: "浮力", filters: {} });
    expect(withEmpty).toEqual(withoutField);
  });

  it("family filter narrows to one family", async () => {
    const source = await seedSource("浮力实验讲义", "2026-06-01T00:00:00.000Z");
    await seedNote({ sourceId: source.id, content: "浮力定律", updatedAt: "2026-06-11T00:00:00.000Z" });
    const onlyNotes = await searchVault({ vault, sealed }, { q: "浮力", filters: { families: ["note"] } });
    expect(onlyNotes.every((hit) => hit.family === "note")).toBe(true);
    const onlySources = await searchVault({ vault, sealed }, { q: "浮力", filters: { families: ["source"] } });
    expect(onlySources.every((hit) => hit.family === "source")).toBe(true);
  });

  it("note contentType filter narrows to allowed types", async () => {
    const md = await seedNote({ content: "浮力笔记", contentType: "markdown", updatedAt: "2026-06-10T00:00:00.000Z" });
    await seedNote({
      contentType: "quiz",
      content: { question: "浮力是什么?", options: ["A", "B"], answerIndex: 0 },
      updatedAt: "2026-06-11T00:00:00.000Z"
    });
    const hits = await searchVault({ vault, sealed }, { q: "浮力", filters: { contentType: ["markdown"] } });
    expect(noteHits(hits).map((hit) => hit.id)).toEqual([md.id]);
  });

  it("sourceType filter narrows source hits", async () => {
    await seedSource("浮力网页", "2026-06-02T00:00:00.000Z"); // html (seedSource default)
    const hits = await searchVault({ vault, sealed }, { q: "浮力", filters: { sourceType: ["pdf"] } });
    expect(sourceHits(hits)).toEqual([]); // none are pdf
    const htmlHits = await searchVault({ vault, sealed }, { q: "浮力", filters: { sourceType: ["html"] } });
    expect(sourceHits(htmlHits).length).toBe(1);
  });

  it("sourceId filter scopes note hits to that source", async () => {
    const s1 = await seedSource("讲义一", "2026-06-01T00:00:00.000Z");
    const s2 = await seedSource("讲义二", "2026-06-02T00:00:00.000Z");
    const n1 = await seedNote({ sourceId: s1.id, content: "浮力A", updatedAt: "2026-06-10T00:00:00.000Z" });
    await seedNote({ sourceId: s2.id, content: "浮力B", updatedAt: "2026-06-11T00:00:00.000Z" });
    const hits = await searchVault({ vault, sealed }, { q: "浮力", filters: { sourceId: s1.id } });
    expect(noteHits(hits).map((hit) => hit.id)).toEqual([n1.id]);
  });

  it("date range filter bounds updatedAt (inclusive)", async () => {
    const older = await seedNote({ content: "浮力旧", updatedAt: "2026-05-01T00:00:00.000Z" });
    const newer = await seedNote({ content: "浮力新", updatedAt: "2026-07-01T00:00:00.000Z" });
    const afterHits = await searchVault({ vault, sealed }, { q: "浮力", filters: { updatedAfter: "2026-06-01T00:00:00.000Z" } });
    expect(noteHits(afterHits).map((hit) => hit.id)).toEqual([newer.id]);
    const beforeHits = await searchVault({ vault, sealed }, { q: "浮力", filters: { updatedBefore: "2026-06-01T00:00:00.000Z" } });
    expect(noteHits(beforeHits).map((hit) => hit.id)).toEqual([older.id]);
  });
});

describe("searchVault — SEARCH-2 pinyin + fuzzy (additive, below every literal tier)", () => {
  it("finds a CJK source title by full pinyin and by initials", async () => {
    const source = await seedSource("浮力", "2026-06-01T00:00:00.000Z");
    const full = await searchVault({ vault, sealed }, { q: "fuli" });
    expect(sourceHits(full).map((hit) => hit.id)).toEqual([source.id]);
    const initials = await searchVault({ vault, sealed }, { q: "fl" });
    expect(sourceHits(initials).map((hit) => hit.id)).toEqual([source.id]);
  });

  it("finds a CJK note by pinyin of its search text", async () => {
    const note = await seedNote({ content: "浮力定律", updatedAt: "2026-06-10T00:00:00.000Z" });
    const hits = await searchVault({ vault, sealed }, { q: "fulidingl" });
    expect(noteHits(hits).map((hit) => hit.id)).toEqual([note.id]);
  });

  it("a literal English hit still outranks a fuzzy typo hit in the same family", async () => {
    const exact = await seedSource("buoyancy", "2026-06-02T00:00:00.000Z"); // literal
    const typo = await seedSource("buoyanci lab", "2026-06-03T00:00:00.000Z"); // fuzzy only
    const hits = await searchVault({ vault, sealed }, { q: "buoyancy" });
    const ids = sourceHits(hits).map((hit) => hit.id);
    expect(ids[0]).toBe(exact.id);
    expect(ids).toContain(typo.id);
  });
});

describe("direct-transport parity (design §2 — mobile searches identically)", () => {
  it("GET /api/search over the direct adapter returns the same hits shape", async () => {
    const source = await seedSource("浮力实验讲义", "2026-06-01T00:00:00.000Z");
    const note = await seedNote({
      sourceId: source.id,
      content: "浮力定律与压强",
      updatedAt: "2026-06-11T00:00:00.000Z"
    });

    const transport = createDirectTransport({ vault, sealed });
    const direct = await transport.request<{ hits: unknown }>("GET", "/api/search?q=%E6%B5%AE%E5%8A%9B");
    const service = await searchVault({ vault, sealed }, { q: "浮力" });
    expect(direct.hits).toEqual(service);
    expect((direct.hits as { id: string }[]).map((hit) => hit.id)).toEqual([note.id, source.id]);
  });

  it("SEARCH-2 filter params travel over the transport identically (family=source)", async () => {
    const source = await seedSource("浮力实验讲义", "2026-06-01T00:00:00.000Z");
    await seedNote({ sourceId: source.id, content: "浮力定律", updatedAt: "2026-06-11T00:00:00.000Z" });
    const transport = createDirectTransport({ vault, sealed });
    const direct = await transport.request<{ hits: unknown }>(
      "GET",
      "/api/search?q=%E6%B5%AE%E5%8A%9B&family=source"
    );
    const service = await searchVault({ vault, sealed }, { q: "浮力", filters: { families: ["source"] } });
    expect(direct.hits).toEqual(service);
    expect((direct.hits as { family: string }[]).every((hit) => hit.family === "source")).toBe(true);
  });
});
