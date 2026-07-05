// Settings Hub IO — the hub's data edges behind ONE swappable seam (the profileIo /
// reviewIo test-seam idiom), so jsdom tests stub the vault without touching global
// fetch. Every edge is an existing entityClient binding — sections never call fetch.

import {
  entityClient,
  type AboutInfo,
  type AiDetectResult,
  type AiProviderEntryInput,
  type AiProvidersConfigView,
  type AiProvidersInfo,
  type AiTestConnectionResult,
  type ManagedBalance,
  type ManagedTopupOrder,
  type MemorySettings,
  type UiPrefs
} from "../data/entityClient";
import {
  getDataTrustIo,
  type BackupRestoreOutcome,
  type BackupStatusInfo
} from "../workspace/dataTrust";
import { getSpeechStatus, type SpeechStatusView } from "../speech/speechStatus";

export type SettingsIo = {
  /** GET /api/ai/providers — active provider + registry + stored config + key-store mode. */
  fetchProviders(): Promise<AiProvidersInfo>;
  /** PUT /api/ai/providers/config — the LIST editor's field-group-safe write (A3b). */
  saveProviderList(providers: AiProviderEntryInput[]): Promise<{ config: AiProvidersConfigView }>;
  /** PUT /api/ai/providers/active — the PICKER's write seam (id or null = default). */
  saveActiveProvider(activeProviderId: string | null): Promise<{ config: AiProvidersConfigView }>;
  /** PUT /api/ai/providers/:id/key — write-only key save (encrypted at rest, never echoed). */
  saveProviderKey(providerId: string, apiKey: string): Promise<{ ok: boolean; keySet: boolean; storage: string }>;
  /** DELETE /api/ai/providers/:id/key. */
  deleteProviderKey(providerId: string): Promise<{ ok: boolean; keySet: boolean }>;
  /** POST /api/ai/providers/:id/test — 测试连接 (typed ok/fail result). */
  testProvider(providerId: string): Promise<AiTestConnectionResult>;
  /** GET /api/ai/providers/:id/detect — cli-agent binary probe (刷新检测). */
  detectProvider(providerId: string): Promise<AiDetectResult>;
  // —— Managed gateway (G-A3b) — login / balance / top-up (token stays server-side). ——
  /** POST …/managed/request-code — send an SMS login code (mock gateway → readable). */
  managedRequestCode(providerId: string, phone: string): Promise<{ ok: boolean }>;
  /** POST …/managed/verify — verify a code (the server persists the session). */
  managedVerify(providerId: string, phone: string, code: string): Promise<{ ok: boolean; userId: string; isNewUser: boolean }>;
  /** GET …/managed/balance — the account credits + recent ledger (401 → 登录). */
  managedBalance(providerId: string): Promise<ManagedBalance>;
  /** POST …/managed/topup — create a top-up order (mockNotify credits it in dev/test). */
  managedTopup(providerId: string, sku: string, mockNotify?: boolean): Promise<ManagedTopupOrder>;
  /** POST …/managed/logout — clear the encrypted session. */
  managedLogout(providerId: string): Promise<{ ok: boolean }>;
  /** GET /api/vault — manifest + vault root path (数据 section readout). */
  fetchVaultInfo(): Promise<{ manifest: { name?: string }; paths: { rootDir: string } }>;
  /** GET /api/about — app version (关于 section). */
  fetchAbout(): Promise<AboutInfo>;
  /** GET /api/memory/settings — the vault-level capture switch (mirrored here). */
  fetchMemorySettings(): Promise<{ settings: MemorySettings }>;
  /** PUT /api/memory/settings — the same write the 画像页 switch performs. */
  saveMemorySettings(settings: MemorySettings): Promise<unknown>;
  /** GET /api/workspace/ui-prefs — app-shell language preference. */
  fetchUiPrefs(): Promise<{ prefs: UiPrefs }>;
  /** PUT /api/workspace/ui-prefs — app-shell language preference. */
  saveUiPrefs(prefs: UiPrefs): Promise<{ prefs: UiPrefs }>;
  /** GET /api/backup/status — backup status line + restore picker source. */
  fetchBackupStatus(): Promise<BackupStatusInfo>;
  /** POST /api/backup/restore — restore an existing backup after typed confirmation. */
  restoreBackup(name: string, confirm: string): Promise<BackupRestoreOutcome>;
  /** GET /api/speech/status — voice list for TTS preferences. */
  fetchSpeechStatus(): Promise<SpeechStatusView>;
};

const defaultIo: SettingsIo = {
  fetchProviders: () => entityClient.aiProviders(),
  saveProviderList: (providers) => entityClient.putAiProviderList(providers),
  saveActiveProvider: (activeProviderId) => entityClient.putAiActiveProvider(activeProviderId),
  saveProviderKey: (providerId, apiKey) => entityClient.putAiProviderKey(providerId, apiKey),
  deleteProviderKey: (providerId) => entityClient.deleteAiProviderKey(providerId),
  testProvider: (providerId) => entityClient.testAiProvider(providerId),
  detectProvider: (providerId) => entityClient.detectAiProvider(providerId),
  managedRequestCode: (providerId, phone) => entityClient.managedRequestCode(providerId, phone),
  managedVerify: (providerId, phone, code) => entityClient.managedVerify(providerId, phone, code),
  managedBalance: (providerId) => entityClient.managedBalance(providerId),
  managedTopup: (providerId, sku, mockNotify) => entityClient.managedTopup(providerId, sku, mockNotify),
  managedLogout: (providerId) => entityClient.managedLogout(providerId),
  fetchVaultInfo: () => entityClient.vaultInfo(),
  fetchAbout: () => entityClient.about(),
  fetchMemorySettings: () => entityClient.memorySettings(),
  saveMemorySettings: (settings) => entityClient.putMemorySettings(settings),
  fetchUiPrefs: () => entityClient.uiPrefs(),
  saveUiPrefs: (prefs) => entityClient.putUiPrefs(prefs),
  fetchBackupStatus: () => getDataTrustIo().fetchBackupStatus(),
  restoreBackup: (name, confirm) => getDataTrustIo().restoreBackup(name, confirm),
  fetchSpeechStatus: () => getSpeechStatus()
};

let io: SettingsIo = defaultIo;

export function getSettingsIo(): SettingsIo {
  return io;
}

/** Test seam: override any subset of the IO edges (null restores the real ones). */
export function setSettingsIoForTests(next: Partial<SettingsIo> | null): void {
  io = next ? { ...defaultIo, ...next } : defaultIo;
}
