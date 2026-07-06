// STORE-SQL Stage-5 engine-level GUARD (docs/implementation/sqlite-migration-build-spec.md §Stage-5)
// — the FTS5 row is kept in LOCKSTEP with the envelope row inside the engine-owned upsert/delete:
// created on a live upsert, updated on re-upsert, DROPPED on soft-delete (tombstone) and on a real
// purge. The FTS document includes the note's toSearchText AND its denormalized anchor QUOTES (a
// quote-only note is still an FTS candidate). Anchors resolve their quotes through the sibling store
// wired by createEntityStores (via openVault). We probe via `ftsSearchStore` (the same seam the
// search service uses) so the test exercises the real MATCH path, not a private helper.
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEntityId } from "../ids";
import { anchorSchema, noteSchema, type AnchorRecord, type NoteRecord } from "../schema";
import type { SnapshotRecord, SnapshotStore } from "./snapshotStore";
import { ftsSearchStore } from "./engine";
import { type StudyVault } from "../vault";
import { openTestVault } from "../testing/openTestVault";

const stamp = (iso: string) => ({ createdAt: iso, updatedAt: iso });

let dir = "";
let vault: StudyVault;
const priorEngine = process.env.STORE_ENGINE;

beforeEach(async () => {
  delete process.env.STORE_ENGINE; // unset ⇒ sqlite (the default) — this suite is sqlite-specific
  dir = await mkdtemp(path.join(os.tmpdir(), "sqlite-fts-"));
  vault = await openTestVault({ rootDir: dir });
});

afterEach(async () => {
  vault?.close();
  await rm(dir, { recursive: true, force: true });
  if (priorEngine === undefined) delete process.env.STORE_ENGINE;
  else process.env.STORE_ENGINE = priorEngine;
});

// vault.stores.X are SnapshotStore<ConcreteRecord>; the FTS seam takes the base record shape (it
// only ever reads ids), so cast at the seam — the same cast the search service uses.
function fts(store: SnapshotStore<{ id: string; updatedAt: string; deletedAt?: string }>, query: string): string[] | null {
  return ftsSearchStore(store as SnapshotStore<SnapshotRecord>, query);
}

async function seedNote(input: { id?: string; anchorIds?: string[]; content: unknown; contentType?: string; deletedAt?: string }): Promise<NoteRecord> {
  const record = noteSchema.parse({
    id: input.id ?? createEntityId("note"),
    type: "note",
    schemaVersion: 1,
    ...stamp("2026-06-10T00:00:00.000Z"),
    ...(input.deletedAt ? { deletedAt: input.deletedAt } : {}),
    createdBy: "user",
    anchorIds: input.anchorIds ?? [],
    contentType: input.contentType ?? "markdown",
    content: input.content,
    visibility: "private"
  });
  await vault.stores.notes.upsert(record);
  return record;
}

async function seedAnchor(quote: string, id = createEntityId("anchor")): Promise<AnchorRecord> {
  const record = anchorSchema.parse({
    id, type: "anchor", schemaVersion: 1, ...stamp("2026-06-01T00:00:00.000Z"),
    createdBy: "user", sourceId: createEntityId("source"),
    anchorKind: "html_selection", quote, studyId: "p-1", selector: '[data-study-id="p-1"]'
  });
  await vault.stores.anchors.upsert(record);
  return record;
}

describe("sqlite FTS — row lockstep with the envelope (create / update / delete)", () => {
  it("a live note upsert creates an FTS row matchable by its toSearchText", async () => {
    const note = await seedNote({ content: "浮力定律与压强" });
    expect(fts(vault.stores.notes, "浮力定律")).toEqual([note.id]);
  });

  it("re-upserting a note UPDATES its FTS doc (old text no longer matches, new text does)", async () => {
    const note = await seedNote({ content: "浮力定律与压强" });
    await vault.stores.notes.upsert({ ...note, content: "牛顿第二定律", updatedAt: "2026-06-11T00:00:00.000Z" });
    expect(fts(vault.stores.notes, "浮力定律")).toEqual([]); // stale text gone
    expect(fts(vault.stores.notes, "牛顿第二")).toEqual([note.id]); // new text indexed
  });

  it("a soft-delete (tombstone) DROPS the FTS row — a MATCH never returns a trashed note", async () => {
    const note = await seedNote({ content: "浮力定律与压强" });
    expect(fts(vault.stores.notes, "浮力定律")).toEqual([note.id]);
    await vault.stores.notes.upsert({ ...note, deletedAt: "2026-06-12T00:00:00.000Z", updatedAt: "2026-06-12T00:00:00.000Z" });
    expect(fts(vault.stores.notes, "浮力定律")).toEqual([]);
    // Restoring (clearing the tombstone) re-creates the FTS row.
    await vault.stores.notes.upsert({ ...note, updatedAt: "2026-06-13T00:00:00.000Z" });
    expect(fts(vault.stores.notes, "浮力定律")).toEqual([note.id]);
  });

  it("a real purge (delete) DROPS the FTS row", async () => {
    const note = await seedNote({ content: "浮力定律与压强" });
    expect(fts(vault.stores.notes, "浮力定律")).toEqual([note.id]);
    await vault.stores.notes.delete(note.id);
    expect(fts(vault.stores.notes, "浮力定律")).toEqual([]);
  });
});

describe("sqlite FTS — the note document includes toSearchText AND denormalized anchor quotes", () => {
  it("a quote-only note (content does not match) IS an FTS candidate via its anchor quote", async () => {
    const anchor = await seedAnchor("阿基米德原理指出浮力等于排开液体的重量");
    const note = await seedNote({ anchorIds: [anchor.id], content: "见右侧标注" });
    // The query hits ONLY the denormalized quote, not the content.
    expect(fts(vault.stores.notes, "阿基米德")).toEqual([note.id]);
    // The content still indexes too (a superset doc).
    expect(fts(vault.stores.notes, "见右侧标注")).toEqual([note.id]);
  });

  it("a note referencing an anchor created AFTER it picks up the quote via the anchor's fan-out", async () => {
    const anchorId = createEntityId("anchor");
    // Note first, referencing an anchor that does not exist yet → its doc has no quote yet.
    const note = await seedNote({ anchorIds: [anchorId], content: "见右侧标注" });
    expect(fts(vault.stores.notes, "阿基米德")).toEqual([]);
    // Now the anchor is created → its upsert fans out to refresh the referencing note's FTS doc.
    await seedAnchor("阿基米德原理指出浮力", anchorId);
    expect(fts(vault.stores.notes, "阿基米德")).toEqual([note.id]);
  });

  it("the source FTS doc includes title + sourceType", async () => {
    // Seeded via the notes/anchors helpers elsewhere; here assert the sources store is FTS-backed
    // and matches its title. (sourceType is ASCII so it is only reachable by a non-CJK scan query.)
    const { sourceSchema } = await import("../schema");
    const record = sourceSchema.parse({
      id: createEntityId("source"), type: "source", schemaVersion: 1, ...stamp("2026-06-01T00:00:00.000Z"),
      createdBy: "user", sourceType: "html", title: "浮力实验讲义",
      path: `sources/${createEntityId("source")}.html`, contentHash: `sha256:${"a".repeat(64)}`
    });
    await vault.stores.sources.upsert(record);
    expect(fts(vault.stores.sources, "浮力实验")).toEqual([record.id]);
  });
});

describe("sqlite FTS — non-FTS stores return null (scan fallback), jsonl too", () => {
  it("ftsSearchStore on a store WITHOUT an fts table returns null (⇒ caller scans)", () => {
    // patches has no fts config → no FTS_SEARCH hook → null (distinct from an empty match array).
    expect(fts(vault.stores.patches, "anything")).toBeNull();
    // anchors expose the quote reader but have NO own FTS table → also null.
    expect(fts(vault.stores.anchors, "阿基米德")).toBeNull();
  });
});
