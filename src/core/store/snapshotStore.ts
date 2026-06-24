import type { z } from "zod";
import type { StorageAdapter } from "../storage/adapter";
import { nodeStorage } from "../storage/nodeStorage";
import { readJsonl, writeJsonlAtomic, type JsonlReadResult } from "./jsonl";

export type SnapshotRecord = {
  id: string;
  updatedAt: string;
};

export type SnapshotStore<T extends SnapshotRecord> = {
  list(): Promise<T[]>;
  readWithIssues(): Promise<JsonlReadResult<T>>;
  get(id: string): Promise<T | null>;
  upsert(record: T): Promise<T>;
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
      return (await dedupe()).records;
    },

    async readWithIssues() {
      return dedupe();
    },

    async get(id: string) {
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

