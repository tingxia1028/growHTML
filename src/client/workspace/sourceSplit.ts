// sourceSplit — PURE helpers for SourceTabs' "分屏 / split to the side" feature (F1 /
// P-A2, bounded V1: ONE side pane, a horizontal row split). Kept pure (no React/DOM) so
// the clamp / gate / pairing logic is unit-testable, mirroring rightSplit.ts + the dock
// engine's pure helpers. SourceTabs owns the React state; the global dock engine is
// untouched (the split is self-contained inside the source.tabs host view).

import { getPlatformOptional } from "../platform/platformSingleton";
import { isHostRealmSource } from "../viewers";

// The split state. `sidePaneId` null = no split (single body, tabbed). When set, the
// focused pane's body renders on the LEFT and the side pane's body on the RIGHT.
export type SourceSplitState = {
  sidePaneId: string | null;
  ratio: number; // fraction of the LEFT (focused) pane's width (0.2–0.8)
};

export const SOURCE_SPLIT_MIN_RATIO = 0.2;
export const SOURCE_SPLIT_MAX_RATIO = 0.8;
export const SOURCE_SPLIT_DEFAULT_RATIO = 0.5;

export const NO_SPLIT: SourceSplitState = { sidePaneId: null, ratio: SOURCE_SPLIT_DEFAULT_RATIO };

export function clampSplitRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return SOURCE_SPLIT_DEFAULT_RATIO;
  return Math.max(SOURCE_SPLIT_MIN_RATIO, Math.min(SOURCE_SPLIT_MAX_RATIO, ratio));
}

// The HOST-REALM GATE (delta 3): a split shows two bodies at once. Two HOST-REALM bodies
// (pdfjs / image) can't coexist — they share the ONE host `#sv-note-card` + module-level
// hide-all / glyph-visibility singletons. So a proposed (left, side) pairing is allowed
// iff AT MOST ONE of the two is a host-realm source. Returns true when the split is safe.
export function canSplitConcurrently(
  leftSourceType: string | undefined,
  sideSourceType: string | undefined
): boolean {
  return !(isHostRealmSource(leftSourceType) && isHostRealmSource(sideSourceType));
}

// localStorage key for a layout's source-split (falls back to "default").
export function sourceSplitKey(layoutId?: string | null): string {
  return `sv-source-split:${layoutId && layoutId.length > 0 ? layoutId : "default"}`;
}

// Sanitize a parsed value into a valid SourceSplitState. `validPaneIds` gates sidePaneId
// so a stale pane id (a closed pane) never strands the UI in a split with an empty pane.
export function normalizeSourceSplit(raw: unknown, validPaneIds: ReadonlyArray<string>): SourceSplitState {
  if (!raw || typeof raw !== "object") return { ...NO_SPLIT };
  const r = raw as Partial<SourceSplitState>;
  const sidePaneId =
    typeof r.sidePaneId === "string" && validPaneIds.includes(r.sidePaneId) ? r.sidePaneId : null;
  const ratio = clampSplitRatio(typeof r.ratio === "number" ? r.ratio : SOURCE_SPLIT_DEFAULT_RATIO);
  return { sidePaneId, ratio };
}

export function loadSourceSplit(
  layoutId: string | undefined,
  validPaneIds: ReadonlyArray<string>
): SourceSplitState {
  try {
    const prefs = getPlatformOptional()?.prefs;
    const key = sourceSplitKey(layoutId);
    const raw = prefs ? prefs.get(key) : globalThis.localStorage?.getItem(key);
    if (!raw) return { ...NO_SPLIT };
    return normalizeSourceSplit(JSON.parse(raw), validPaneIds);
  } catch {
    return { ...NO_SPLIT };
  }
}

export function saveSourceSplit(layoutId: string | undefined, state: SourceSplitState): void {
  try {
    const prefs = getPlatformOptional()?.prefs;
    const key = sourceSplitKey(layoutId);
    if (prefs) prefs.set(key, JSON.stringify(state));
    else globalThis.localStorage?.setItem(key, JSON.stringify(state));
  } catch {
    // storage unavailable — keep the in-memory state only
  }
}
