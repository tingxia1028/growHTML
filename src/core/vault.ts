import path from "node:path";
import { createEntityStores, entityFileNames, type EntityStores } from "./store/entities";
import { closeSqliteStore } from "./store/engine";
import type { SnapshotRecord, SnapshotStore } from "./store/snapshotStore";
import { schemaVersion, vaultManifestSchema, type VaultManifest } from "./schema";
import type { StorageAdapter } from "./storage/adapter";

export const studyDirName = ".study";
export const sourcesDirName = "sources";
export const assetsDirName = "assets";
export const exportsDirName = "exports";
export const manifestFileName = "manifest.json";
export const pluginSettingsFileName = "plugin-settings.json";
export const appendLogFileNames = ["conversations.jsonl", "ai-calls.jsonl"] as const;

export type VaultPaths = {
  rootDir: string;
  studyDir: string;
  sourcesDir: string;
  assetsDir: string;
  exportsDir: string;
  manifestPath: string;
  pluginSettingsPath: string;
};

export type StudyVault = {
  paths: VaultPaths;
  manifest: VaultManifest;
  stores: EntityStores;
  storage: StorageAdapter;
  /**
   * Release every entity store's underlying resources (STORE-SQL Stage-3 dispose path,
   * §Stage-2). For a SQLITE-backed vault this closes each store's `.db`/`-wal` handle so
   * the OS can unlink/rename the file (Windows can't touch an open `.db` — the Stage-2
   * import EPERM). For a JSONL-backed vault (today's default) every `closeSqliteStore` is a
   * safe no-op, so calling `close()` is harmless regardless of engine. Synchronous —
   * better-sqlite3's `db.close()` is sync; call it once on server/process shutdown.
   */
  close: () => void;
  /**
   * Rebuild every entity store IN PLACE against whatever now lives at `paths.studyDir`
   * (STORE-SQL Stage-3 import path, §Stage-3). Used by the data-trust import/restore swap: the
   * caller `close()`s FIRST (releasing the old `.db` handles so Windows can rename the dir), swaps
   * the vault dir, then `reopen()`s so the stores hold FRESH handles on the swapped-in content.
   * Mutates `vault.stores` in place (`Object.assign`) so every consumer — which reads
   * `vault.stores.X` fresh per request — picks up the new backends without any rewiring. Safe on
   * jsonl too: it just rebuilds the (stateless, per-request-file-reading) jsonl stores harmlessly.
   */
  reopen: () => void;
};

function getVaultPaths(rootDir: string): VaultPaths {
  const resolvedRoot = path.resolve(rootDir);
  const studyDir = path.join(resolvedRoot, studyDirName);

  return {
    rootDir: resolvedRoot,
    studyDir,
    sourcesDir: path.join(resolvedRoot, sourcesDirName),
    assetsDir: path.join(resolvedRoot, assetsDirName),
    exportsDir: path.join(resolvedRoot, exportsDirName),
    manifestPath: path.join(studyDir, manifestFileName),
    pluginSettingsPath: path.join(studyDir, pluginSettingsFileName)
  };
}

async function readJsonFile<T>(storage: StorageAdapter, filePath: string, fallback: T): Promise<T> {
  const text = await storage.readText(filePath);
  if (text === null) return fallback;
  return JSON.parse(text) as T;
}

async function ensureTextFile(storage: StorageAdapter, filePath: string, text: string) {
  const existing = await storage.readText(filePath);
  if (existing === null) await storage.writeText(filePath, text);
}

function createManifest(name = "AI Study Vault"): VaultManifest {
  const now = new Date().toISOString();
  return {
    schemaVersion,
    name,
    createdAt: now,
    updatedAt: now
  };
}

async function ensureManifest(storage: StorageAdapter, paths: VaultPaths, name?: string) {
  const fallback = createManifest(name);
  const raw = await readJsonFile<VaultManifest>(storage, paths.manifestPath, fallback);
  const manifest = vaultManifestSchema.parse(raw);
  await ensureTextFile(storage, paths.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export async function openVault(input: {
  rootDir: string;
  name?: string;
  storage: StorageAdapter;
}): Promise<StudyVault> {
  const storage = input.storage;
  const paths = getVaultPaths(input.rootDir);

  await storage.ensureDir(paths.studyDir);
  await storage.ensureDir(paths.sourcesDir);
  await storage.ensureDir(paths.assetsDir);
  await storage.ensureDir(paths.exportsDir);

  const manifest = await ensureManifest(storage, paths, input.name);

  for (const fileName of Object.values(entityFileNames)) {
    await ensureTextFile(storage, path.join(paths.studyDir, fileName), "");
  }

  for (const fileName of appendLogFileNames) {
    await ensureTextFile(storage, path.join(paths.studyDir, fileName), "");
  }

  await ensureTextFile(storage, paths.pluginSettingsPath, "{}\n");

  const stores = createEntityStores(paths.studyDir, storage);

  return {
    paths,
    manifest,
    stores,
    storage,
    // STORE-SQL Stage-3 dispose path: iterate the 12 stores and release each engine's
    // resources. no-op per store on jsonl (no CLOSE hook) → safe to call today; frees the
    // sqlite `.db`/`-wal` handles once sqlite becomes the default.
    close() {
      for (const store of Object.values(stores)) {
        closeSqliteStore(store as SnapshotStore<SnapshotRecord>);
      }
    },
    // STORE-SQL Stage-3 import path: rebuild the 12 stores against the current on-disk studyDir and
    // swap them into `vault.stores` in place. Consumers read `vault.stores.X` fresh per request, so
    // the in-place mutation is picked up with no rewiring. Note `stores` (the closure the close()
    // loop iterates) IS `vault.stores`, so a later close() releases these NEW handles.
    // Self-closes the OLD backends first so reopen() is leak-safe regardless of caller discipline
    // (close-after-close is a safe no-op via each engine's open guard) — a reopen() without a
    // preceding close() would otherwise orphan 12 sqlite `.db` handles.
    reopen() {
      for (const store of Object.values(stores)) {
        closeSqliteStore(store as SnapshotStore<SnapshotRecord>);
      }
      const next = createEntityStores(paths.studyDir, storage);
      Object.assign(stores, next);
    }
  };
}

