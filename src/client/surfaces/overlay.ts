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
