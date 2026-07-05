import type { z } from "zod";
import type { StorageAdapter } from "../storage/adapter";
import type { SnapshotRecord, SnapshotStore } from "./snapshotStore";

/**
 * A hidden close hook on each sqlite-backed store. A DB connection is a process-lifetime
 * resource (like node-pty) — production never closes it — but tests and teardown need to
 * release the file handle (Windows can't unlink an open `.db`/`-wal`). Kept off the public
 * 8-method {@link SnapshotStore} contract via a symbol so the interface stays exactly 8 methods.
 *
 * DECOUPLED from `sqliteEngine.ts` on purpose: `closeSqliteStore` must be importable
 * (by `vault.ts`, `dataTrust.ts`, tests) WITHOUT eagerly loading the better-sqlite3 native
 * binary. `engine.ts` imports NO better-sqlite3, so a jsonl-only user whose native module
 * isn't built for their runtime never trips an ABI-mismatch just by importing the release
 * hook. The symbol is a GLOBAL-registry `Symbol.for(...)`, so sqliteEngine.ts installs the
 * hook under the SAME key and the read here matches.
 *
 * Exported so `sqliteEngine.ts` INSTALLS the hook under the shared constant rather than a
 * duplicate `Symbol.for(...)` — one source of truth for the key.
 */
export const CLOSE = Symbol.for("growhtml.sqliteEngine.close");

/**
 * A hidden dump hook on each sqlite-backed store (STORE-SQL Stage-2, §Stage-2). The `.db` is the
 * RUNTIME truth, but the PACK's source of truth is the `*.jsonl` dumps (spec R2). This lets the
 * data-trust export MATERIALIZE the sqlite rows to their jsonl file BEFORE the whole-dir zip walk.
 * Kept off the public 8-method {@link SnapshotStore} contract via a symbol — same idiom as CLOSE.
 * DECOUPLED from the native module for the same reason as {@link CLOSE} (see above); the actual
 * jsonl WRITE lives INSIDE the hook that sqliteEngine.ts installs, so this module needs no
 * `writeJsonlAtomic` import.
 *
 * Exported so `sqliteEngine.ts` INSTALLS the hook under the shared constant (see {@link CLOSE}).
 */
export const DUMP = Symbol.for("growhtml.sqliteEngine.dump");

/**
 * Close a sqlite-backed store's DB connection if it has one (no-op for other engines).
 *
 * Lives here (not in `sqliteEngine.ts`) so importing it does NOT load better-sqlite3 — it
 * is a pure symbol-dispatcher that reads the hidden {@link CLOSE} hook the sqlite engine
 * installs and calls it. For a jsonl-backed store there is no hook → safe no-op.
 */
export function closeSqliteStore(store: SnapshotStore<SnapshotRecord>): void {
  const hook = (store as Record<symbol, unknown>)[CLOSE];
  if (typeof hook === "function") hook();
}

/**
 * Materialize a store's rows to its jsonl file (STORE-SQL Stage-2, §Stage-2). For a SQLITE-backed
 * store the `.db` is the runtime truth, so the installed {@link DUMP} hook writes
 * `(await store.readWithIssues()).records` (schema-validated, incl. tombstones — the S1 fold) via
 * `writeJsonlAtomic` so the export's whole-dir walk zips a CURRENT, complete jsonl. For any OTHER
 * engine (jsonl — today's default) it is a NO-OP: the jsonl file IS the store, already current — so
 * jsonl-vault backups stay BYTE-IDENTICAL (no surprise compaction / reordering from a redundant
 * rewrite).
 *
 * Lives here (not in `sqliteEngine.ts`) so importing it does NOT load better-sqlite3 — it is a
 * pure symbol-dispatcher; the actual jsonl write happens inside the hook the sqlite engine installs.
 */
export async function dumpStoreToJsonl(
  store: SnapshotStore<SnapshotRecord>,
  jsonlPath: string,
  storage?: StorageAdapter
): Promise<void> {
  const hook = (store as Record<symbol, unknown>)[DUMP];
  if (typeof hook !== "function") return; // not sqlite-backed → the jsonl file is already truth
  await (hook as (jsonlPath: string, storage?: StorageAdapter) => Promise<void>)(jsonlPath, storage);
}

/**
 * STORE-SQL — the pluggable storage seam (docs/implementation/sqlite-migration-build-spec.md §The-seam).
 *
 * A `StoreEngine` builds a per-entity backend that IS the {@link SnapshotStore}
 * 8-method contract. Two engines exist: `jsonlEngine` (today's file-backed body,
 * behavior-identical) and `sqliteEngine` (better-sqlite3). Consumers only ever see
 * the 8-method interface, so the business-logic blast radius is ≈0.
 *
 * KEY CONSTRAINT (§The-seam #5): the engine OWNS its transactions. `upsert` promises
 * "write the row AND its junction rows atomically" and implements the transaction
 * INTERNALLY (sync on desktop better-sqlite3, async on the deferred mobile driver).
 * The interface therefore never exposes a `transaction()` primitive.
 */
export type StoreEngine = <T extends SnapshotRecord>(config: StoreConfig<T>) => SnapshotStore<T>;

/**
 * Everything an engine needs to back one entity store. The jsonl engine reads only
 * `filePath`/`schema`/`sort`/`storage`; the sqlite engine additionally reads `table`,
 * the extracted index `columns`, and any `junctions` (notes' many-to-many links).
 */
export type StoreConfig<T extends SnapshotRecord> = {
  /** JSONL file path (jsonl engine). Also used to derive the sqlite `.db` sibling path if needed. */
  filePath: string;
  schema: z.ZodType<T>;
  sort?: (a: T, b: T) => number;
  storage?: StorageAdapter;

  // —— SQLite-only config (ignored by the jsonl engine) ——
  /** Table name for the sqlite backend (defaults to a slug derived from the file name). */
  table?: string;
  /**
   * Extracted index columns DERIVED from each record on write. The full record always
   * lives in the `json` blob (schemas never need a table migration); these columns only
   * exist to make the store's queries fast/possible. All are nullable (N1: anchor's
   * kind-specific columns; a note without a sourceId).
   */
  columns?: readonly ExtractedColumn<T>[];
  /**
   * Many-to-many junction tables (notes only — §Schema note_anchors/note_concepts/
   * note_layers). Written atomically INSIDE `upsert` (delete-all-then-insert in the same
   * transaction). A soft-delete (upsert WITH deletedAt) KEEPS the junction rows so a
   * restore resurrects the links; only a real `delete()` purge removes them.
   */
  junctions?: readonly JunctionSpec<T>[];
};

/** A DERIVED index column: extract the value for the row from the full record. */
export type ExtractedColumn<T extends SnapshotRecord> = {
  /** Column name (also the SQL identifier — keep it a plain identifier). */
  name: string;
  /** Pull the column value out of the record. Return null/undefined for absent. */
  value: (record: T) => string | number | null | undefined;
  /**
   * `WHERE deletedAt IS NULL` partial index over this column (live-query fast path).
   * `false` ⇒ a plain index (e.g. notes_updated indexes every row for ORDER BY).
   */
  partialLiveIndex?: boolean;
};

/** A many-to-many junction: fan `record[idsField]` out into `<name>(<ownerCol>, <refCol>)` rows. */
export type JunctionSpec<T extends SnapshotRecord> = {
  /** Junction table name (e.g. "note_anchors"). */
  table: string;
  /** The foreign-key column the junction indexes (e.g. "anchorId"). */
  refColumn: string;
  /** Pull the array of referenced ids from the record (e.g. note.anchorIds). */
  refIds: (record: T) => readonly string[] | undefined;
};
