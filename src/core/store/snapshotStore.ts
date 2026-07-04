import type { z } from "zod";
import type { StorageAdapter } from "../storage/adapter";
import { nodeStorage } from "../storage/nodeStorage";
import { readJsonl, writeJsonlAtomic, type JsonlReadResult } from "./jsonl";

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

export function createSnapshotStore<T extends SnapshotRecord>(input: {
  filePath: string;
  schema: z.ZodType<T>;
  sort?: (a: T, b: T) => number;
  storage?: StorageAdapter;
}): SnapshotStore<T> {
  const storage = input.storage ?? nodeStorage;
  const sortRecords =
    input.sort ??
    ((a: T, b: T) => {
      const byDate = a.updatedAt.localeCompare(b.updatedAt);
      return byDate === 0 ? a.id.localeCompare(b.id) : byDate;
    });

  // Serialize read-modify-write so concurrent upsert/delete calls cannot clobber each other
  // (atomic rename prevents torn files but NOT lost updates).
  let writeChain: Promise<unknown> = Promise.resolve();
  function withLock<R>(fn: () => Promise<R>): Promise<R> {
    const run = writeChain.then(fn, fn);
    writeChain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  // Compaction-aware by construction: dedupe (and therefore every rewrite that
  // upsert/delete performs) keeps tombstoned records — a soft-deleted line
  // survives compaction until an explicit purge `delete()`s it.
  async function dedupe() {
    const result = await readJsonl(input.filePath, input.schema, storage);
    const byId = new Map<string, T>();

    for (const record of result.records) {
      const existing = byId.get(record.id);
      if (!existing || existing.updatedAt <= record.updatedAt) {
        byId.set(record.id, record);
      }
    }

    return {
      records: Array.from(byId.values()).sort(sortRecords),
      issues: result.issues
    };
  }

  return {
    async list() {
      return (await dedupe()).records.filter((record) => !record.deletedAt);
    },

    async listTrashed() {
      return (await dedupe()).records.filter((record) => !!record.deletedAt);
    },

    async readWithIssues() {
      return dedupe();
    },

    async get(id: string) {
      const record = (await dedupe()).records.find((candidate) => candidate.id === id);
      return record && !record.deletedAt ? record : null;
    },

    async getAny(id: string) {
      return (await dedupe()).records.find((record) => record.id === id) ?? null;
    },

    async upsert(record: T) {
      return withLock(async () => {
        const { records } = await dedupe();
        const next = new Map(records.map((item) => [item.id, item]));
        next.set(record.id, record);
        await writeJsonlAtomic(input.filePath, Array.from(next.values()).sort(sortRecords), storage);
        return record;
      });
    },

    async delete(id: string) {
      return withLock(async () => {
        const { records } = await dedupe();
        const next = records.filter((record) => record.id !== id);
        if (next.length === records.length) return false;
        await writeJsonlAtomic(input.filePath, next.sort(sortRecords), storage);
        return true;
      });
    }
  };
}
