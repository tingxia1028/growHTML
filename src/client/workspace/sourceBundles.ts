// sourceBundles — the PURE per-source reader-data cache for the multi-document
// workspace (F1 / P-A1 §A.1). The reader entity data (rendered HTML + anchors + notes +
// patches + layers) USED to be single top-level state keyed to the one active source.
// With multiple open panes each pane needs ITS OWN source's data, so the data becomes a
// Map<sourceId, SourceBundle> — filled when a pane opens, reused across panes/refocus.
//
// Kept pure (no React, no fetch) so the cache round-trip is unit-testable; the React
// state + the entityClient fetch live in WorkspaceContext. The focused pane's bundle is
// MIRRORED into the existing top-level anchors/notes/patches/sourceLayers/renderedHtml
// state so all 8 per-source memos (paintAnchors/visibleNotes/…) keep deriving unchanged.

import type { AnyAnchor, NoteRecord, PatchRecord, StudyLayerRecord } from "../data/entityClient";

// One source's full reader data — exactly the five fields loadSourceWorkspace fetched
// into top-level state before F1.
export type SourceBundle = {
  renderedHtml: string;
  anchors: AnyAnchor[];
  notes: NoteRecord[];
  patches: PatchRecord[];
  sourceLayers: StudyLayerRecord[];
};

export const EMPTY_BUNDLE: SourceBundle = {
  renderedHtml: "",
  anchors: [],
  notes: [],
  patches: [],
  sourceLayers: []
};

// Write a source's bundle into the cache (a NEW map so React re-renders on set). Replaces
// any prior bundle for the same source (a fresh fetch supersedes a stale one).
export function putBundle(
  bundles: ReadonlyMap<string, SourceBundle>,
  sourceId: string,
  bundle: SourceBundle
): Map<string, SourceBundle> {
  const next = new Map(bundles);
  next.set(sourceId, bundle);
  return next;
}

// Read a source's cached bundle, or null when it hasn't been fetched yet.
export function getBundle(
  bundles: ReadonlyMap<string, SourceBundle>,
  sourceId: string
): SourceBundle | null {
  return bundles.get(sourceId) ?? null;
}

// Whether a source's bundle is already cached (the "no-refetch on refocus" gate — the
// load effect skips the network when a pane refocuses onto an already-loaded source).
export function hasBundle(bundles: ReadonlyMap<string, SourceBundle>, sourceId: string): boolean {
  return bundles.has(sourceId);
}

// Drop cache entries for sources that no longer exist (mirrors pane-prune). Returns the
// SAME map when nothing was removed so callers can skip a re-render.
export function pruneBundles(
  bundles: ReadonlyMap<string, SourceBundle>,
  liveSourceIds: ReadonlySet<string>
): Map<string, SourceBundle> {
  const next = new Map<string, SourceBundle>();
  for (const [id, bundle] of bundles) if (liveSourceIds.has(id)) next.set(id, bundle);
  return next;
}
