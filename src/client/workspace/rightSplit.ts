// rightSplit — PURE helpers for RightSidebarTabs' "drag a tab out to split vertically"
// feature (bounded V1: ONE popped pane, vertical split only). Kept pure (no React/DOM)
// so the clamp / persist / remaining-tabs logic is unit-testable in isolation, mirroring
// the dock engine's pure helpers (clampDockPx etc.). The component owns the React state.

import { getPlatformOptional } from "../platform/platformSingleton";

export type SplitSide = "top" | "bottom";

// The persisted/in-memory split state. `poppedKind` null = no split (plain tab group).
export type RightSplitState = {
  poppedKind: string | null;
  side: SplitSide;
  ratio: number; // size fraction of the TOP pane (0.2–0.8)
};

export const RIGHT_SPLIT_MIN_RATIO = 0.2;
export const RIGHT_SPLIT_MAX_RATIO = 0.8;
export const RIGHT_SPLIT_DEFAULT_RATIO = 0.5;

// Default (no stored state): the sidebar opens ALREADY SPLIT with AI Chat ("study")
// popped into the BOTTOM pane and the Anchor/Notes/Layers tab group on top. `ratio` is the
// TOP pane fraction, so 0.45 gives the bottom (AI Chat) a bit more room. "study" is a valid
// tab kind, so normalizeSplit/loadRightSplit keep it through validation.
export const DEFAULT_RIGHT_SPLIT: RightSplitState = {
  poppedKind: "study",
  side: "bottom",
  ratio: 0.45
};

// Clamp the divider ratio to the [0.2, 0.8] band (same spirit as clampDockPx).
export function clampRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return RIGHT_SPLIT_DEFAULT_RATIO;
  return Math.max(RIGHT_SPLIT_MIN_RATIO, Math.min(RIGHT_SPLIT_MAX_RATIO, ratio));
}

// localStorage key for a given layout (falls back to "default" when no layout id).
export function rightSplitKey(layoutId?: string | null): string {
  return `sv-right-split:${layoutId && layoutId.length > 0 ? layoutId : "default"}`;
}

// The tabs that remain in the TAB-GROUP pane (all tabs minus the popped one). When nothing
// is popped, that's every tab.
export function remainingTabs<T extends { kind: string }>(tabs: ReadonlyArray<T>, poppedKind: string | null): T[] {
  if (!poppedKind) return [...tabs];
  return tabs.filter((tab) => tab.kind !== poppedKind);
}

// Sanitize an arbitrary parsed value into a valid RightSplitState. `validKinds` (the tab
// kinds) gates poppedKind so a stale/unknown kind never strands the UI in a split with an
// empty pane. Returns the default when input is unusable.
export function normalizeSplit(raw: unknown, validKinds: ReadonlyArray<string>): RightSplitState {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_RIGHT_SPLIT };
  const r = raw as Partial<RightSplitState>;
  const poppedKind =
    typeof r.poppedKind === "string" && validKinds.includes(r.poppedKind) ? r.poppedKind : null;
  const side: SplitSide = r.side === "bottom" ? "bottom" : "top";
  const ratio = clampRatio(typeof r.ratio === "number" ? r.ratio : RIGHT_SPLIT_DEFAULT_RATIO);
  return { poppedKind, side, ratio };
}

// Read the persisted split for a layout, validated against the current tab kinds. Safe
// against absent/throwing storage and malformed JSON (returns the default).
export function loadRightSplit(layoutId: string | undefined, validKinds: ReadonlyArray<string>): RightSplitState {
  try {
    const prefs = getPlatformOptional()?.prefs;
    const key = rightSplitKey(layoutId);
    const raw = prefs ? prefs.get(key) : globalThis.localStorage?.getItem(key);
    if (!raw) return { ...DEFAULT_RIGHT_SPLIT };
    return normalizeSplit(JSON.parse(raw), validKinds);
  } catch {
    return { ...DEFAULT_RIGHT_SPLIT };
  }
}

// Persist the split for a layout. No-ops if storage is unavailable.
export function saveRightSplit(layoutId: string | undefined, state: RightSplitState): void {
  try {
    const prefs = getPlatformOptional()?.prefs;
    const key = rightSplitKey(layoutId);
    if (prefs) prefs.set(key, JSON.stringify(state));
    else globalThis.localStorage?.setItem(key, JSON.stringify(state));
  } catch {
    // storage unavailable — keep the in-memory state only
  }
}
