// Per-source Product Kit activation. A source's `metadata.activeKitIds` (string[])
// decides which kits are active for THAT document; when absent it falls back to a
// workspace default. An explicit empty array means "Core" — no kit. The UI is
// single-select today, but the data is an array so enabling multi-kit later is a
// UI-only change (the host filters by set membership: itemKitId ∈ activeKitIds).
//
// ONLY creation/interaction entry-points are gated by activation (selection toolbar,
// source actions, composer type picker, kit commands, language). RENDERING stays
// global — any contentType renders in any document — so shared/imported kit notes
// always display regardless of which kit a document has active.

export const DEFAULT_KIT_STORAGE_KEY = "sv-default-kit";
export const FALLBACK_DEFAULT_KIT = "textbook-learning";
/** Sentinel the UI uses for "no kit (Core only)". */
export const CORE_KIT_ID = "core";

/**
 * Pure resolver (unit-testable, no localStorage): source metadata wins; otherwise
 * the workspace default. An array (incl. empty = Core) is authoritative; anything
 * else (undefined/non-array) means "inherit the default". The `core` sentinel is
 * never a real kit id, so it's filtered out / treated as empty.
 */
export function effectiveKitIds(metadataKitIds: unknown, defaultKitId: string | null): string[] {
  if (Array.isArray(metadataKitIds)) {
    return metadataKitIds.filter((id): id is string => typeof id === "string" && id !== CORE_KIT_ID);
  }
  return defaultKitId && defaultKitId !== CORE_KIT_ID ? [defaultKitId] : [];
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

/** Workspace-default kit id (localStorage-backed; falls back to the textbook kit). */
export function getDefaultKitId(): string {
  return safeLocalStorage()?.getItem(DEFAULT_KIT_STORAGE_KEY) ?? FALLBACK_DEFAULT_KIT;
}

export function setDefaultKitId(kitId: string): void {
  safeLocalStorage()?.setItem(DEFAULT_KIT_STORAGE_KEY, kitId);
}

/** Resolve a source's effective kit ids using the stored workspace default. */
export function activeKitIdsForSource(source: { metadata?: Record<string, unknown> } | null): string[] {
  return effectiveKitIds(source?.metadata?.activeKitIds, getDefaultKitId());
}
