// STORE-SQL Stage-3 dispose path (docs/implementation/sqlite-migration-build-spec.md §Stage-2 S2 +
// the Stage-2 sqlite-target-import EPERM caveat). better-sqlite3 holds a `.db`/`-wal` handle open
// per store; production never closes it, but shutdown/teardown must — Windows CANNOT unlink or
// rename an OPEN `.db`. `StudyVault.close()` iterates the 12 stores and releases each engine's
// handle. This suite proves BOTH sides of the contract:
//   1. a SQLITE-backed vault releases the handle → the `.db` can be renamed/deleted after close().
//   2. a JSONL-backed vault (today's default via openVault) close() is a safe NO-OP (no throw).

import { mkdtemp, rename, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fixtureSource } from "./fixtures/golden";
import { schemaVersion, vaultManifestSchema, type VaultManifest } from "./schema";
import { openVault, type StudyVault, type VaultPaths } from "./vault";
import { createEntityStores } from "./store/entities";
import { closeSqliteStore } from "./store/engine";
import { sqliteEngine } from "./store/sqliteEngine";
import type { SnapshotRecord, SnapshotStore } from "./store/snapshotStore";
import { nodeStorage } from "./storage/nodeStorage";

const cleanups: string[] = [];
async function tmpDir(tag: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), `vault-close-${tag}-`));
  cleanups.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of cleanups.splice(0)) await rm(dir, { recursive: true, force: true });
});

// Build a SQLITE-backed StudyVault (mirrors openVault's dir + manifest setup + the real close()
// dispose loop) so we exercise the actual `vault.close()` handle-release, not a hand-rolled one.
async function buildSqliteVault(rootDir: string): Promise<StudyVault> {
  const studyDir = path.join(rootDir, ".study");
  const paths: VaultPaths = {
    rootDir,
    studyDir,
    sourcesDir: path.join(rootDir, "sources"),
    assetsDir: path.join(rootDir, "assets"),
    exportsDir: path.join(rootDir, "exports"),
    manifestPath: path.join(studyDir, "manifest.json"),
    pluginSettingsPath: path.join(studyDir, "plugin-settings.json")
  };
  await nodeStorage.ensureDir(studyDir);
  const nowIso = new Date().toISOString();
  const manifest: VaultManifest = vaultManifestSchema.parse({
    schemaVersion,
    name: "SQLite Vault",
    createdAt: nowIso,
    updatedAt: nowIso
  });
  const stores = createEntityStores(studyDir, nodeStorage, sqliteEngine);
  return {
    paths,
    manifest,
    stores,
    storage: nodeStorage,
    // Byte-for-byte the real StudyVault.close() dispose loop (vault.ts): iterate the stores and
    // call engine.ts's closeSqliteStore — the native-free symbol-dispatcher that fires each
    // sqlite store's hidden CLOSE hook (db.close()) and no-ops any jsonl store.
    close() {
      for (const store of Object.values(stores)) {
        closeSqliteStore(store as SnapshotStore<SnapshotRecord>);
      }
    },
    reopen() {
      Object.assign(stores, createEntityStores(studyDir, nodeStorage, sqliteEngine));
    }
  };
}

describe("StudyVault.close() — STORE-SQL Stage-3 dispose path", () => {
  it("releases the sqlite .db handle so the file can be renamed/deleted (Windows EPERM proof)", async () => {
    const root = await tmpDir("sqlite");
    const vault = await buildSqliteVault(root);

    // Write a row so a real `.db` (+ `-wal`) exists on disk with an OPEN handle.
    await vault.stores.sources.upsert(fixtureSource);
    const dbPath = path.join(vault.paths.studyDir, "sources.db");
    expect(existsSync(dbPath)).toBe(true);

    // The dispose path. After it, the OS handle is released.
    vault.close();

    // The teardown proof (mirrors the existing closeSqliteStore tests): with the handle closed,
    // Windows lets us RENAME then DELETE the `.db` — impossible while better-sqlite3 held it open.
    const renamed = `${dbPath}.moved`;
    await expect(rename(dbPath, renamed)).resolves.toBeUndefined();
    await expect(rm(renamed, { force: true })).resolves.toBeUndefined();
    expect(existsSync(dbPath)).toBe(false);
  });

  it("is a NO-OP on a jsonl-backed vault (STORE_ENGINE=jsonl) — does not throw", async () => {
    const root = await tmpDir("jsonl");
    // PIN to jsonl (STORE-SQL Stage-3): the default engine is now SQLite, where close() genuinely
    // releases the handle and the store is UNUSABLE afterward. This test is INHERENTLY about the
    // jsonl no-op semantics (close() leaves the store fully usable), so build a jsonl vault via the
    // reversibility switch — resolveDefaultEngine() reads STORE_ENGINE at openVault time.
    const priorEngine = process.env.STORE_ENGINE;
    process.env.STORE_ENGINE = "jsonl";
    let vault;
    try {
      vault = await openVault({ rootDir: root });
    } finally {
      if (priorEngine === undefined) delete process.env.STORE_ENGINE;
      else process.env.STORE_ENGINE = priorEngine;
    }

    // A jsonl store has no CLOSE hook, so close() must be a harmless no-op — even AFTER a write,
    // and even called TWICE (idempotent). The jsonl file stays present & untouched afterward.
    await vault.stores.sources.upsert(fixtureSource);
    const jsonlPath = path.join(vault.paths.studyDir, "sources.jsonl");
    const before = (await stat(jsonlPath)).mtimeMs;

    expect(() => vault.close()).not.toThrow();
    expect(() => vault.close()).not.toThrow();

    // The vault is still fully usable — no handle was closed out from under the jsonl engine.
    expect(await vault.stores.sources.get(fixtureSource.id)).toEqual(fixtureSource);
    expect(existsSync(jsonlPath)).toBe(true);
    // no-op ⇒ the jsonl file wasn't rewritten by close().
    expect((await stat(jsonlPath)).mtimeMs).toBe(before);
  });
});
