// 画像页 IO — the panel's data edges behind ONE swappable seam (the reviewIo /
// capture.ts test-seam idiom), so the jsdom component tests stub the vault without
// touching global fetch. Every edge is an existing entityClient binding (MEM-1
// settings + the MEM-2 tier bindings) — the panel never calls fetch directly.

import {
  entityClient,
  type MemoryDigestListMeta,
  type MemoryDigestRow,
  type MemoryProfileResponse,
  type MemorySettings,
  type ProfileOverrides
} from "../data/entityClient";

export type ProfileIo = {
  /** GET /api/memory/profile — facts + overrides + digestMeta. */
  fetchProfile(): Promise<MemoryProfileResponse>;
  /** GET /api/memory/digests — live day rows for the per-dimension breakdown. */
  fetchDigests(): Promise<{ digests: MemoryDigestRow[]; meta: MemoryDigestListMeta }>;
  /** PUT /api/memory/profile — replace the override document (pin/hide/correct). */
  saveOverrides(overrides: ProfileOverrides): Promise<unknown>;
  /** PUT /api/memory/settings — the vault-level capture switch (§6.4). */
  saveSettings(settings: MemorySettings): Promise<unknown>;
  /** POST /api/memory/consolidate — run one pass now (the 立即汇总 button). */
  consolidate(): Promise<unknown>;
  /** DELETE /api/memory — 清除记忆: wipe every tier. */
  clearAll(): Promise<unknown>;
};

const defaultIo: ProfileIo = {
  fetchProfile: () => entityClient.memoryProfile(),
  fetchDigests: () => entityClient.memoryDigests(),
  saveOverrides: (overrides) => entityClient.putMemoryProfile(overrides),
  saveSettings: (settings) => entityClient.putMemorySettings(settings),
  consolidate: () => entityClient.consolidateMemory(),
  clearAll: () => entityClient.clearMemory()
};

let io: ProfileIo = defaultIo;

export function getProfileIo(): ProfileIo {
  return io;
}

/** Test seam: override any subset of the IO edges (null restores the real ones). */
export function setProfileIoForTests(next: Partial<ProfileIo> | null): void {
  io = next ? { ...defaultIo, ...next } : defaultIo;
}
