// Pure helpers for SourceTabs' split-to-side feature. SourceTabs owns the React state;
// these helpers keep the ratio, persistence, and eligibility rules unit-testable.

import { getPlatformOptional } from "../platform/platformSingleton";

export type SourceGroup = "left" | "right";

// The split state. `rightPaneIds` is the ordered set of panes assigned to the right
// editor group; every other open pane belongs to the left group. An empty right group is
// the unsplit state. Old persisted `sidePaneId` values are migrated in normalizeSourceSplit.
export type SourceSplitState = {
  rightPaneIds: string[];
  ratio: number; // fraction of the left pane's width (0.2..0.8)
};

export const SOURCE_SPLIT_MIN_RATIO = 0.2;
export const SOURCE_SPLIT_MAX_RATIO = 0.8;
export const SOURCE_SPLIT_DEFAULT_RATIO = 0.5;

export const NO_SPLIT: SourceSplitState = { rightPaneIds: [], ratio: SOURCE_SPLIT_DEFAULT_RATIO };

export function clampSplitRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return SOURCE_SPLIT_DEFAULT_RATIO;
  return Math.max(SOURCE_SPLIT_MIN_RATIO, Math.min(SOURCE_SPLIT_MAX_RATIO, ratio));
}

// Split eligibility is source-type agnostic; PDF/PDF and PDF/image can be shown side by side.
export function canSplitConcurrently(
  leftSourceType: string | undefined,
  sideSourceType: string | undefined
): boolean {
  return !!leftSourceType && !!sideSourceType;
}

// localStorage key for a layout's source-split (falls back to "default").
export function sourceSplitKey(layoutId?: string | null): string {
  return `sv-source-split:${layoutId && layoutId.length > 0 ? layoutId : "default"}`;
}

function uniqueValidPaneIds(values: unknown[], validPaneIds: ReadonlyArray<string>): string[] {
  const seen = new Set<string>();
  const valid = new Set(validPaneIds);
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== "string" || !valid.has(value) || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function keepLeftGroupNonEmpty(rightPaneIds: string[], validPaneIds: ReadonlyArray<string>): string[] {
  if (validPaneIds.length <= 1) return [];
  if (rightPaneIds.length === 0) return rightPaneIds;
  const right = new Set(rightPaneIds);
  const hasLeft = validPaneIds.some((id) => !right.has(id));
  if (hasLeft) return rightPaneIds;
  return rightPaneIds.filter((id) => id !== validPaneIds[0]);
}

// Sanitize a parsed value into a valid SourceSplitState. `validPaneIds` gates rightPaneIds
// so stale pane ids (closed panes) never strand the UI in a split with an empty pane.
export function normalizeSourceSplit(raw: unknown, validPaneIds: ReadonlyArray<string>): SourceSplitState {
  if (!raw || typeof raw !== "object") return { ...NO_SPLIT };
  const r = raw as Partial<SourceSplitState> & { sidePaneId?: unknown };
  const rawRightPaneIds = Array.isArray(r.rightPaneIds)
    ? r.rightPaneIds
    : typeof r.sidePaneId === "string"
      ? [r.sidePaneId]
      : [];
  const rightPaneIds = keepLeftGroupNonEmpty(uniqueValidPaneIds(rawRightPaneIds, validPaneIds), validPaneIds);
  const ratio = clampSplitRatio(typeof r.ratio === "number" ? r.ratio : SOURCE_SPLIT_DEFAULT_RATIO);
  return { rightPaneIds, ratio };
}

export function sourceGroupOfPane(state: SourceSplitState, paneId: string): SourceGroup {
  return state.rightPaneIds.includes(paneId) ? "right" : "left";
}

export function paneIdsForSourceGroup(
  allPaneIds: ReadonlyArray<string>,
  state: SourceSplitState,
  group: SourceGroup
): string[] {
  const normalized = normalizeSourceSplit(state, allPaneIds);
  const right = new Set(normalized.rightPaneIds);
  return group === "right"
    ? normalized.rightPaneIds.filter((id) => allPaneIds.includes(id))
    : allPaneIds.filter((id) => !right.has(id));
}

export function movePaneToSourceGroup(
  state: SourceSplitState,
  paneId: string,
  group: SourceGroup,
  validPaneIds: ReadonlyArray<string>
): SourceSplitState {
  if (!validPaneIds.includes(paneId)) return normalizeSourceSplit(state, validPaneIds);
  const normalized = normalizeSourceSplit(state, validPaneIds);
  const right = normalized.rightPaneIds.filter((id) => id !== paneId);
  if (group === "right") right.push(paneId);
  return normalizeSourceSplit({ ...normalized, rightPaneIds: right }, validPaneIds);
}

export function reconcileSourceSplitPaneIds(
  state: SourceSplitState,
  previousPaneIds: ReadonlyArray<string>,
  nextPaneIds: ReadonlyArray<string>,
  activeGroup: SourceGroup
): SourceSplitState {
  const addedPaneIds = nextPaneIds.filter((id) => !previousPaneIds.includes(id));
  if (addedPaneIds.length === 0) return normalizeSourceSplit(state, nextPaneIds);

  const removedPaneIds = previousPaneIds.filter((id) => !nextPaneIds.includes(id));
  const previousSplit = normalizeSourceSplit(state, previousPaneIds);
  let next = normalizeSourceSplit(state, nextPaneIds);

  for (const [index, paneId] of addedPaneIds.entries()) {
    const replacedPaneId = addedPaneIds.length === removedPaneIds.length ? removedPaneIds[index] : undefined;
    const targetGroup = replacedPaneId ? sourceGroupOfPane(previousSplit, replacedPaneId) : activeGroup;
    next = movePaneToSourceGroup(next, paneId, targetGroup, nextPaneIds);
  }

  return next;
}

export function isSourceSplitActive(
  state: SourceSplitState,
  validPaneIds: ReadonlyArray<string>
): boolean {
  const left = paneIdsForSourceGroup(validPaneIds, state, "left");
  const right = paneIdsForSourceGroup(validPaneIds, state, "right");
  return left.length > 0 && right.length > 0;
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
    // storage unavailable - keep the in-memory state only
  }
}
