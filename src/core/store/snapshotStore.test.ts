import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fixtureAnchor, fixtureConcept, fixtureNote, fixturePatch } from "../fixtures/golden";
import { createEntityId } from "../ids";
import { noteSchema, patchSchema, type NoteRecord, type PatchRecord } from "../schema";
import { jsonlEngine } from "./jsonlEngine";
import { appendJsonlRecord, readJsonl } from "./jsonl";
import { createSnapshotStore, type SnapshotRecord, type SnapshotStore } from "./snapshotStore";
import { closeSqliteStore, sqliteEngine } from "./sqliteEngine";
import type { StoreEngine } from "./engine";

// —— The crown guard set (§Guards): the SAME invariant suite parameterized over BOTH engines.
// jsonl (today's file body, extracted unchanged) and sqlite (better-sqlite3) must pass IDENTICALLY.
// Each engine gets a temp dir; jsonl backs a real file, sqlite backs a temp-file `.db` (so the
// `.jsonl→.db` path derivation is exercised, not just `:memory:`).
const engines: ReadonlyArray<{ name: string; engine: StoreEngine }> = [
  { name: "jsonl", engine: jsonlEngine },
  { name: "sqlite", engine: sqliteEngine }
];

describe.each(engines)("snapshot store [$name engine]", ({ name, engine }) => {
  let tempDir = "";
  let store: SnapshotStore<PatchRecord>;
  let filePath = "";

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "study-vault-store-"));
    filePath = path.join(tempDir, "patches.jsonl");
    store = createSnapshotStore({ filePath, schema: patchSchema, table: "patches", engine });
  });

  afterEach(async () => {
    closeSqliteStore(store as SnapshotStore<SnapshotRecord>);
    await rm(tempDir, { recursive: true, force: true });
  });

  it("upserts and reads records", async () => {
    await store.upsert(fixturePatch);

    expect(await store.get(fixturePatch.id)).toEqual(fixturePatch);
    expect(await store.list()).toEqual([fixturePatch]);
  });

  it("updates an existing record by id", async () => {
    await store.upsert(fixturePatch);
    const applied = {
      ...fixturePatch,
      status: "applied" as const,
      updatedAt: "2026-06-23T00:01:00.000Z",
      appliedAt: "2026-06-23T00:01:00.000Z"
    };

    await store.upsert(applied);

    expect(await store.list()).toEqual([applied]);
    expect((await store.get(fixturePatch.id))?.status).toBe("applied");
  });

  it("deletes records by id", async () => {
    await store.upsert(fixturePatch);

    expect(await store.delete(fixturePatch.id)).toBe(true);
    expect(await store.delete(fixturePatch.id)).toBe(false);
    expect(await store.list()).toEqual([]);
  });

  it("does not lose records under concurrent upserts", async () => {
    const records = Array.from({ length: 25 }, () => ({
      ...fixturePatch,
      id: createEntityId("patch")
    }));

    await Promise.all(records.map((record) => store.upsert(record)));

    const stored = await store.list();
    expect(stored).toHaveLength(records.length);
    expect(new Set(stored.map((record) => record.id))).toEqual(new Set(records.map((record) => record.id)));
  });

  // —— TRUST-3 soft delete (deletedAt tombstones, docs/design/data-trust.md §3) ——

  it("excludes tombstoned records from list()/get() but serves them via listTrashed()/getAny()", async () => {
    const trashed = { ...fixturePatch, deletedAt: "2026-07-04T00:00:00.000Z", updatedAt: "2026-07-04T00:00:00.000Z" };
    await store.upsert(trashed);

    expect(await store.list()).toEqual([]);
    expect(await store.get(fixturePatch.id)).toBeNull();
    expect(await store.listTrashed()).toEqual([trashed]);
    expect(await store.getAny(fixturePatch.id)).toEqual(trashed);
    // The raw read (compaction path) still sees everything.
    expect((await store.readWithIssues()).records).toEqual([trashed]);
  });

  it("keeps tombstones through compaction (rewrites triggered by other writes)", async () => {
    const trashed = { ...fixturePatch, deletedAt: "2026-07-04T00:00:00.000Z", updatedAt: "2026-07-04T00:00:00.000Z" };
    await store.upsert(trashed);

    // Unrelated upsert + delete both rewrite the whole file — the tombstone must survive.
    const other = { ...fixturePatch, id: createEntityId("patch") };
    await store.upsert(other);
    await store.delete(other.id);

    expect(await store.getAny(trashed.id)).toEqual(trashed);
    expect(await store.list()).toEqual([]);
  });

  it("delete() REALLY removes a tombstoned record (the purge path)", async () => {
    const trashed = { ...fixturePatch, deletedAt: "2026-07-04T00:00:00.000Z", updatedAt: "2026-07-04T00:00:00.000Z" };
    await store.upsert(trashed);

    expect(await store.delete(trashed.id)).toBe(true);
    expect(await store.getAny(trashed.id)).toBeNull();
    expect(await store.listTrashed()).toEqual([]);
  });

  it("restores by upserting the record without deletedAt", async () => {
    const trashed = { ...fixturePatch, deletedAt: "2026-07-04T00:00:00.000Z", updatedAt: "2026-07-04T00:00:00.000Z" };
    await store.upsert(trashed);

    const { deletedAt: _gone, ...restored } = { ...trashed, updatedAt: "2026-07-05T00:00:00.000Z" };
    await store.upsert(restored as PatchRecord);

    expect(await store.get(fixturePatch.id)).toEqual(restored);
    expect(await store.listTrashed()).toEqual([]);
  });

  // Order parity: the jsonl default sort (updatedAt then id) must be replicated by the sqlite
  // ORDER BY so consumers relying on order don't break across engines.
  it("returns list() sorted by updatedAt then id", async () => {
    const a = { ...fixturePatch, id: "patch_00000000000000000000000000", updatedAt: "2026-06-23T00:00:02.000Z" };
    const b = { ...fixturePatch, id: "patch_11111111111111111111111111", updatedAt: "2026-06-23T00:00:01.000Z" };
    const c = { ...fixturePatch, id: "patch_22222222222222222222222222", updatedAt: "2026-06-23T00:00:01.000Z" };
    await store.upsert(a);
    await store.upsert(b);
    await store.upsert(c);

    // b & c share updatedAt → tie-broken by id (b < c); a is latest.
    expect((await store.list()).map((r) => r.id)).toEqual([b.id, c.id, a.id]);
  });

  if (name === "jsonl") {
    // Malformed-line tolerance + atomic-rewrite hygiene are JSONL-file specifics (a `.db` has no
    // torn-line or temp-leftover concept). Kept for the jsonl engine only.
    it("tolerates malformed lines and preserves valid records", async () => {
      await writeFile(filePath, `${JSON.stringify(fixturePatch)}\nnot-json\n`, "utf8");

      const result = await store.readWithIssues();

      expect(result.records).toEqual([fixturePatch]);
      expect(result.issues).toHaveLength(1);
    });

    it("rewrites snapshots atomically without temp leftovers", async () => {
      await store.upsert(fixturePatch);

      const files = await readdir(tempDir);
      const text = await readFile(filePath, "utf8");

      expect(files).toEqual(["patches.jsonl"]);
      expect(() => JSON.parse(text.trim())).not.toThrow();
    });
  }

  if (name === "sqlite") {
    // S1 (adversarial-review fold): the sqlite read path VALIDATES each blob against the schema
    // (parity with jsonl's readJsonl) — an invalid stored blob is dropped from records + reported
    // as an issue, and single-row reads return null, so a caller can never receive an unvalidated
    // record. Inject bad rows directly through a second handle (bypassing the schema-checked upsert).
    it("validates blobs on read: drops + reports schema-invalid and non-JSON rows", async () => {
      const { default: Database } = await import("better-sqlite3");
      await store.upsert(fixturePatch); // one good row

      const dbPath = filePath.replace(/\.jsonl$/, ".db");
      const inject = new Database(dbPath);
      try {
        const stmt = inject.prepare(`INSERT INTO "patches" (id, updatedAt, deletedAt, json) VALUES (?, ?, NULL, ?)`);
        // (a) valid JSON, schema-invalid (missing required fields).
        stmt.run("patch_bad_schema", "2026-06-23T00:00:03.000Z", JSON.stringify({ id: "patch_bad_schema", nope: true }));
        // (b) not even valid JSON.
        stmt.run("patch_bad_json", "2026-06-23T00:00:04.000Z", "{not json");
      } finally {
        inject.close();
      }

      const result = await store.readWithIssues();
      expect(result.records).toEqual([fixturePatch]); // only the valid row survives
      expect(result.issues).toHaveLength(2); // both bad rows reported, not silently returned
      expect(await store.list()).toEqual([fixturePatch]);
      expect(await store.get("patch_bad_schema")).toBeNull();
      expect(await store.getAny("patch_bad_json")).toBeNull();
    });

    it("refuses a custom config.sort (can't be pushed into ORDER BY — would silently diverge)", () => {
      expect(() =>
        createSnapshotStore({
          filePath,
          schema: patchSchema,
          table: "patches_sorted",
          engine,
          sort: (a, b) => a.id.localeCompare(b.id)
        })
      ).toThrow(/custom config.sort/);
    });
  }
});

// —— Junction-integrity guard (§Guards #2, sqlite notes config) — the ONE specialization.
// A note's anchorIds/conceptIds/layerIds fan out into note_anchors/note_concepts/note_layers
// atomically inside upsert; a soft-delete KEEPS the junction rows (restore resurrects the links);
// only a real delete() purge removes them.
describe("sqlite junction integrity (notes)", () => {
  let tempDir = "";
  let store: SnapshotStore<NoteRecord>;

  const layerId = "layer_01ARZ3NDEKTSV4RRFFQ69G5FB2";
  // A note carrying all three id kinds + the DEPRECATED singular note.layerId (N2) which MUST
  // round-trip losslessly through the json blob.
  const note: NoteRecord = noteSchema.parse({
    ...fixtureNote,
    anchorIds: [fixtureAnchor.id],
    conceptIds: [fixtureConcept.id],
    layerIds: [layerId],
    layerId // legacy singular — carried in the blob, never a column
  });

  const notesConfig = {
    table: "notes",
    columns: [
      { name: "sourceId", value: (n: NoteRecord) => n.sourceId ?? null },
      { name: "contentType", value: (n: NoteRecord) => n.contentType }
    ],
    junctions: [
      { table: "note_anchors", refColumn: "anchorId", refIds: (n: NoteRecord) => n.anchorIds },
      { table: "note_concepts", refColumn: "conceptId", refIds: (n: NoteRecord) => n.conceptIds },
      { table: "note_layers", refColumn: "layerId", refIds: (n: NoteRecord) => n.layerIds }
    ]
  } as const;

  // Query the junctions directly through a second sqlite handle over the same file — this is
  // the projection a `listNotes`-by-anchor/concept/layer would JOIN against.
  function junctionOwners(db: import("better-sqlite3").Database, table: string, ref: string, id: string): string[] {
    return (db.prepare(`SELECT ownerId FROM ${table} WHERE ${ref} = ?`).all(id) as { ownerId: string }[]).map(
      (r) => r.ownerId
    );
  }

  let dbPath = "";
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "study-vault-junction-"));
    const filePath = path.join(tempDir, "notes.jsonl");
    dbPath = path.join(tempDir, "notes.db");
    store = createSnapshotStore({ filePath, schema: noteSchema, engine: sqliteEngine, ...notesConfig });
  });

  afterEach(async () => {
    closeSqliteStore(store as SnapshotStore<SnapshotRecord>);
    await rm(tempDir, { recursive: true, force: true });
  });

  it("fans junctions out on upsert; keeps them through soft-delete/restore; purges them on delete()", async () => {
    const { default: Database } = await import("better-sqlite3");

    // 1. upsert → the three junctions resolve the note by anchor/concept/layer.
    await store.upsert(note);
    const probe = new Database(dbPath, { readonly: true });
    try {
      expect(junctionOwners(probe, "note_anchors", "anchorId", fixtureAnchor.id)).toEqual([note.id]);
      expect(junctionOwners(probe, "note_concepts", "conceptId", fixtureConcept.id)).toEqual([note.id]);
      expect(junctionOwners(probe, "note_layers", "layerId", layerId)).toEqual([note.id]);
    } finally {
      probe.close();
    }
    // Legacy singular layerId survived the blob round-trip.
    expect((await store.get(note.id))?.layerId).toBe(layerId);

    // 2. soft-delete (upsert WITH deletedAt) → junction rows SURVIVE the tombstone;
    //    the note is absent from list() but present in listTrashed()/getAny().
    const trashed: NoteRecord = { ...note, deletedAt: "2026-07-05T00:00:00.000Z", updatedAt: "2026-07-05T00:00:00.000Z" };
    await store.upsert(trashed);
    expect(await store.list()).toEqual([]);
    expect(await store.get(note.id)).toBeNull();
    expect((await store.listTrashed()).map((n) => n.id)).toEqual([note.id]);
    expect((await store.getAny(note.id))?.id).toBe(note.id);

    const afterSoftDelete = new Database(dbPath, { readonly: true });
    try {
      expect(junctionOwners(afterSoftDelete, "note_anchors", "anchorId", fixtureAnchor.id)).toEqual([note.id]);
      expect(junctionOwners(afterSoftDelete, "note_concepts", "conceptId", fixtureConcept.id)).toEqual([note.id]);
      expect(junctionOwners(afterSoftDelete, "note_layers", "layerId", layerId)).toEqual([note.id]);
    } finally {
      afterSoftDelete.close();
    }

    // 3. restore (upsert WITHOUT deletedAt) → links intact, note live again.
    const { deletedAt: _gone, ...restored } = { ...trashed, updatedAt: "2026-07-06T00:00:00.000Z" };
    await store.upsert(restored as NoteRecord);
    expect((await store.list()).map((n) => n.id)).toEqual([note.id]);
    const afterRestore = new Database(dbPath, { readonly: true });
    try {
      expect(junctionOwners(afterRestore, "note_anchors", "anchorId", fixtureAnchor.id)).toEqual([note.id]);
      expect(junctionOwners(afterRestore, "note_layers", "layerId", layerId)).toEqual([note.id]);
    } finally {
      afterRestore.close();
    }

    // 4. real delete() purge → junctions gone.
    expect(await store.delete(note.id)).toBe(true);
    const afterPurge = new Database(dbPath, { readonly: true });
    try {
      expect(junctionOwners(afterPurge, "note_anchors", "anchorId", fixtureAnchor.id)).toEqual([]);
      expect(junctionOwners(afterPurge, "note_concepts", "conceptId", fixtureConcept.id)).toEqual([]);
      expect(junctionOwners(afterPurge, "note_layers", "layerId", layerId)).toEqual([]);
    } finally {
      afterPurge.close();
    }
    expect(await store.getAny(note.id)).toBeNull();
  });

  it("rewrites junctions on edit — a removed anchor id drops its junction row", async () => {
    const secondAnchor = "anchor_01ARZ3NDEKTSV4RRFFQ69G5FZZ";
    await store.upsert({ ...note, anchorIds: [fixtureAnchor.id, secondAnchor] });
    await store.upsert({ ...note, anchorIds: [secondAnchor], updatedAt: "2026-07-05T00:00:00.000Z" });

    const { default: Database } = await import("better-sqlite3");
    const probe = new Database(dbPath, { readonly: true });
    try {
      expect(junctionOwners(probe, "note_anchors", "anchorId", fixtureAnchor.id)).toEqual([]);
      expect(junctionOwners(probe, "note_anchors", "anchorId", secondAnchor)).toEqual([note.id]);
    } finally {
      probe.close();
    }
  });
});

describe("append-only logs", () => {
  it("appends records without snapshot dedupe", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "study-vault-store-log-"));
    try {
      const logPath = path.join(tempDir, "ai-calls.jsonl");
      await appendJsonlRecord(logPath, fixturePatch);
      await appendJsonlRecord(logPath, { ...fixturePatch, status: "reverted" });

      const result = await readJsonl(logPath, patchSchema);

      expect(result.records.map((record) => record.status)).toEqual(["pending", "reverted"]);
      expect(result.issues).toEqual([]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
