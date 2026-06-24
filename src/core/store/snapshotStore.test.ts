import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fixturePatch } from "../fixtures/golden";
import { createEntityId } from "../ids";
import { patchSchema, type PatchRecord } from "../schema";
import { appendJsonlRecord, readJsonl } from "./jsonl";
import { createSnapshotStore, type SnapshotStore } from "./snapshotStore";

let tempDir = "";
let store: SnapshotStore<PatchRecord>;
let filePath = "";

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "study-vault-store-"));
  filePath = path.join(tempDir, "patches.jsonl");
  store = createSnapshotStore({ filePath, schema: patchSchema });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("snapshot store", () => {
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

  it("tolerates malformed lines and preserves valid records", async () => {
    await writeFile(filePath, `${JSON.stringify(fixturePatch)}\nnot-json\n`, "utf8");

    const result = await store.readWithIssues();

    expect(result.records).toEqual([fixturePatch]);
    expect(result.issues).toHaveLength(1);
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

  it("rewrites snapshots atomically without temp leftovers", async () => {
    await store.upsert(fixturePatch);

    const files = await readdir(tempDir);
    const text = await readFile(filePath, "utf8");

    expect(files).toEqual(["patches.jsonl"]);
    expect(() => JSON.parse(text.trim())).not.toThrow();
  });
});

describe("append-only logs", () => {
  it("appends records without snapshot dedupe", async () => {
    const logPath = path.join(tempDir, "ai-calls.jsonl");
    await appendJsonlRecord(logPath, fixturePatch);
    await appendJsonlRecord(logPath, { ...fixturePatch, status: "reverted" });

    const result = await readJsonl(logPath, patchSchema);

    expect(result.records.map((record) => record.status)).toEqual(["pending", "reverted"]);
    expect(result.issues).toEqual([]);
  });
});

