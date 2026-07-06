// Data trust (docs/design/data-trust.md §1–§2) — TRUST-1 备份轮转 + TRUST-2 全库导出/导入.
//
// TRUST-1: rotating zip backups of the WHOLE vault dir into a sibling `backups/`
// (OUTSIDE the vault, so no recursion and never part of any export). Policy: keep
// 7 dailies + 4 weeklies (newest per day/week, grandfather scheme) with a 24h
// protection window so same-day safety backups (pre-import/pre-restore/pre-clear)
// survive at least a day. Triggers: app start / long-running sessions via
// `createBackupScheduler` (the MEM-2 idle-scheduler idiom: clock-injectable,
// unref'd timer, failures swallowed), POST /api/backup/now (manual), and
// automatically BEFORE destructive operations (清除记忆 hook in app.ts, vault
// import/restore below).
//
// TRUST-2: `.growte-vault.zip` = the vault dir VERBATIM (JSONL + sources/assets +
// prefs) + a cleartext `growte-vault.json` manifest {appVersion, counts, createdAt,
// vault identity}. Export streams the zip; import is full REPLACE (merge is NOT V1 —
// svpack is the merge path): explicit confirm phrase required, zip validated
// structurally BEFORE anything is touched, automatic pre-import backup FIRST, then
// vault.close() (release the sqlite `.db` handles so the dir can be renamed on Windows)
// → staging-dir extract → two-rename swap (rollback on failure) → vault.reopen() (fresh
// handles on the swapped-in dir, in BOTH success and rollback paths) → rebuild the store
// backend from the swapped-in jsonl (the pack's source of truth: on sqlite this pumps the
// jsonl into the fresh empty `.db` and rebuilds note junctions; a NO-OP on the jsonl
// fallback) → in-process reload (manifest re-read + sealed-runtime refresh via onVaultReplaced).
//
// Backups double as transfer packs: a backup zip carries the same manifest, so
// restore (POST /api/backup/restore) and manual recovery ("导入全库" a backup zip)
// share ONE validation + swap pipeline.

import path from "node:path";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { once } from "node:events";
import express, { type Express } from "express";
import { z } from "zod";
import { strFromU8, strToU8, unzipSync, Zip, ZipDeflate } from "fflate";
import { entityFileNames } from "../core/store/entities";
import { dumpStoreToJsonl, loadStoreFromJsonl } from "../core/store/engine";
import type { SnapshotRecord, SnapshotStore } from "../core/store/snapshotStore";
import { vaultManifestSchema, type VaultManifest } from "../core/schema";
import type { StudyVault } from "../core/vault";

// —— Policy constants (docs/design/data-trust.md §1) ————————————————————————————

/** Auto-backup cadence: a new backup once the last one is older than this. */
export const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** How often the scheduler re-checks due-ness (long-running sessions). */
export const BACKUP_DUE_CHECK_MS = 60 * 60 * 1000;
/** Rotation: newest backup per day for this many most-recent distinct days. */
export const BACKUP_DAILY_KEEP = 7;
/** Rotation: newest backup per (epoch-)week for this many most-recent distinct weeks. */
export const BACKUP_WEEKLY_KEEP = 4;
/** Rotation never removes a backup younger than this (protects same-day safety backups). */
export const BACKUP_PROTECT_MS = 24 * 60 * 60 * 1000;
/** The exact phrase an import/restore request must carry — replace is irreversible-ish. */
export const IMPORT_CONFIRM_PHRASE = "替换全库";
/** Cleartext manifest entry at the zip root (never vault content — skipped on extract). */
export const VAULT_TRANSFER_MANIFEST_NAME = "growte-vault.json";

export const BACKUP_REASONS = ["auto", "manual", "pre-import", "pre-restore", "pre-clear"] as const;
export type BackupReason = (typeof BACKUP_REASONS)[number];

/** Default backups home: sibling `backups/` of the vault root (doc §1 — OUTSIDE the vault). */
export function defaultBackupsDir(vaultRootDir: string): string {
  return path.resolve(vaultRootDir, "..", "backups");
}

// —— Backup names (UTC-stamped so rotation math is clock-injectable) ————————————

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

function stampUtc(at: number): string {
  const d = new Date(at);
  return (
    `${pad(d.getUTCFullYear(), 4)}${pad(d.getUTCMonth() + 1, 2)}${pad(d.getUTCDate(), 2)}` +
    `-${pad(d.getUTCHours(), 2)}${pad(d.getUTCMinutes(), 2)}${pad(d.getUTCSeconds(), 2)}`
  );
}

const BACKUP_NAME_RE = /^vault-backup-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-(auto|manual|pre-import|pre-restore|pre-clear)(?:\.(\d+))?\.zip$/;

export function formatBackupName(at: number, reason: BackupReason, suffix?: number): string {
  const tail = suffix && suffix > 1 ? `.${suffix}` : "";
  return `vault-backup-${stampUtc(at)}-${reason}${tail}.zip`;
}

export function parseBackupName(name: string): { at: number; reason: BackupReason } | null {
  const m = BACKUP_NAME_RE.exec(name);
  if (!m) return null;
  const at = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
  if (Number.isNaN(at)) return null;
  return { at, reason: m[7] as BackupReason };
}

// —— Rotation plan (pure — the digest-scheduler test idiom wants this separable) ——

export function planBackupRotation(
  entries: Array<{ name: string; at: number }>,
  opts: { now: number; dailyKeep?: number; weeklyKeep?: number; protectMs?: number }
): { keep: string[]; remove: string[] } {
  const dailyKeep = opts.dailyKeep ?? BACKUP_DAILY_KEEP;
  const weeklyKeep = opts.weeklyKeep ?? BACKUP_WEEKLY_KEEP;
  const protectMs = opts.protectMs ?? BACKUP_PROTECT_MS;
  const sorted = [...entries].sort((a, b) => b.at - a.at || b.name.localeCompare(a.name));

  const keep = new Set<string>();
  // Recent-window protection: anything younger than 24h survives (a pre-import
  // safety backup must not be collapsed away by a later same-day backup).
  for (const entry of sorted) {
    if (opts.now - entry.at < protectMs) keep.add(entry.name);
  }
  // Grandfather scheme: newest per UTC day for the N most recent distinct days …
  const dayKeys = new Set<string>();
  for (const entry of sorted) {
    const day = new Date(entry.at).toISOString().slice(0, 10);
    if (dayKeys.has(day)) continue;
    if (dayKeys.size >= dailyKeep) continue;
    dayKeys.add(day);
    keep.add(entry.name);
  }
  // … plus newest per epoch-week for the M most recent distinct weeks.
  const weekKeys = new Set<number>();
  for (const entry of sorted) {
    const week = Math.floor(entry.at / (7 * 24 * 60 * 60 * 1000));
    if (weekKeys.has(week)) continue;
    if (weekKeys.size >= weeklyKeep) continue;
    weekKeys.add(week);
    keep.add(entry.name);
  }

  return {
    keep: sorted.filter((entry) => keep.has(entry.name)).map((entry) => entry.name),
    remove: sorted.filter((entry) => !keep.has(entry.name)).map((entry) => entry.name)
  };
}

// —— Transfer manifest (`growte-vault.json`, doc §2) —————————————————————————————

export const vaultTransferManifestSchema = z.object({
  format: z.literal("growte-vault"),
  formatVersion: z.literal(1),
  kind: z.enum(["export", "backup"]),
  reason: z.string().optional(),
  appVersion: z.string(),
  createdAt: z.string().min(1),
  vault: z.object({
    name: z.string(),
    createdAt: z.string(),
    schemaVersion: z.number().int()
  }),
  /** Per-entity-store non-empty jsonl line counts — validated on import. */
  counts: z.record(z.string(), z.number().int().min(0))
});

export type VaultTransferManifest = z.infer<typeof vaultTransferManifestSchema>;

// —— Typed import failures → HTTP —————————————————————————————————————————————

export class VaultImportError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "VaultImportError";
    this.status = status;
    this.code = code;
  }
}

// —— Vault walking + zip streaming (shared by backup and export) ————————————————

/**
 * Recursively list the vault's files as sorted posix rel paths. Excluded dirs
 * (the backups dir, when someone points it INSIDE the vault) are skipped whole —
 * a backup must never recurse into backups. Symlinks are skipped (no cycles),
 * as are nodeStorage's transient `*.tmp` atomic-write files and any stray
 * top-level transfer manifest from a hand-restored zip.
 *
 * STORE-SQL Stage-2: the local sqlite cache (`*.db` + its `-wal`/`-shm` sidecars) is a REBUILDABLE
 * local cache, NOT portable pack content — the `*.jsonl` dumps are the pack's source of truth (spec
 * R2), materialized by the export just before this walk. So the `.db` triplet is EXCLUDED (also
 * dodges zipping a torn `-wal`). For today's default jsonl runtime no such files exist → no-op.
 */

// The EXACT sqlite entity-store cache filenames: the `.jsonl → .db` siblings of the 12 entity stores
// plus their `-wal`/`-shm` sidecars. Built from entityFileNames so ONLY these known cache files are
// ever excluded. CRITICAL: do NOT match `.db` by a loose regex on any basename — importLocalAsset
// preserves the source extension (assets.ts), so a user's imported `deck.db` lands at
// `assets/asset_<ULID>.db`, a LEGITIMATE pack file whose bytes must NOT be dropped from the backup.
const SQLITE_CACHE_BASENAMES = new Set(
  Object.values(entityFileNames).flatMap((f) => {
    const db = f.replace(/\.jsonl$/i, ".db");
    return [db, `${db}-wal`, `${db}-shm`];
  })
);

// A file is an excludable sqlite cache file ONLY if it lives DIRECTLY in the study dir AND its
// basename is one of the known entity-store cache names — so nothing outside `.study/` (assets,
// sources, sealed blobs, sidecars) can ever be dropped, whatever its extension.
function isEntityCacheFile(relPath: string, studyDirRel: string): boolean {
  const slash = relPath.replace(/\\/g, "/");
  const cut = slash.lastIndexOf("/");
  const dir = cut === -1 ? "" : slash.slice(0, cut);
  const base = slash.slice(cut + 1);
  return dir === studyDirRel && SQLITE_CACHE_BASENAMES.has(base);
}

async function walkVaultFiles(
  rootDir: string,
  excludeDirs: string[],
  studyDirRel?: string
): Promise<string[]> {
  const excluded = excludeDirs.map((dir) => path.resolve(dir));
  const out: string[] = [];
  const visit = async (dir: string, rel: string) => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // dir vanished mid-walk — concurrent-write tolerance
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (excluded.includes(path.resolve(abs))) continue;
        await visit(abs, relPath);
      } else if (entry.isFile()) {
        if (entry.name.endsWith(".tmp")) continue;
        // Exclude the rebuildable sqlite cache ONLY when the caller scopes it (studyDirRel) and the
        // file is a known entity-store cache under .study/ — jsonl is the pack's truth. Absent
        // studyDirRel (import/other walks) nothing is excluded — under-match is safe, over-match loses data.
        if (studyDirRel !== undefined && isEntityCacheFile(relPath, studyDirRel)) continue;
        if (relPath === VAULT_TRANSFER_MANIFEST_NAME) continue;
        out.push(relPath);
      }
    }
  };
  await visit(rootDir, "");
  return out;
}

/**
 * STORE-SQL Stage-2 — materialize the pack's source-of-truth jsonl from the runtime stores BEFORE
 * the zip walk. For a SQLITE-backed vault each `dumpStoreToJsonl` writes the store's current rows
 * (schema-validated, incl. tombstones) to `<studyDir>/<entity>.jsonl`, so the whole-dir walk zips a
 * fresh, complete jsonl (the `.db` cache is excluded by {@link walkVaultFiles}). For today's DEFAULT
 * jsonl runtime every call is a NO-OP — the jsonl file IS the store, already current — so jsonl-vault
 * export/backup output stays BYTE-IDENTICAL. Non-entity files (sources/assets/sealed/sidecars) are
 * untouched and ride the walk verbatim regardless of engine.
 */
async function materializeVaultStores(vault: StudyVault): Promise<void> {
  for (const [key, fileName] of Object.entries(entityFileNames)) {
    const store = vault.stores[key as keyof typeof vault.stores] as SnapshotStore<SnapshotRecord>;
    await dumpStoreToJsonl(store, path.join(vault.paths.studyDir, fileName), vault.storage);
  }
}

/** Non-empty line counts of every entity jsonl — the manifest's `counts`. */
async function countVaultEntities(vault: StudyVault): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const [key, fileName] of Object.entries(entityFileNames)) {
    const text = await vault.storage.readText(path.join(vault.paths.studyDir, fileName));
    counts[key] = text ? text.split("\n").filter((line) => line.trim().length > 0).length : 0;
  }
  return counts;
}

/**
 * Stream the manifest + files into ONE zip via fflate's streaming Zip, awaiting
 * the sink between entries (drain-aware — works for an HTTP response and a file
 * stream alike). Files that vanish or error mid-read are SKIPPED and reported
 * (concurrent writes must not kill a backup).
 */
async function streamVaultZip(opts: {
  rootDir: string;
  files: string[];
  manifestJson: string;
  write: (chunk: Uint8Array) => Promise<void>;
}): Promise<{ fileCount: number; skippedFiles: string[] }> {
  const pending: Uint8Array[] = [];
  let zipError: Error | null = null;
  const zip = new Zip((err, chunk) => {
    if (err) {
      zipError = err instanceof Error ? err : new Error(String(err));
      return;
    }
    if (chunk.length > 0) pending.push(chunk);
  });
  const flush = async () => {
    if (zipError) throw zipError;
    while (pending.length > 0) {
      await opts.write(pending.shift()!);
    }
    if (zipError) throw zipError;
  };
  const add = async (name: string, data: Uint8Array) => {
    const entry = new ZipDeflate(name, { level: 6 });
    zip.add(entry);
    entry.push(data, true);
    await flush();
  };

  await add(VAULT_TRANSFER_MANIFEST_NAME, strToU8(opts.manifestJson));
  const skippedFiles: string[] = [];
  let fileCount = 0;
  for (const rel of opts.files) {
    let data: Uint8Array;
    try {
      data = await readFile(path.join(opts.rootDir, ...rel.split("/")));
    } catch {
      skippedFiles.push(rel); // transient read failure / vanished file — partial is reported
      continue;
    }
    await add(rel, data);
    fileCount += 1;
  }
  zip.end();
  await flush();
  return { fileCount, skippedFiles };
}

// —— Import-side zip validation (BEFORE anything is touched) ————————————————————

function assertSafeZipEntryName(name: string): void {
  if (name.startsWith("/") || name.includes("\\") || name.includes(":")) {
    throw new VaultImportError(400, "unsafe-entry", `zip 条目路径不安全: ${name}`);
  }
  for (const segment of name.split("/")) {
    if (segment === "..") {
      throw new VaultImportError(400, "unsafe-entry", `zip 条目路径不安全: ${name}`);
    }
  }
}

export type ValidatedVaultZip = {
  manifest: VaultTransferManifest;
  vaultManifest: VaultManifest;
  entries: Record<string, Uint8Array>;
};

/**
 * Full structural validation of a `.growte-vault.zip`: real zip, safe entry names,
 * transfer manifest + vault manifest parse, every entity jsonl line is JSON, and
 * per-store line counts MATCH the manifest. Throws VaultImportError — the caller
 * guarantees nothing was modified when this throws.
 */
export function validateVaultZip(bytes: Uint8Array): ValidatedVaultZip {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new VaultImportError(400, "not-a-zip", "不是有效的 zip 文件");
  }
  for (const name of Object.keys(entries)) assertSafeZipEntryName(name);

  const rawManifest = entries[VAULT_TRANSFER_MANIFEST_NAME];
  if (!rawManifest) {
    throw new VaultImportError(400, "missing-manifest", `缺少 ${VAULT_TRANSFER_MANIFEST_NAME} 清单 — 不是全库包`);
  }
  let manifest: VaultTransferManifest;
  try {
    manifest = vaultTransferManifestSchema.parse(JSON.parse(strFromU8(rawManifest)));
  } catch {
    throw new VaultImportError(400, "invalid-manifest", `${VAULT_TRANSFER_MANIFEST_NAME} 清单无法解析`);
  }

  const rawVaultManifest = entries[".study/manifest.json"];
  if (!rawVaultManifest) {
    throw new VaultImportError(400, "missing-vault-manifest", "包内缺少 .study/manifest.json");
  }
  let vaultManifest: VaultManifest;
  try {
    vaultManifest = vaultManifestSchema.parse(JSON.parse(strFromU8(rawVaultManifest)));
  } catch {
    throw new VaultImportError(400, "invalid-vault-manifest", ".study/manifest.json 无法解析");
  }

  for (const [key, fileName] of Object.entries(entityFileNames)) {
    const raw = entries[`.study/${fileName}`];
    const lines = raw ? strFromU8(raw).split("\n").filter((line) => line.trim().length > 0) : [];
    for (let i = 0; i < lines.length; i += 1) {
      try {
        JSON.parse(lines[i]);
      } catch {
        throw new VaultImportError(400, "corrupt-store", `${fileName} 第 ${i + 1} 行不是有效 JSON`);
      }
    }
    const expected = manifest.counts[key] ?? 0;
    if (lines.length !== expected) {
      throw new VaultImportError(
        400,
        "counts-mismatch",
        `${fileName} 有 ${lines.length} 条记录, 清单声明 ${expected} 条 — 包不完整`
      );
    }
  }

  return { manifest, vaultManifest, entries };
}

// —— The service ————————————————————————————————————————————————————————————————

export type BackupInfo = {
  name: string;
  createdAt: string;
  reason: BackupReason;
  sizeBytes: number;
};

export type BackupResult = BackupInfo & {
  fileCount: number;
  skippedFiles: string[];
  /** Names pruned by the rotation pass that follows every successful backup. */
  removed: string[];
};

export type BackupStatus = {
  backups: BackupInfo[];
  lastBackupAt: string | null;
  nextDueAt: string;
  backupsDir: string;
};

export type VaultImportResult = {
  ok: true;
  counts: Record<string, number>;
  sourceVault: { name: string; createdAt: string };
  sameVault: boolean;
  preImportBackup: string;
  restartRequired: boolean;
};

export type DataTrustDeps = {
  vault: StudyVault;
  backupsDir: string;
  appVersion: string;
  /** Injectable wall clock (tests drive rotation/scheduling deterministically). */
  now?: () => number;
  /** Called after a successful import/restore swap (app.ts refreshes the sealed runtime). */
  onVaultReplaced?: () => void;
};

export type DataTrustService = {
  readonly backupsDir: string;
  now(): number;
  backupNow(reason: BackupReason): Promise<BackupResult>;
  backupStatus(): Promise<BackupStatus>;
  vaultInfo(): Promise<{ vault: VaultManifest; counts: Record<string, number>; rootDir: string }>;
  exportFileName(): string;
  exportToStream(write: (chunk: Uint8Array) => Promise<void>): Promise<{ fileCount: number; skippedFiles: string[] }>;
  importVault(bytes: Uint8Array): Promise<VaultImportResult>;
  restoreBackup(name: string): Promise<{ ok: true; restoredFrom: string; preRestoreBackup: string; counts: Record<string, number> }>;
};

async function renameWithRetry(from: string, to: string, attempts = 5): Promise<void> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      lastError = error;
      // Windows: EPERM/EBUSY while another handle is briefly open — back off and retry.
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }
  throw lastError;
}

export function createDataTrustService(deps: DataTrustDeps): DataTrustService {
  const { vault, backupsDir, appVersion } = deps;
  const now = deps.now ?? (() => Date.now());
  const rootDir = vault.paths.rootDir;

  // Serialize the mutating operations (backup / import / restore) — snapshotStore's
  // write-chain idiom. Inner do* functions never enqueue (no self-deadlock: doImport
  // calls doBackup directly).
  let chain: Promise<unknown> = Promise.resolve();
  function enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  async function buildManifest(kind: "export" | "backup", reason?: BackupReason): Promise<string> {
    const manifest: VaultTransferManifest = vaultTransferManifestSchema.parse({
      format: "growte-vault",
      formatVersion: 1,
      kind,
      ...(reason ? { reason } : {}),
      appVersion,
      createdAt: new Date(now()).toISOString(),
      vault: {
        name: vault.manifest.name,
        createdAt: vault.manifest.createdAt,
        schemaVersion: vault.manifest.schemaVersion
      },
      counts: await countVaultEntities(vault)
    });
    return `${JSON.stringify(manifest, null, 2)}\n`;
  }

  async function listBackups(): Promise<Array<BackupInfo & { at: number }>> {
    let names: string[];
    try {
      names = await readdir(backupsDir);
    } catch {
      return []; // no backups dir yet
    }
    const out: Array<BackupInfo & { at: number }> = [];
    for (const name of names) {
      const parsed = parseBackupName(name);
      if (!parsed) continue; // foreign files are never touched (nor rotated away)
      let sizeBytes = 0;
      try {
        sizeBytes = (await stat(path.join(backupsDir, name))).size;
      } catch {
        continue; // vanished mid-list
      }
      out.push({ name, createdAt: new Date(parsed.at).toISOString(), reason: parsed.reason, sizeBytes, at: parsed.at });
    }
    out.sort((a, b) => b.at - a.at || b.name.localeCompare(a.name));
    return out;
  }

  async function rotate(): Promise<string[]> {
    const backups = await listBackups();
    const plan = planBackupRotation(
      backups.map((backup) => ({ name: backup.name, at: backup.at })),
      { now: now() }
    );
    const removed: string[] = [];
    for (const name of plan.remove) {
      try {
        await rm(path.join(backupsDir, name), { force: true });
        removed.push(name);
      } catch {
        // best-effort — a locked file just survives until the next rotation
      }
    }
    return removed;
  }

  async function doBackup(reason: BackupReason): Promise<BackupResult> {
    const at = now();
    await mkdir(backupsDir, { recursive: true });
    let suffix = 1;
    let name = formatBackupName(at, reason, suffix);
    while (existsSync(path.join(backupsDir, name))) {
      suffix += 1;
      name = formatBackupName(at, reason, suffix);
    }
    const finalPath = path.join(backupsDir, name);
    const tmpPath = `${finalPath}.tmp`;

    // Stage-2: materialize sqlite rows → jsonl (no-op on the jsonl default) BEFORE the manifest
    // counts (read from the jsonl) and the walk zip them.
    await materializeVaultStores(vault);
    const manifestJson = await buildManifest("backup", reason);
    const studyDirRel = path.relative(rootDir, vault.paths.studyDir).replace(/\\/g, "/");
    const files = await walkVaultFiles(rootDir, [backupsDir], studyDirRel);
    const stream = createWriteStream(tmpPath);
    try {
      const { fileCount, skippedFiles } = await streamVaultZip({
        rootDir,
        files,
        manifestJson,
        write: async (chunk) => {
          if (!stream.write(chunk)) await once(stream, "drain");
        }
      });
      await new Promise<void>((resolve, reject) => {
        stream.once("error", reject);
        stream.end(() => resolve());
      });
      await rename(tmpPath, finalPath);
      const sizeBytes = (await stat(finalPath)).size;
      const removed = await rotate();
      return { name, createdAt: new Date(at).toISOString(), reason, sizeBytes, fileCount, skippedFiles, removed };
    } catch (error) {
      stream.destroy();
      await rm(tmpPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async function doReplaceFromZip(
    validated: ValidatedVaultZip,
    safetyReason: "pre-import" | "pre-restore"
  ): Promise<{ safetyBackup: string; counts: Record<string, number>; sameVault: boolean }> {
    const sameVault = validated.vaultManifest.createdAt === vault.manifest.createdAt;

    // 1. Automatic safety backup FIRST — a failure here ABORTS with the vault untouched.
    const safety = await doBackup(safetyReason);

    // 2. Extract into a sibling staging dir (same volume — rename works).
    const stamp = `${stampUtc(now())}-${process.pid}`;
    const staging = `${rootDir}.staging-${stamp}`;
    const replaced = `${rootDir}.replaced-${stamp}`;
    await rm(staging, { recursive: true, force: true });
    try {
      for (const [entryName, data] of Object.entries(validated.entries)) {
        if (entryName.endsWith("/")) continue; // directory entries
        if (entryName === VAULT_TRANSFER_MANIFEST_NAME) continue; // manifest never nests into the vault
        const dest = path.join(staging, ...entryName.split("/"));
        await mkdir(path.dirname(dest), { recursive: true });
        await writeFile(dest, data);
      }
      // The vault's standard dirs must exist even when the zip carried none of them.
      for (const dir of [".study", "sources", "assets", "exports"]) {
        await mkdir(path.join(staging, dir), { recursive: true });
      }
    } catch (error) {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }

    // 3. Two-rename swap; roll back if the second rename fails. STORE-SQL Stage-3: a SQLITE-backed
    // vault holds 12 open `.db`/`-wal` handles under `.study/` — Windows can't rename the dir under
    // them (EPERM/EBUSY). So close() FIRST (release the handles) → swap → reopen() in a `finally` so
    // the vault ALWAYS ends open on whatever is now at rootDir: the NEW content on success, or the
    // ORIGINAL content on rollback (incl. a first-rename failure, which leaves rootDir untouched).
    // On the jsonl fallback both close() and reopen() are harmless no-ops (stores read per request).
    deps.vault.close();
    try {
      await renameWithRetry(rootDir, replaced);
      try {
        await renameWithRetry(staging, rootDir);
      } catch (error) {
        await renameWithRetry(replaced, rootDir);
        await rm(staging, { recursive: true, force: true }).catch(() => undefined);
        throw new VaultImportError(500, "swap-failed", `替换失败, 已回滚到原库: ${error instanceof Error ? error.message : error}`);
      }
      await rm(replaced, { recursive: true, force: true }).catch(() => undefined);
    } finally {
      // rootDir now holds NEW (success) or ORIGINAL (rollback / first-rename failure) content →
      // open fresh handles on it either way, so the vault is never left closed & unusable.
      deps.vault.reopen();
    }

    // 4. Rebuild the store backend from the swapped-in jsonl (the pack's source of truth, spec R2).
    // On SQLITE the freshly-reopened `.db` is EMPTY (the pack excludes the `.db` cache) — pump each
    // entity's jsonl into it so the imported data is visible + note junctions are rebuilt. On the
    // jsonl fallback loadStoreFromJsonl is a NO-OP (the jsonl file IS the store, read per request).
    for (const [key, fileName] of Object.entries(entityFileNames)) {
      const store = vault.stores[key as keyof typeof vault.stores] as SnapshotStore<SnapshotRecord>;
      await loadStoreFromJsonl(store, path.join(vault.paths.studyDir, fileName), vault.storage);
    }

    // 5. In-process reload: refresh the cached manifest; the sealed runtime re-unseals via the hook.
    Object.assign(vault.manifest, validated.vaultManifest);
    deps.onVaultReplaced?.();

    return { safetyBackup: safety.name, counts: validated.manifest.counts, sameVault };
  }

  return {
    backupsDir,
    now,

    backupNow(reason) {
      return enqueue(() => doBackup(reason));
    },

    async backupStatus() {
      const backups = (await listBackups()).map(({ at: _at, ...info }) => info);
      const lastBackupAt = backups[0]?.createdAt ?? null;
      const nextDueAt = new Date(lastBackupAt ? Date.parse(lastBackupAt) + BACKUP_INTERVAL_MS : now()).toISOString();
      return { backups, lastBackupAt, nextDueAt, backupsDir };
    },

    async vaultInfo() {
      // Manifest fresh from disk — /api/vault/info is the client's DIFFERENT-VAULT check.
      const raw = await vault.storage.readText(vault.paths.manifestPath);
      const manifest = raw ? vaultManifestSchema.parse(JSON.parse(raw)) : vault.manifest;
      return { vault: manifest, counts: await countVaultEntities(vault), rootDir };
    },

    exportFileName() {
      return `vault-${stampUtc(now())}.growte-vault.zip`;
    },

    async exportToStream(write) {
      // Stage-2: materialize sqlite rows → jsonl (no-op on the jsonl default) BEFORE the manifest
      // counts (read from the jsonl) and the walk zip them.
      await materializeVaultStores(vault);
      const manifestJson = await buildManifest("export");
      const studyDirRel = path.relative(rootDir, vault.paths.studyDir).replace(/\\/g, "/");
      const files = await walkVaultFiles(rootDir, [backupsDir], studyDirRel);
      return streamVaultZip({ rootDir, files, manifestJson, write });
    },

    importVault(bytes) {
      return enqueue(async () => {
        const validated = validateVaultZip(bytes); // throws BEFORE anything is touched
        const { safetyBackup, counts, sameVault } = await doReplaceFromZip(validated, "pre-import");
        return {
          ok: true as const,
          counts,
          sourceVault: { name: validated.vaultManifest.name, createdAt: validated.vaultManifest.createdAt },
          sameVault,
          preImportBackup: safetyBackup,
          restartRequired: false
        };
      });
    },

    restoreBackup(name) {
      return enqueue(async () => {
        if (!parseBackupName(name)) {
          throw new VaultImportError(400, "invalid-backup-name", "不是有效的备份文件名");
        }
        let bytes: Uint8Array;
        try {
          bytes = await readFile(path.join(backupsDir, name));
        } catch {
          throw new VaultImportError(404, "backup-not-found", "备份不存在");
        }
        const validated = validateVaultZip(bytes);
        const { safetyBackup, counts } = await doReplaceFromZip(validated, "pre-restore");
        return { ok: true as const, restoredFrom: name, preRestoreBackup: safetyBackup, counts };
      });
    }
  };
}

// —— Scheduler (the MEM-2 idle-scheduler idiom: unref'd, swallowed failures) ————

export type BackupScheduler = {
  /** App-start trigger: run the due-check now and arm the periodic re-check. */
  start(): Promise<void>;
  /** Await any in-flight pass and cancel the timer (tests / teardown). */
  dispose(): Promise<void>;
};

export function createBackupScheduler(
  service: DataTrustService,
  opts?: { intervalMs?: number; checkEveryMs?: number }
): BackupScheduler {
  const intervalMs = opts?.intervalMs ?? BACKUP_INTERVAL_MS;
  const checkEveryMs = opts?.checkEveryMs ?? BACKUP_DUE_CHECK_MS;
  let timer: ReturnType<typeof setInterval> | null = null;
  let inflight: Promise<void> = Promise.resolve();

  const check = (): Promise<void> => {
    inflight = inflight
      .then(async () => {
        const status = await service.backupStatus();
        const last = status.lastBackupAt ? Date.parse(status.lastBackupAt) : null;
        if (last === null || service.now() - last >= intervalMs) {
          await service.backupNow("auto");
        }
      })
      .catch(() => undefined); // swallowed — the next check or manual trigger retries
    return inflight;
  };

  return {
    start() {
      const first = check();
      timer = setInterval(check, checkEveryMs);
      timer.unref?.();
      return first;
    },
    async dispose() {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      await inflight;
    }
  };
}

// —— Routes ————————————————————————————————————————————————————————————————————

export function registerDataTrustRoutes(app: Express, service: DataTrustService): void {
  // Current vault identity + counts — the client's DIFFERENT-VAULT warning input.
  app.get("/api/vault/info", async (_req, res, next) => {
    try {
      res.json(await service.vaultInfo());
    } catch (error) {
      next(error);
    }
  });

  // TRUST-2 export: stream the whole vault as ONE `.growte-vault.zip`.
  app.get("/api/vault/export", async (_req, res, next) => {
    try {
      res.status(200);
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${service.exportFileName()}"`);
      await service.exportToStream(async (chunk) => {
        if (res.destroyed) throw new Error("client disconnected");
        const ok = res.write(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength));
        if (!ok) await once(res, "drain");
      });
      res.end();
    } catch (error) {
      if (res.headersSent) {
        res.destroy(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      next(error);
    }
  });

  // TRUST-2 import: full REPLACE of the vault from a `.growte-vault.zip`. Raw zip
  // body + the explicit confirm phrase in the query; validation happens BEFORE the
  // pre-import backup and the staging→swap, so a rejected zip never touches anything.
  const rawZip = express.raw({ type: () => true, limit: "2gb" });
  app.post("/api/vault/import", rawZip, async (req, res, next) => {
    try {
      const confirm = typeof req.query.confirm === "string" ? req.query.confirm : "";
      if (confirm !== IMPORT_CONFIRM_PHRASE) {
        res.status(400).json({
          error: `导入会完整替换当前库 — 请求必须携带确认口令 confirm=${IMPORT_CONFIRM_PHRASE}`,
          code: "confirm-required"
        });
        return;
      }
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        res.status(400).json({ error: "请求体必须是 zip 字节流", code: "empty-body" });
        return;
      }
      res.json(await service.importVault(req.body));
    } catch (error) {
      if (error instanceof VaultImportError) {
        res.status(error.status).json({ error: error.message, code: error.code });
        return;
      }
      next(error);
    }
  });

  // TRUST-1 manual trigger.
  app.post("/api/backup/now", async (_req, res, next) => {
    try {
      res.status(201).json({ backup: await service.backupNow("manual") });
    } catch (error) {
      next(error);
    }
  });

  // TRUST-1 status: the "上次备份 x 小时前 · 共 N 份" readout.
  app.get("/api/backup/status", async (_req, res, next) => {
    try {
      res.json(await service.backupStatus());
    } catch (error) {
      next(error);
    }
  });

  // TRUST-1 restore: pick a backup → confirm → swap; the current state is backed
  // up FIRST (pre-restore), so restore is itself undoable.
  app.post("/api/backup/restore", async (req, res, next) => {
    try {
      const input = z.object({ name: z.string().min(1), confirm: z.string() }).parse(req.body);
      if (input.confirm !== IMPORT_CONFIRM_PHRASE) {
        res.status(400).json({
          error: `恢复会完整替换当前库 — 请求必须携带确认口令 confirm=${IMPORT_CONFIRM_PHRASE}`,
          code: "confirm-required"
        });
        return;
      }
      res.json(await service.restoreBackup(input.name));
    } catch (error) {
      if (error instanceof VaultImportError) {
        res.status(error.status).json({ error: error.message, code: error.code });
        return;
      }
      next(error);
    }
  });
}
