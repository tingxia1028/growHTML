// Shared OVERLAY-surface helpers for the two region-capable host-page readers
// (PdfReader over a pdf.js page, ImageReader over an <img>). Both capture a
// geometric region the same way — rubber-band a marquee over an element, then
// normalize the rect to [x,y,w,h] in 0..1 of that element — and both paint stored
// regions back the same way (an absolutely-positioned box that hooks the shared
// note card). Only the element being dragged over differs, so that gesture +
// box-draw lives here once instead of being duplicated between the two readers.

import { applyHighlight, type HighlightPayload } from "../annotationLayer";
import { normalizeRect } from "../../core/region/region";
import type { Rect } from "../../core/region/region";

export type NormalizedRect = Rect;

// Minimum drag extent (px) below which a gesture is treated as a stray click.
const MIN_DRAG = 6;

// D4a — MODELESS region gesture classification (the mode-tab is gone). A pointer
// gesture on a region-capable overlay surface is a REGION rubber-band iff:
//   • Alt is held (the PRIMARY, unambiguous explicit trigger — always region), OR
//   • the gesture did NOT start over text (`overText === false`) — a BEST-EFFORT
//     convenience: dragging in a page margin / between glyphs (not on a `.textLayer`
//     span) reads as region. This is only best-effort because pdf.js text layers are
//     sparse (inter-glyph/line gaps + margins aren't in a span), so the non-text path
//     is additionally guarded downstream by isRealRegion/MIN_DRAG; Alt+drag is the
//     acceptance trigger. A plain gesture that STARTS on text stays a text selection.
// Pure (no DOM) — the caller resolves `overText` from the event target.
export function isRegionGesture(event: { altKey?: boolean }, overText: boolean): boolean {
  if (event.altKey) return true;
  return !overText;
}

// Normalize a drag (start + current point, both relative to `rect`) to a rect in
// 0..1 of `rect`, clamped to its bounds. Pure — unit-tested without the DOM. The
// math now lives once in core/region; re-exported here under its original name so
// overlay stays the gesture/box home for the readers.
export const normalizeDragRect = normalizeRect;

// Whether a drag is large enough (and the element laid out) to be a real region
// rather than a stray click. Pure.
export function isRealRegion(
  rect: { width: number; height: number },
  start: { x: number; y: number },
  current: { x: number; y: number }
): boolean {
  if (rect.width === 0 || rect.height === 0) return false;
  const curX = Math.max(0, Math.min(rect.width, current.x));
  const curY = Math.max(0, Math.min(rect.height, current.y));
  return Math.abs(curX - start.x) >= MIN_DRAG && Math.abs(curY - start.y) >= MIN_DRAG;
}

// Position an absolutely-positioned box element at a normalized rect (percent
// offsets so it tracks element resizes) and hook it to the shared note card.
export function placeRegionBox(
  box: HTMLElement,
  rect: NormalizedRect,
  note: string,
  id?: string,
  payload?: HighlightPayload
): void {
  const [x, y, w, h] = rect;
  box.style.left = `${x * 100}%`;
  box.style.top = `${y * 100}%`;
  box.style.width = `${w * 100}%`;
  box.style.height = `${h * 100}%`;
  if (id) box.setAttribute("data-anchor-id", id);
  applyHighlight(box, note, id, payload);
}
