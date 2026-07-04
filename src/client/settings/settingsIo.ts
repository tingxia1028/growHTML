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
