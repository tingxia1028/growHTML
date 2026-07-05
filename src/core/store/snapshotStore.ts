import type { StoreConfig, StoreEngine } from "./engine";
import type { JsonlReadResult } from "./jsonl";
import { jsonlEngine } from "./jsonlEngine";

export type SnapshotRecord = {
  id: string;
  updatedAt: string;
  /**
   * TRUST-3 soft delete (docs/design/data-trust.md §3): set ⇒ the record is in
   * the recycle bin. `list()`/`get()` exclude tombstoned records so EVERY
   * consumer (list/search/queue/digest/svpack-export/report) hides them for
   * free; the trash surfaces read them explicitly via `listTrashed()`/`getAny()`.
   */
  deletedAt?: string;
};

export type SnapshotStore<T extends SnapshotRecord> = {
  /** LIVE records only — soft-deleted (deletedAt) records are excluded. */
  list(): Promise<T[]>;
  /** Recycle-bin records only (deletedAt set) — the TRUST-3 trash surfaces. */
  listTrashed(): Promise<T[]>;
  /** ALL records (live + tombstoned) with parse issues — the compaction-safe raw read. */
  readWithIssues(): Promise<JsonlReadResult<T>>;
  /** A LIVE record by id (a tombstoned record reads as absent). */
  get(id: string): Promise<T | null>;
  /** A record by id whether live or tombstoned (restore/purge need the bin). */
  getAny(id: string): Promise<T | null>;
  upsert(record: T): Promise<T>;
  /** REAL delete (TRUST-3 purge / non-trash entities). Soft delete = upsert with deletedAt. */
  delete(id: string): Promise<boolean>;
};

/**
 * Build one entity store behind the 8-method {@link SnapshotStore} contract.
 *
 * STORE-SQL Stage-1 (docs/implementation/sqlite-migration-build-spec.md §The-seam): the
 * store body is now delegated to a pluggable {@link StoreEngine}. The DEFAULT engine is
 * `jsonlEngine` (today's file-backed behavior, extracted UNCHANGED), so the running app is
 * byte-for-byte identical until a caller explicitly passes `sqliteEngine`. The extra
 * `StoreConfig` fields (`table`/`columns`/`junctions`) are ignored by the jsonl engine and
 * only consumed by the sqlite engine.
 */
export function createSnapshotStore<T extends SnapshotRecord>(
  input: StoreConfig<T> & { engine?: StoreEngine }
): SnapshotStore<T> {
  const engine = input.engine ?? jsonlEngine;
  return engine(input);
}
