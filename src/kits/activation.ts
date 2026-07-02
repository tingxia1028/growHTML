// Per-source Product Kit activation. A source's `metadata.activeKitIds` (string[])
// decides which kits are active for THAT document; when absent it falls back to a
// workspace default. An explicit empty array means "Core" — no kit. The UI is
// single-select today, but the data is an array so enabling multi-kit later is a
// UI-only change (the host filters by set membership: itemKitId ∈ activeKitIds).
//
// F4: "active" means FOREGROUND ORDERING, never a filter — availability comes from the
// marketplace effective-installed set (src/kits/installState.ts); the active kit ids
// only float that kit's items to the front (kitSurfaceItems). Rendering was never gated.
//
// M-A (subject-kits.md PART 3): the Subject Auto-Switch rides THIS resolver — no new
// state model. Precedence chain (§3.2, total order, no flapping):
//
//   user pin (explicit metadata.activeKitIds array — incl. [] = Core)
//     > detection winner (score ≥ DETECTION_THRESHOLD, kit installed)
//       > workspace default kit
//
// The pin IS the existing per-source activation array (the design's §3.7
// `metadata.subject` key is superseded post-F4 — the manual kit pick and the subject
// pin are the same write: entityClient.updateSourceMetadata({ activeKitIds })).
// Detection is recomputed on open (WorkspaceContext's activeKitIds useMemo re-runs per
// active source; the server's stage-axis seeding in services/layers.ts shares this
// resolver); ONLY the pin persists. Tables register per kit (src/core/subject/
// detectSubject.ts — the KitLayerPolicy precedent), so a vault whose kits register no
// table behaves exactly as before M-A.

import {
  detectKit,
  listKitDetections,
  type KitDetectionResult,
  type KitDetectionTable
} from "../core/subject/detectSubject";
import { isKitInstalled } from "./installState";

export const DEFAULT_KIT_STORAGE_KEY = "sv-default-kit";
export const FALLBACK_DEFAULT_KIT = "textbook-learning";
/** Sentinel the UI uses for "no kit (Core only)". */
export const CORE_KIT_ID = "core";

/** The source fields the foreground resolver reads (a SourceRecord satisfies this). */
export type ForegroundSourceLike = {
  title?: string;
  sourceType?: string;
  metadata?: Record<string, unknown>;
} | null;

export type ForegroundMode = "pin" | "detected" | "default";

export type ForegroundResolution = {
  /** The foreground kit ids ([] = Core / none). Ordering input for kitSurfaceItems. */
  kitIds: string[];
  /** How the foreground was decided — the chip's provenance. */
  mode: ForegroundMode;
  /** The winning detection (confidence + explainable signals); non-null iff "detected". */
  detection: KitDetectionResult | null;
};

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

/**
 * The M-A auto-switch resolver — pure over its inputs (tables/isInstalled default to
 * the module registries, injectable for tests per §3.2's `resolveSubject(source,
 * profiles, isInstalled)` signature):
 *
 *   1. An EXPLICIT metadata.activeKitIds array is the user pin — it always wins
 *      (an empty array pins Core; detection must never override a deliberate choice).
 *   2. Otherwise the detection winner auto-foregrounds — iff it cleared the threshold
 *      AND its kit is installed (§3.4/§3.5: an uninstalled winner foregrounds nothing;
 *      the market-suggestion UI is a later phase, the candidates stay available on the
 *      engine result for it).
 *   3. Otherwise the workspace default kit ("default" — including when detection names
 *      the same kit but nothing was detected at all).
 *
 * Auto-switch is therefore a pure function of (pin, detection, default) — "switching"
 * on open/focus is just this resolver re-running for the newly active source, and the
 * no-op case (winner == current foreground) falls out for free.
 */
export function resolveForegroundKits(
  source: ForegroundSourceLike,
  defaultKitId: string | null,
  opts?: {
    tables?: readonly KitDetectionTable[];
    isInstalled?: (kitId: string) => boolean;
  }
): ForegroundResolution {
  const pinned = source?.metadata?.activeKitIds;
  if (Array.isArray(pinned)) {
    return { kitIds: effectiveKitIds(pinned, defaultKitId), mode: "pin", detection: null };
  }
  const detection = detectKit(
    { title: source?.title, sourceType: source?.sourceType },
    opts?.tables ?? listKitDetections()
  );
  const installed = opts?.isInstalled ?? isKitInstalled;
  if (detection.kitId && detection.kitId !== CORE_KIT_ID && installed(detection.kitId)) {
    return { kitIds: [detection.kitId], mode: "detected", detection };
  }
  return { kitIds: effectiveKitIds(undefined, defaultKitId), mode: "default", detection: null };
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

/** Full foreground resolution (kit ids + pin/detected/default provenance + the winning
    detection) using the stored workspace default — what the M-A chip renders. */
export function foregroundForSource(source: ForegroundSourceLike): ForegroundResolution {
  return resolveForegroundKits(source, getDefaultKitId());
}

/** Resolve a source's effective kit ids using the stored workspace default. Since M-A
    this includes the auto-switch layer: pin > detected (installed) > default. */
export function activeKitIdsForSource(source: ForegroundSourceLike): string[] {
  return foregroundForSource(source).kitIds;
}
