import path from "node:path";
import { createEntityStores, entityFileNames, type EntityStores } from "./store/entities";
import { schemaVersion, vaultManifestSchema, type VaultManifest } from "./schema";
import type { StorageAdapter } from "./storage/adapter";
import { nodeStorage } from "./storage/nodeStorage";

export const studyDirName = ".study";
export const sourcesDirName = "sources";
export const exportsDirName = "exports";
export const manifestFileName = "manifest.json";
export const pluginSettingsFileName = "plugin-settings.json";
export const appendLogFileNames = ["conversations.jsonl", "ai-calls.jsonl"] as const;

export type VaultPaths = {
  rootDir: string;
  studyDir: string;
  sourcesDir: string;
  exportsDir: string;
  manifestPath: string;
  pluginSettingsPath: string;
};

export type StudyVault = {
  paths: VaultPaths;
  manifest: VaultManifest;
  stores: EntityStores;
  storage: StorageAdapter;
};

export function getDefaultVaultRoot() {
  return process.env.STUDY_VAULT_ROOT
    ? path.resolve(process.env.STUDY_VAULT_ROOT)
    : path.resolve(process.cwd(), "data", "vault");
}

function getVaultPaths(rootDir: string): VaultPaths {
  const resolvedRoot = path.resolve(rootDir);
  const studyDir = path.join(resolvedRoot, studyDirName);

  return {
    rootDir: resolvedRoot,
    studyDir,
    sourcesDir: path.join(resolvedRoot, sourcesDirName),
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

export async function openVault(input?: {
  rootDir?: string;
  name?: string;
  storage?: StorageAdapter;
}): Promise<StudyVault> {
  const storage = input?.storage ?? nodeStorage;
  const paths = getVaultPaths(input?.rootDir ?? getDefaultVaultRoot());

  await storage.ensureDir(paths.studyDir);
  await storage.ensureDir(paths.sourcesDir);
  await storage.ensureDir(paths.exportsDir);

  const manifest = await ensureManifest(storage, paths, input?.name);

  for (const fileName of Object.values(entityFileNames)) {
    await ensureTextFile(storage, path.join(paths.studyDir, fileName), "");
  }

  for (const fileName of appendLogFileNames) {
    await ensureTextFile(storage, path.join(paths.studyDir, fileName), "");
  }

  await ensureTextFile(storage, paths.pluginSettingsPath, "{}\n");

  return {
    paths,
    manifest,
    stores: createEntityStores(paths.studyDir, storage),
    storage
  };
}

