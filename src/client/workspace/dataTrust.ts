// Data-trust client actions (TRUST-1/2, docs/design/data-trust.md §1–§2) — the
// UserMenu 数据 entries: 立即备份 / 导出全库… / 导入全库(替换)…. The Settings Hub
// 数据 section (status line + backup picker/restore UI, doc §1) is DEFERRED while
// SettingsHub.tsx is contended by a parallel session; until then the capability is
// fully exposed here + over the API (restore = POST /api/backup/restore).
//
// IO rides the standard swappable seam (userMenuIo idiom); the JSON edges go
// through the shared VaultTransport, while export (binary blob) and import (raw
// zip upload) keep their own fetch — the same carve-out transport.ts documents
// for byte-stream endpoints. The import flow peeks at the picked zip LOCALLY
// (fflate, nothing uploaded) to drive the doc's DIFFERENT-VAULT warning, then
// requires typing the exact confirm phrase before the replace request is sent.

import { strFromU8, unzipSync } from "fflate";
import { createHttpTransport } from "../data/transport";
import { platformDialogs } from "../platform";

/** Must match the server's IMPORT_CONFIRM_PHRASE (src/server/dataTrust.ts). */
export const IMPORT_CONFIRM_PHRASE = "替换全库";

export type BackupInfo = { name: string; createdAt: string; reason: string; sizeBytes: number };
export type BackupStatusInfo = {
  backups: BackupInfo[];
  lastBackupAt: string | null;
  nextDueAt: string;
  backupsDir: string;
};
export type VaultInfo = {
  vault: { name: string; createdAt: string; updatedAt: string; schemaVersion: number };
  counts: Record<string, number>;
  rootDir: string;
};
export type VaultImportOutcome = {
  ok: true;
  counts: Record<string, number>;
  sourceVault: { name: string; createdAt: string };
  sameVault: boolean;
  preImportBackup: string;
  restartRequired: boolean;
};
export type BackupRestoreOutcome = {
  ok: true;
  restoredFrom: string;
  preRestoreBackup: string;
  counts: Record<string, number>;
};

export type DataTrustIo = {
  /** POST /api/backup/now */
  backupNow(): Promise<{ backup: BackupInfo }>;
  /** GET /api/backup/status */
  fetchBackupStatus(): Promise<BackupStatusInfo>;
  /** GET /api/vault/info — the DIFFERENT-VAULT comparison input. */
  fetchVaultInfo(): Promise<VaultInfo>;
  /** GET /api/vault/export — the streamed `.growte-vault.zip`. */
  exportVault(): Promise<{ blob: Blob; fileName: string }>;
  /** POST /api/vault/import?confirm=… with the raw zip bytes. */
  importVault(bytes: Uint8Array, confirm: string): Promise<VaultImportOutcome>;
  /** POST /api/backup/restore */
  restoreBackup(name: string, confirm: string): Promise<BackupRestoreOutcome>;
};

const transport = createHttpTransport();

const defaultIo: DataTrustIo = {
  backupNow: () => transport.request("POST", "/api/backup/now"),
  fetchBackupStatus: () => transport.request("GET", "/api/backup/status"),
  fetchVaultInfo: () => transport.request("GET", "/api/vault/info"),
  exportVault: async () => {
    const response = await fetch("/api/vault/export");
    if (!response.ok) throw new Error(`导出失败 (HTTP ${response.status})`);
    const disposition = response.headers.get("content-disposition") ?? "";
    const match = /filename="([^"]+)"/.exec(disposition);
    return { blob: await response.blob(), fileName: match?.[1] ?? "vault.growte-vault.zip" };
  },
  importVault: async (bytes, confirm) => {
    const response = await fetch(`/api/vault/import?confirm=${encodeURIComponent(confirm)}`, {
      method: "POST",
      headers: { "Content-Type": "application/zip" },
      body: bytes as BodyInit
    });
    const parsed = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) throw new Error(parsed.error ?? `导入失败 (HTTP ${response.status})`);
    return parsed as unknown as VaultImportOutcome;
  },
  restoreBackup: (name, confirm) => transport.request("POST", "/api/backup/restore", { name, confirm })
};

let io: DataTrustIo = defaultIo;

export function getDataTrustIo(): DataTrustIo {
  return io;
}

/** Test seam: override any subset of the IO edges (null restores the real ones). */
export function setDataTrustIoForTests(next: Partial<DataTrustIo> | null): void {
  io = next ? { ...defaultIo, ...next } : defaultIo;
}

// —— UI seam (dialogs ride platformDialogs: mobile-swappable; tests inject) ————————
// alert/prompt are ASYNC (they route through the platform's async dialogs). `reload`
// stays sync — it's a window action, not a dialog, with no PlatformDialogs analog.

export type DataTrustUi = {
  alert(message: string): Promise<void>;
  prompt(message: string): Promise<string | null>;
  reload(): void;
};

const defaultUi: DataTrustUi = {
  alert: (message) => platformDialogs().alert(message),
  prompt: (message) => platformDialogs().prompt(message),
  reload: () => window.location.reload()
};

// —— Helpers ————————————————————————————————————————————————————————————————————

/** Browser/Electron-renderer download of a blob (the svpack download idiom). */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export type VaultZipPeek = {
  vaultName: string;
  vaultCreatedAt: string;
  appVersion: string;
  counts: Record<string, number>;
};

/** Read ONLY the transfer manifest out of a picked zip, locally. null ⇒ not a vault pack. */
export function peekVaultZip(bytes: Uint8Array): VaultZipPeek | null {
  try {
    const entries = unzipSync(bytes, { filter: (file) => file.name === "growte-vault.json" });
    const raw = entries["growte-vault.json"];
    if (!raw) return null;
    const manifest = JSON.parse(strFromU8(raw)) as {
      format?: string;
      appVersion?: string;
      vault?: { name?: string; createdAt?: string };
      counts?: Record<string, number>;
    };
    if (manifest.format !== "growte-vault" || !manifest.vault?.createdAt) return null;
    return {
      vaultName: manifest.vault.name ?? "",
      vaultCreatedAt: manifest.vault.createdAt,
      appVersion: manifest.appVersion ?? "",
      counts: manifest.counts ?? {}
    };
  } catch {
    return null;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hoursAgoText(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "";
  const hours = Math.floor(ms / 3_600_000);
  return hours < 1 ? "不到 1 小时前" : `${hours} 小时前`;
}

// —— Actions (wired to the UserMenu 数据 entries) ————————————————————————————————

/** 立即备份 → POST /api/backup/now, then the doc's status readout as feedback. */
export async function runBackupNow(ui: DataTrustUi = defaultUi): Promise<void> {
  try {
    const { backup } = await io.backupNow();
    let total = 1;
    try {
      total = (await io.fetchBackupStatus()).backups.length;
    } catch {
      // status readout is best-effort — the backup itself already succeeded
    }
    await ui.alert(`已备份:${backup.name}(共 ${total} 份)`);
  } catch (error) {
    await ui.alert(`备份失败:${errorMessage(error)}`);
  }
}

/** 导出全库… → GET /api/vault/export, saved via the download idiom. */
export async function runExportVault(ui: DataTrustUi = defaultUi): Promise<void> {
  try {
    const { blob, fileName } = await io.exportVault();
    downloadBlob(blob, fileName);
  } catch (error) {
    await ui.alert(`导出失败:${errorMessage(error)}`);
  }
}

/**
 * 导入全库(替换) from a picked file: local manifest peek → DIFFERENT-VAULT warning
 * (id mismatch, doc §2) → typed confirm phrase → upload. The server takes the
 * automatic pre-import backup and swaps atomically-ish; a rejected zip or a wrong
 * phrase never sends/touches anything.
 */
export async function importVaultFromFile(file: File, ui: DataTrustUi = defaultUi): Promise<void> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const peek = peekVaultZip(bytes);
  if (!peek) {
    await ui.alert("这不是有效的全库包(.growte-vault.zip):缺少或无法解析 growte-vault.json 清单。");
    return;
  }

  let sameVault = true;
  let currentName = "当前库";
  try {
    const info = await io.fetchVaultInfo();
    sameVault = info.vault.createdAt === peek.vaultCreatedAt;
    currentName = info.vault.name || currentName;
  } catch {
    // Can't read the current identity — proceed, the confirm phrase still gates.
  }

  const countsLine = Object.entries(peek.counts)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => `${key} ${count}`)
    .join(" · ");
  const lines = [
    `导入「${peek.vaultName || file.name}」(${countsLine || "空库"})。`,
    ...(sameVault ? [] : ["⚠️ 这是另一个库的导出(与当前库身份不一致)。"]),
    `导入将【完整替换】当前库「${currentName}」,导入前会自动创建备份。`,
    `输入「${IMPORT_CONFIRM_PHRASE}」以确认:`
  ];
  const answer = await ui.prompt(lines.join("\n"));
  if (answer === null) return; // cancelled
  if (answer.trim() !== IMPORT_CONFIRM_PHRASE) {
    await ui.alert("确认口令不符,已取消导入。库未被修改。");
    return;
  }

  try {
    const result = await io.importVault(bytes, IMPORT_CONFIRM_PHRASE);
    await ui.alert(
      `导入完成,已替换全库。导入前备份:${result.preImportBackup}。` +
        (result.restartRequired ? "请重启应用以完成加载。" : "界面将刷新。")
    );
    if (!result.restartRequired) ui.reload();
  } catch (error) {
    await ui.alert(`导入失败:${errorMessage(error)}(当前库保持不变)`);
  }
}

/** 导入全库(替换)… menu entry: open a file picker, then run the import flow. */
export function runImportVault(ui: DataTrustUi = defaultUi): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".zip";
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) void importVaultFromFile(file, ui);
  };
  input.click();
}

/** The 立即备份 tooltip readout ("上次备份 x 小时前 · 共 N 份") — best-effort. */
export async function backupStatusLine(): Promise<string | null> {
  try {
    const status = await io.fetchBackupStatus();
    if (status.backups.length === 0) return "尚无备份";
    const ago = hoursAgoText(status.lastBackupAt);
    return `上次备份 ${ago || status.lastBackupAt} · 共 ${status.backups.length} 份`;
  } catch {
    return null;
  }
}
