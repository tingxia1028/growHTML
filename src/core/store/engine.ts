import type { z } from "zod";
import type { StorageAdapter } from "../storage/adapter";
import type { SnapshotRecord, SnapshotStore } from "./snapshotStore";

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
