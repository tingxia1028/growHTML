// panes — PURE open-panes model for the multi-document workspace (F1 / P-A1).
//
// The workspace used to key everything to ONE `activeSourceId`. F1 replaces that with a
// list of OPEN PANES (each a reader bound to its own source) + a single `focusedPaneId`.
// `activeSourceId` becomes a DERIVED shim over the focused pane, so every single-pane
// caller keeps working unchanged (the migration keystone — see WorkspaceContext.tsx).
//
// This module holds ONLY the pure tree/list edits (open / focus / close / dedup / prune)
// so they are unit-testable without React or a DOM, mirroring dock.ts's pure helpers.
// The React state + effects live in WorkspaceContext; the dock leaf/split geometry stays
// in dock.ts. V1 is single-instance-per-source: paneId is a deterministic function of the
// sourceId, so opening the same source twice DEDUPES to focusing the existing pane.

// The reader sub-state a pane owns (was global top-level state before F1). Deliberately
// small in V1 — no per-pane Layer Lens (delta 2: layer filtering is scoped to the FOCUSED
// pane only, which reads the single global enabledLayerIds).
export type PaneViewState = {
  scrollTop?: number; // reader scroll offset
  page?: number; // PDF.js current page
  zoom?: number; // PDF.js zoom
};

export type OpenPane = {
  /** Stable id; deterministic from sourceId in V1 (single-instance-per-source). */
  paneId: string;
  /** The document this pane shows → the source.viewer leaf's node.params.sourceId. */
  sourceId: string;
  viewState: PaneViewState;
};

// paneId = "pane:" + sourceId. Deterministic so opening the same source dedups + the id
// is stable across reloads (persistence) and re-derivable from a bare sourceId.
export function paneIdFor(sourceId: string): string {
  return `pane:${sourceId}`;
}

// The sourceId a pane shows (the inverse of paneIdFor for the panes we actually track).
export function sourceOfPane(panes: readonly OpenPane[], paneId: string): string {
  return panes.find((pane) => pane.paneId === paneId)?.sourceId ?? "";
}

// The focused pane (the one selection / anchor / source actions target), or null. Falls
// back to the first pane if `focusedPaneId` names nothing (a stale id after a close), so
// the shim never strands on an empty focus while panes remain open.
export function focusedPane(panes: readonly OpenPane[], focusedPaneId: string): OpenPane | null {
  return panes.find((pane) => pane.paneId === focusedPaneId) ?? panes[0] ?? null;
}

export type PanesState = { openPanes: OpenPane[]; focusedPaneId: string };

// Open a pane for `sourceId` (or focus the existing one). V1 single-instance-per-source:
// if a pane for this source is already open, this is a pure focus flip (no duplicate). A
// new pane appends to the list and becomes focused. Empty sourceId is a no-op.
export function openOrFocusPane(state: PanesState, sourceId: string): PanesState {
  if (!sourceId) return state;
  const paneId = paneIdFor(sourceId);
  const existing = state.openPanes.find((pane) => pane.paneId === paneId);
  if (existing) {
    if (state.focusedPaneId === paneId) return state;
    return { openPanes: state.openPanes, focusedPaneId: paneId };
  }
  const pane: OpenPane = { paneId, sourceId, viewState: {} };
  return { openPanes: [...state.openPanes, pane], focusedPaneId: paneId };
}

// Switch the FOCUSED pane to a different source (the single-document "open replaces the
// current doc" behavior — a library-row click with one pane open). If a pane for the
// target source is already open, focus it (dedup) instead of duplicating; if nothing is
// open, open a new pane. This keeps the single-pane path byte-identical to the pre-F1
// "one active source, clicking switches it" UX while the workspace can still grow panes
// via the explicit openOrFocusPane (open-in-new-pane) entry.
export function switchFocusedPane(state: PanesState, sourceId: string): PanesState {
  if (!sourceId) return state;
  const targetPaneId = paneIdFor(sourceId);
  // Already open elsewhere → just focus it (no duplicate, no clobber).
  if (state.openPanes.some((pane) => pane.paneId === targetPaneId)) {
    return focusPane(state, targetPaneId);
  }
  const focused = focusedPane(state.openPanes, state.focusedPaneId);
  if (!focused) return openOrFocusPane(state, sourceId);
  // Replace the focused pane's source in place (same slot → single tab preserved).
  const replaced: OpenPane = { paneId: targetPaneId, sourceId, viewState: {} };
  return {
    openPanes: state.openPanes.map((pane) => (pane.paneId === focused.paneId ? replaced : pane)),
    focusedPaneId: targetPaneId
  };
}

// Focus an already-open pane. A stale/unknown id is ignored (state unchanged).
export function focusPane(state: PanesState, paneId: string): PanesState {
  if (paneId === state.focusedPaneId) return state;
  if (!state.openPanes.some((pane) => pane.paneId === paneId)) return state;
  return { openPanes: state.openPanes, focusedPaneId: paneId };
}

// Close a pane. When the closed pane was focused, focus flips to the neighbour that took
// its slot (the next pane, else the previous), so focus never lands on nothing while other
// panes remain. Closing the last pane leaves an empty workspace (focusedPaneId = "").
export function closePane(state: PanesState, paneId: string): PanesState {
  const index = state.openPanes.findIndex((pane) => pane.paneId === paneId);
  if (index < 0) return state;
  const openPanes = state.openPanes.filter((pane) => pane.paneId !== paneId);
  if (state.focusedPaneId !== paneId) {
    return { openPanes, focusedPaneId: state.focusedPaneId };
  }
  const next = openPanes[index] ?? openPanes[index - 1] ?? null;
  return { openPanes, focusedPaneId: next?.paneId ?? "" };
}

// Drop every pane whose source no longer resolves (a source was deleted). Focus follows
// the same "stay if still open, else the neighbour, else nothing" rule as closePane so a
// pruned focused pane collapses cleanly (delta 4 — pane-prune is actually wired).
export function prunePanes(state: PanesState, liveSourceIds: ReadonlySet<string>): PanesState {
  const keep = state.openPanes.filter((pane) => liveSourceIds.has(pane.sourceId));
  if (keep.length === state.openPanes.length) return state;
  const stillFocused = keep.some((pane) => pane.paneId === state.focusedPaneId);
  return {
    openPanes: keep,
    focusedPaneId: stillFocused ? state.focusedPaneId : (keep[0]?.paneId ?? "")
  };
}

// —— Persistence (mirrors the RECENT_SOURCE_IDS_KEY localStorage pattern) ——————————————

const OPEN_PANES_KEY = "sv-open-panes";

// Parse a stored value into a clean PanesState (drops malformed panes; a focusedPaneId
// that names no surviving pane falls back to the first). Pure so it is unit-testable.
export function parsePanesState(raw: unknown): PanesState {
  if (!raw || typeof raw !== "object") return { openPanes: [], focusedPaneId: "" };
  const r = raw as { openPanes?: unknown; focusedPaneId?: unknown };
  const openPanes: OpenPane[] = Array.isArray(r.openPanes)
    ? r.openPanes
        .filter(
          (p): p is { paneId: string; sourceId: string; viewState?: PaneViewState } =>
            !!p && typeof p === "object" && typeof (p as { sourceId?: unknown }).sourceId === "string"
        )
        .map((p) => ({
          paneId: typeof p.paneId === "string" && p.paneId ? p.paneId : paneIdFor(p.sourceId),
          sourceId: p.sourceId,
          viewState: p.viewState && typeof p.viewState === "object" ? p.viewState : {}
        }))
    : [];
  const focusedRaw = typeof r.focusedPaneId === "string" ? r.focusedPaneId : "";
  const focusedPaneId = openPanes.some((p) => p.paneId === focusedRaw)
    ? focusedRaw
    : (openPanes[0]?.paneId ?? "");
  return { openPanes, focusedPaneId };
}

// Read the persisted panes (empty on absent/malformed storage). Callers reconcile the
// result against the live sources list (prunePanes) before adopting it.
export function readStoredPanes(): PanesState {
  try {
    const raw = globalThis.localStorage?.getItem(OPEN_PANES_KEY);
    return raw ? parsePanesState(JSON.parse(raw)) : { openPanes: [], focusedPaneId: "" };
  } catch {
    return { openPanes: [], focusedPaneId: "" };
  }
}

// Persist the open panes + focus. No-ops if storage is unavailable.
export function persistPanes(state: PanesState): void {
  try {
    globalThis.localStorage?.setItem(OPEN_PANES_KEY, JSON.stringify(state));
  } catch {
    // storage unavailable — keep the in-memory panes only
  }
}
