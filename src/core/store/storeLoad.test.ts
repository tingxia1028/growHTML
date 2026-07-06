// STORE-SQL Stage-3 (docs/implementation/sqlite-migration-build-spec.md §Stage-3) — the
// jsonl→backend LOADER (`loadStoreFromJsonl`) + `StudyVault.reopen()`, the two mechanisms that
// make vault IMPORT/RESTORE work on the sqlite runtime.
//
//   - loadStoreFromJsonl is the SYMMETRIC inverse of dumpStoreToJsonl: on a sqlite store it pumps a
//     jsonl file's records into the (freshly-swapped-in, empty) `.db`, rebuilding note junctions;
//     on a jsonl store it is a NO-OP (the jsonl file IS the store — a rewrite would break the
//     byte-identical-backup guarantee, guarded elsewhere).
//   - reopen() rebuilds the entity stores in place so a post-swap read hits FRESH handles.

import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fixtureAnchor, fixtureConcept, fixtureNote, fixturePatch } from "../fixtures/golden";
import { noteSchema, patchSchema, type NoteRecord } from "../schema";
import { openTestVault } from "../testing/openTestVault";
import { createSnapshotStore, type SnapshotRecord, type SnapshotStore } from "./snapshotStore";
import { sqliteEngine } from "./sqliteEngine";
import { jsonlEngine } from "./jsonlEngine";
import { closeSqliteStore, loadStoreFromJsonl } from "./engine";
import { writeJsonlAtomic } from "./jsonl";
import { nodeStorage } from "../storage/nodeStorage";

const cleanups: string[] = [];
async function tmpDir(tag: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), `store-load-${tag}-`));
  cleanups.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of cleanups.splice(0)) await rm(dir, { recursive: true, force: true });
});

// Query a junction directly through a second sqlite handle over the same file — the projection a
// `listNotes`-by-anchor JOIN reads against. Proves the load REBUILT the junctions, not just the row.
function junctionOwners(db: import("better-sqlite3").Database, table: string, ref: string, id: string): string[] {
  return (db.prepare(`SELECT ownerId FROM ${table} WHERE ${ref} = ?`).all(id) as { ownerId: string }[]).map(
    (r) => r.ownerId
  );
}

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

describe("loadStoreFromJsonl (STORE-SQL Stage-3)", () => {
  it("sqlite: pumps a jsonl file into the fresh .db — record + junctions rebuilt", async () => {
    const dir = await tmpDir("sqlite");
    const jsonlPath = path.join(dir, "notes.jsonl");
    const dbPath = path.join(dir, "notes.db");
    const layerId = "layer_01ARZ3NDEKTSV4RRFFQ69G5FB2";
    const note: NoteRecord = noteSchema.parse({
      ...fixtureNote,
      anchorIds: [fixtureAnchor.id],
      conceptIds: [fixtureConcept.id],
      layerIds: [layerId],
      layerId // legacy singular — must round-trip through the blob
    });
    // A jsonl file on disk (the swapped-in pack truth), and a FRESH empty sqlite store over it.
    await writeJsonlAtomic(jsonlPath, [note], nodeStorage);
    const store = createSnapshotStore({ filePath: jsonlPath, schema: noteSchema, storage: nodeStorage, engine: sqliteEngine, ...notesConfig });
    try {
      // Before load the .db is empty (the pack ships jsonl only, never the .db cache).
      expect(await store.list()).toEqual([]);

      await loadStoreFromJsonl(store as SnapshotStore<SnapshotRecord>, jsonlPath);

      // The record is now queryable through the store API …
      const loaded = await store.list();
      expect(loaded).toHaveLength(1);
      expect(loaded[0].id).toBe(note.id);
      expect(loaded[0].anchorIds).toEqual([fixtureAnchor.id]);
      expect(loaded[0].conceptIds).toEqual([fixtureConcept.id]);
      expect(loaded[0].layerId).toBe(layerId); // legacy singular survived
      // … and the note_anchors/note_concepts/note_layers junctions were rebuilt from the arrays.
      const { default: Database } = await import("better-sqlite3");
      const probe = new Database(dbPath, { readonly: true });
      try {
        expect(junctionOwners(probe, "note_anchors", "anchorId", fixtureAnchor.id)).toEqual([note.id]);
        expect(junctionOwners(probe, "note_concepts", "conceptId", fixtureConcept.id)).toEqual([note.id]);
        expect(junctionOwners(probe, "note_layers", "layerId", layerId)).toEqual([note.id]);
      } finally {
        probe.close();
      }
    } finally {
      closeSqliteStore(store as SnapshotStore<SnapshotRecord>);
    }
  });

  it("sqlite: is idempotent (a second load is upsert-by-PK — no duplicate rows/junctions)", async () => {
    const dir = await tmpDir("idempotent");
    const jsonlPath = path.join(dir, "notes.jsonl");
    const note: NoteRecord = noteSchema.parse({ ...fixtureNote, anchorIds: [fixtureAnchor.id] });
    await writeJsonlAtomic(jsonlPath, [note], nodeStorage);
    const store = createSnapshotStore({ filePath: jsonlPath, schema: noteSchema, storage: nodeStorage, engine: sqliteEngine, ...notesConfig });
    try {
      await loadStoreFromJsonl(store as SnapshotStore<SnapshotRecord>, jsonlPath);
      await loadStoreFromJsonl(store as SnapshotStore<SnapshotRecord>, jsonlPath);
      expect(await store.list()).toHaveLength(1);
      const { default: Database } = await import("better-sqlite3");
      const probe = new Database(path.join(dir, "notes.db"), { readonly: true });
      try {
        expect(junctionOwners(probe, "note_anchors", "anchorId", fixtureAnchor.id)).toEqual([note.id]);
      } finally {
        probe.close();
      }
    } finally {
      closeSqliteStore(store as SnapshotStore<SnapshotRecord>);
    }
  });

  it("jsonl engine: is a NO-OP — does not rewrite the jsonl file (byte-identical guarantee)", async () => {
    const dir = await tmpDir("jsonl-noop");
    const jsonlPath = path.join(dir, "patches.jsonl");
    // Write with an unusual-but-valid serialization the loader would NORMALIZE if it rewrote.
    const raw = `${JSON.stringify(fixturePatch)}\n`;
    await writeFile(jsonlPath, raw, "utf8");
    const store = createSnapshotStore({ filePath: jsonlPath, schema: patchSchema, table: "patches", storage: nodeStorage, engine: jsonlEngine });

    await loadStoreFromJsonl(store as SnapshotStore<SnapshotRecord>, jsonlPath);

    // No LOAD hook on a jsonl store → the file is untouched (a rewrite would trip the
    // byte-identical-backup test), yet the store still reads its records directly from disk.
    const { readFile } = await import("node:fs/promises");
    expect(await readFile(jsonlPath, "utf8")).toBe(raw);
    expect((await store.list()).map((p) => p.id)).toEqual([fixturePatch.id]);
  });
});

describe("StudyVault.reopen() (STORE-SQL Stage-3)", () => {
  it("write → close → reopen: data still queryable + a fresh write works (sqlite default)", async () => {
    const dir = await tmpDir("reopen");
    const vault = await openTestVault({ rootDir: dir });
    try {
      const { fixtureSource } = await import("../fixtures/golden");
      await vault.stores.sources.upsert(fixtureSource);
      expect((await vault.stores.sources.get(fixtureSource.id))?.id).toBe(fixtureSource.id);

      // Release the handles (the import prerequisite) …
      vault.close();
      // … then reopen against whatever is now on disk (here: the same, unchanged dir).
      vault.reopen();

      // The persisted row is still queryable through the FRESH handle …
      expect((await vault.stores.sources.get(fixtureSource.id))?.id).toBe(fixtureSource.id);
      // … and a fresh write against the reopened store works (proves the handle is live, not stale).
      const second = { ...fixtureSource, id: "src_01ARZ3NDEKTSV4RRFFQ69G5FZZ", updatedAt: "2026-07-06T00:00:00.000Z" };
      await vault.stores.sources.upsert(second);
      expect((await vault.stores.sources.list()).map((s) => s.id).sort()).toEqual([fixtureSource.id, second.id].sort());

      // The .db is deletable after a final close() — the reopened handles were released too.
      vault.close();
      const dbPath = path.join(vault.paths.studyDir, "sources.db");
      const moved = `${dbPath}.moved`;
      await expect(rename(dbPath, moved)).resolves.toBeUndefined();
      await expect(rm(moved, { force: true })).resolves.toBeUndefined();
      expect(existsSync(dbPath)).toBe(false);
    } finally {
      vault.close();
    }
  });

  it("reopen WITHOUT a preceding close() self-closes the old backends — no leaked handle (sqlite default)", async () => {
    const dir = await tmpDir("reopen-noclose");
    const vault = await openTestVault({ rootDir: dir });
    try {
      const { fixtureSource } = await import("../fixtures/golden");
      await vault.stores.sources.upsert(fixtureSource);

      // Reopen WITHOUT close() first. reopen() must self-close the OLD handles; otherwise they orphan
      // (a later close() iterates only the CURRENT stores, never the orphans) and the .db stays locked.
      vault.reopen();
      expect((await vault.stores.sources.get(fixtureSource.id))?.id).toBe(fixtureSource.id);

      // A single close() now releases everything — the .db is renamable/deletable, proving no orphaned
      // pre-reopen handle survived (under a non-self-closing reopen() this rename would EPERM on Windows).
      vault.close();
      const dbPath = path.join(vault.paths.studyDir, "sources.db");
      const moved = `${dbPath}.moved`;
      await expect(rename(dbPath, moved)).resolves.toBeUndefined();
      await expect(rm(moved, { force: true })).resolves.toBeUndefined();
      expect(existsSync(dbPath)).toBe(false);
    } finally {
      vault.close();
    }
  });
});
