import { nodeStorage } from "../storage/nodeStorage";
import type { StoreConfig, StoreEngine } from "./engine";
import { readJsonl, writeJsonlAtomic } from "./jsonl";
import type { SnapshotRecord, SnapshotStore } from "./snapshotStore";

/**
 * The JSONL storage engine — today's `createSnapshotStore` body, extracted UNCHANGED
 * (STORE-SQL Stage-1, §Stage-1). Every read `dedupe()`s the file (compaction-aware,
 * keeps tombstones); every write serializes through `withLock` and rewrites atomically.
 * Behavior is byte-for-byte identical to the pre-seam store — it is the DEFAULT engine.
 */
export const jsonlEngine: StoreEngine = <T extends SnapshotRecord>(
  config: StoreConfig<T>
): SnapshotStore<T> => {
  const storage = config.storage ?? nodeStorage;
  const sortRecords =
    config.sort ??
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
    const result = await readJsonl(config.filePath, config.schema, storage);
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
        await writeJsonlAtomic(config.filePath, Array.from(next.values()).sort(sortRecords), storage);
        return record;
      });
    },

    async delete(id: string) {
      return withLock(async () => {
        const { records } = await dedupe();
        const next = records.filter((record) => record.id !== id);
        if (next.length === records.length) return false;
        await writeJsonlAtomic(config.filePath, next.sort(sortRecords), storage);
        return true;
      });
    }
  };
};
