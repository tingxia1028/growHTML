// paneSelectors — the PURE per-pane paint pipeline (F1 / P-A2). Extracted VERBATIM from
// the WorkspaceContext memos (visibleNotes → notesByAnchorId / bookmarkOnlyAnchorIds →
// paintAnchors / revealAnchors) so the FOCUSED pane's memos can call it with the focused
// bundle and produce a BYTE-IDENTICAL result (the regression lock), while each open pane
// can call it with ITS OWN bundle to paint its own source (cross-doc paint is emergent:
// a note anchored in A and B appears in notesForSource(A) AND notesForSource(B)).
//
// Layer filtering is scoped to the FOCUSED pane in V1 (delta 2 — no per-pane Layer Lens):
// callers pass the single global `enabledLayerIds` set; a background pane paints under the
// same lens. Nothing here reads React state — the memoization + the focus merge stay in
// WorkspaceContext.

import type { AnyAnchor, NoteRecord, StudyLayerRecord } from "../data/entityClient";
import type { PaintAnchor } from "../surfaces/types";
import { BOOKMARK_CONTENT_TYPE } from "../../core/notes/contentTypes";
import { noteText } from "./WorkspaceContext";
import { renderAnnotationNotePreview } from "./annotationNotePreview";

// The enabled-layer "on" set for a bundle's layers (the multi-select filter). Mirrors the
// `enabledLayerIds` memo.
export function enabledLayerIdsOf(sourceLayers: StudyLayerRecord[]): Set<string> {
  return new Set(sourceLayers.filter((layer) => layer.enabled).map((layer) => layer.id));
}

// The layer-as-lens OR filter over notes (a note shows iff its layerIds intersect the
// enabled set, OR it has no layers). Mirrors the `visibleNotes` memo — this is
// `notesForSource(sourceId)` when fed a source's own notes + the enabled set.
export function notesForSource(notes: NoteRecord[], enabledLayerIds: ReadonlySet<string>): NoteRecord[] {
  return notes.filter(
    (note) => note.layerIds.length === 0 || note.layerIds.some((id) => enabledLayerIds.has(id))
  );
}

// note text per anchor id, from the FILTERED notes, bookmarks excluded. Mirrors the
// `notesByAnchorId` memo.
export function buildNotesByAnchorId(visibleNotes: NoteRecord[]): Map<string, NoteRecord[]> {
  const map = new Map<string, NoteRecord[]>();
  for (const note of visibleNotes) {
    if ((note.contentType ?? "markdown") === BOOKMARK_CONTENT_TYPE) continue;
    for (const anchorId of note.anchorIds) {
      const existing = map.get(anchorId) ?? [];
      map.set(anchorId, [...existing, note]);
    }
  }
  return map;
}

// Anchors carrying ONLY a bookmark note (≥1 bookmark, no real note) — they must not paint.
// Classified off the FULL notes list. Mirrors the `bookmarkOnlyAnchorIds` memo.
export function buildBookmarkOnlyAnchorIds(notes: NoteRecord[]): Set<string> {
  const bookmarked = new Set<string>();
  const hasRealNote = new Set<string>();
  for (const note of notes) {
    const isBookmark = (note.contentType ?? "markdown") === BOOKMARK_CONTENT_TYPE;
    for (const anchorId of note.anchorIds) {
      (isBookmark ? bookmarked : hasRealNote).add(anchorId);
    }
  }
  const out = new Set<string>();
  for (const id of bookmarked) if (!hasRealNote.has(id)) out.add(id);
  return out;
}

// Map ONE anchor to the uniform PaintAnchor shape with its merged note text/previews.
// The shared mapper for both paint + reveal lists — kept identical to the inline map so
// both output byte-for-byte what the memos did.
function mapPaintAnchor(
  anchor: AnyAnchor,
  notesByAnchorId: Map<string, NoteRecord[]>,
  sourceLayers: StudyLayerRecord[]
): PaintAnchor {
  const anchorNotes = notesByAnchorId.get(anchor.id) ?? [];
  return {
    id: anchor.id,
    anchorKind: anchor.anchorKind,
    quote: "quote" in anchor ? anchor.quote : undefined,
    contextBefore: "contextBefore" in anchor ? anchor.contextBefore : undefined,
    contextAfter: "contextAfter" in anchor ? anchor.contextAfter : undefined,
    studyId: "studyId" in anchor ? anchor.studyId : undefined,
    page: "page" in anchor ? anchor.page : undefined,
    rect: "rect" in anchor ? anchor.rect : undefined,
    note: anchorNotes.map((note) => noteText(note.content)).join("\n\n"),
    notePreviews: anchorNotes.map((note) => ({
      id: note.id,
      contentType: note.contentType ?? "markdown",
      text: noteText(note.content),
      html: renderAnnotationNotePreview(note, anchor, sourceLayers)
    }))
  };
}

export type PaintPipelineInput = {
  /** The pane's anchors (already merged with the focused anchor for the focused pane). */
  visibleAnchors: AnyAnchor[];
  /** The pane's notes (unfiltered — this fn applies the layer filter). */
  notes: NoteRecord[];
  /** The pane's layers (for the enabled set + the note-preview render). */
  sourceLayers: StudyLayerRecord[];
  /** The enabled-layer set (V1: the single global focused-pane lens — delta 2). */
  enabledLayerIds: ReadonlySet<string>;
};

// The full paint pipeline for one pane: visibleAnchors + notes + layers + enabled set →
// { paintAnchors (bookmark-only excluded), revealAnchors (all) }. Calling this with the
// FOCUSED bundle reproduces the old paintAnchors/revealAnchors byte-for-byte; calling it
// with another pane's bundle paints that pane's own source.
export function buildPaintPipeline(input: PaintPipelineInput): {
  paintAnchors: PaintAnchor[];
  revealAnchors: PaintAnchor[];
} {
  const { visibleAnchors, notes, sourceLayers, enabledLayerIds } = input;
  const visibleNotes = notesForSource(notes, enabledLayerIds);
  const notesByAnchorId = buildNotesByAnchorId(visibleNotes);
  const bookmarkOnlyAnchorIds = buildBookmarkOnlyAnchorIds(notes);
  const paintAnchors = visibleAnchors
    .filter((anchor) => !bookmarkOnlyAnchorIds.has(anchor.id))
    .map((anchor) => mapPaintAnchor(anchor, notesByAnchorId, sourceLayers));
  const revealAnchors = visibleAnchors.map((anchor) => mapPaintAnchor(anchor, notesByAnchorId, sourceLayers));
  return { paintAnchors, revealAnchors };
}
