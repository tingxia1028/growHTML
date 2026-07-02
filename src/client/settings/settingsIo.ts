// Settings Hub IO — the hub's data edges behind ONE swappable seam (the profileIo /
// reviewIo test-seam idiom), so jsdom tests stub the vault without touching global
// fetch. Every edge is an existing entityClient binding — sections never call fetch.

import {
  entityClient,
  type AboutInfo,
  type AiProvidersInfo,
  type MemorySettings
} from "../data/entityClient";

export type SettingsIo = {
  /** GET /api/ai/providers — active provider + registry readout (A1 env detection). */
  fetchProviders(): Promise<AiProvidersInfo>;
  /** GET /api/vault — manifest + vault root path (数据 section readout). */
  fetchVaultInfo(): Promise<{ manifest: { name?: string }; paths: { rootDir: string } }>;
  /** GET /api/about — app version (关于 section). */
  fetchAbout(): Promise<AboutInfo>;
  /** GET /api/memory/settings — the vault-level capture switch (mirrored here). */
  fetchMemorySettings(): Promise<{ settings: MemorySettings }>;
  /** PUT /api/memory/settings — the same write the 画像页 switch performs. */
  saveMemorySettings(settings: MemorySettings): Promise<unknown>;
};

const defaultIo: SettingsIo = {
  fetchProviders: () => entityClient.aiProviders(),
  fetchVaultInfo: () => entityClient.vaultInfo(),
  fetchAbout: () => entityClient.about(),
  fetchMemorySettings: () => entityClient.memorySettings(),
  saveMemorySettings: (settings) => entityClient.putMemorySettings(settings)
};

let io: SettingsIo = defaultIo;

export function getSettingsIo(): SettingsIo {
  return io;
}

/** Test seam: override any subset of the IO edges (null restores the real ones). */
export function setSettingsIoForTests(next: Partial<SettingsIo> | null): void {
  io = next ? { ...defaultIo, ...next } : defaultIo;
}
