// The ONE uniform "annotation surface" contract.
//
// Selection (READ) and anchor painting (WRITE) are the two directions of the SAME
// per-surface seam. There are exactly three annotation-capable surfaces — the DOM
// iframe (imported HTML/markdown), the Electron <webview> (live web + local HTML),
// and the overlay surface (PDF.js + image) — plus the native `file` iframe which
// can't annotate at all. Each surface's MECHANISM is irreducibly different (a
// contentDocument we own vs. an IPC bridge to a separate WebContents vs. a
// host-page canvas/overlay), but the CONTRACT the host drives them through is
// identical, so the host (App/Workspace) treats every reader the same and a new
// viewer only has to implement one adapter.
//
// A surface reader therefore takes exactly two annotation props (plus its own
// src/url/fileUrl): `anchors` (WRITE — paint the ones it understands) and
// `onSelect` (READ — emit a normalized AnchorDraft). The host computes ONE
// normalized paintAnchors list and hands the SAME list + the SAME onSelect to
// whichever reader matches the active source.

import type { AnchorDraft } from "../focus/FocusContext";

// Normalized "what to draw" for any surface (the WRITE direction). The host builds
// one list of these for the active source — every anchor it has, each with the
// merged note text for the hover card — and every reader filters by `anchorKind`
// to the subset it can paint. The optional locator fields are a superset across
// surfaces; a given anchorKind only uses the ones relevant to it:
//   html_selection → quote (+ context) ; painted on the DOM iframe
//   web_text_quote → quote (+ context) ; painted in the webview guest
//   pdf_selection  → page + quote (text highlight) OR page + rect (region box)
//   image_region   → rect (region box)
export type PaintAnchor = {
  id: string;
  anchorKind: "html_selection" | "web_text_quote" | "pdf_selection" | "image_region";
  quote?: string;
  contextBefore?: string;
  contextAfter?: string;
  // html_selection: the injected id of the element to highlight (fast path; the
  // quote is the edit-resilient fallback when the id is gone).
  studyId?: string;
  page?: number;
  rect?: [number, number, number, number];
  // The merged text of every note hanging off this anchor, for the hover card.
  note: string;
};

// The uniform props EVERY reader component accepts. `anchors` is the host's single
// paintAnchors list (the reader filters it); `onSelect` is the host's single
// `focus.setDraft` (the reader emits a normalized AnchorDraft into it). A reader
// also takes its own source locator (src / url / fileUrl) — that's the only thing
// that differs between readers at the call site.
export type SurfaceReaderProps = {
  // WRITE: paint the anchors this surface understands (filter by anchorKind).
  anchors: PaintAnchor[];
  // READ: emit a normalized AnchorDraft (the quote|region union from FocusContext).
  onSelect: (draft: AnchorDraft) => void;
};

// Filter the host's paintAnchors to the kinds a surface paints — the shared WRITE
// helper so each adapter declares the kinds it understands once.
export function anchorsOfKind(anchors: PaintAnchor[], ...kinds: PaintAnchor["anchorKind"][]): PaintAnchor[] {
  return anchors.filter((anchor) => kinds.includes(anchor.anchorKind));
}
