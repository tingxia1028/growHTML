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
import type { AnchorDraft } from "../focus/FocusContext";
import type { PaintAnchor, PaintAnchorStyle } from "../surfaces/types";
import { BOOKMARK_CONTENT_TYPE } from "../../core/notes/contentTypes";
import { noteText } from "./WorkspaceContext";
import { renderAnnotationNotePreview } from "./annotationNotePreview";

export const DRAFT_REGION_ANCHOR_ID = "__draft_region_anchor__";

export function regionDraftToAnchor(draft: AnchorDraft | null | undefined, activeSourceId: string): AnyAnchor | null {
  if (!draft || draft.mode !== "region" || !activeSourceId || draft.sourceId !== activeSourceId) return null;
  if (draft.kind === "pdf") {
    return {
      id: DRAFT_REGION_ANCHOR_ID,
      sourceId: draft.sourceId,
      anchorKind: "pdf_selection",
      page: draft.page ?? 1,
      quote: "",
      contextBefore: "",
      contextAfter: "",
      rect: draft.rect
    };
  }
  return {
    id: DRAFT_REGION_ANCHOR_ID,
    sourceId: draft.sourceId,
    anchorKind: "image_region",
    rect: draft.rect,
    quote: ""
  };
}

export function mergeFocusedRegionDraft(
  anchors: AnyAnchor[],
  draft: AnchorDraft | null | undefined,
  activeSourceId: string
): AnyAnchor[] {
  const draftAnchor = regionDraftToAnchor(draft, activeSourceId);
  if (!draftAnchor) return anchors;
  return [...anchors.filter((anchor) => anchor.id !== DRAFT_REGION_ANCHOR_ID), draftAnchor];
}

// D3a (note-presentation-unified §D3) — resolve the PAINT style for one anchor from its
// NOTES' enabled layers. An anchor has no layer of its own; its lens membership is the
// UNION of its notes' `layerIds` (note.ts:66 — NOT the deprecated `anchor.layerId`). We
// pick the first ENABLED layer (by `order`, undefined last — server list order is not
// guaranteed, delta 3) that carries a paint style, and read its color with the precedence
// style.color > layer.color, plus its style.decoration. Returns undefined when no such
// layer exists — the caller then omits the `style` key entirely (delta 7), so an un-styled
// PaintAnchor is byte-identical to the pre-D3a shape.
export function resolveAnchorPaintStyle(
  anchorNotes: NoteRecord[],
  sourceLayers: StudyLayerRecord[],
  enabledLayerIds: ReadonlySet<string>
): PaintAnchorStyle | undefined {
  // The layer ids this anchor's notes claim (deduped).
  const layerIds = new Set<string>();
  for (const note of anchorNotes) for (const id of note.layerIds) layerIds.add(id);
  if (layerIds.size === 0) return undefined;

  // Candidate layers: this anchor's, enabled, in a STABLE order (order asc, undefined
  // last) so two colored enabled layers resolve deterministically regardless of the
  // server's list order.
  const candidates = sourceLayers
    .filter((layer) => layerIds.has(layer.id) && enabledLayerIds.has(layer.id))
    .sort((a, b) => (a.order ?? Number.POSITIVE_INFINITY) - (b.order ?? Number.POSITIVE_INFINITY));

  for (const layer of candidates) {
    const color = layer.style?.color ?? layer.color;
    const decoration = layer.style?.decoration;
    if (color || decoration) {
      const style: PaintAnchorStyle = {};
      if (color) style.color = color;
      if (decoration) style.decoration = decoration;
      return style;
    }
  }
  return undefined;
}

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
  sourceLayers: StudyLayerRecord[],
  enabledLayerIds: ReadonlySet<string>
): PaintAnchor {
  const anchorNotes = notesByAnchorId.get(anchor.id) ?? [];
  // D3a: the resolved paint style, or undefined when no enabled layer styles this anchor.
  const style = resolveAnchorPaintStyle(anchorNotes, sourceLayers, enabledLayerIds);
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
    })),
    // Omit the key unless defined (delta 7) — keeps an un-styled PaintAnchor byte-
    // identical to the pre-D3a shape (the existing toEqual byte-lock stays green).
    ...(style ? { style } : {})
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
    .map((anchor) => mapPaintAnchor(anchor, notesByAnchorId, sourceLayers, enabledLayerIds));
  const revealAnchors = visibleAnchors.map((anchor) =>
    mapPaintAnchor(anchor, notesByAnchorId, sourceLayers, enabledLayerIds)
  );
  return { paintAnchors, revealAnchors };
}
