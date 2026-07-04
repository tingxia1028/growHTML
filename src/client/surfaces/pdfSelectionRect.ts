// 转为区域 (D4a) — the pure geometry that turns a PDF TEXT selection into a REGION
// rect. When the user has a text selection on a pdf.js page and picks "转为区域", we
// convert the selection's viewport bounding box into a normalized [x,y,w,h] rect in
// 0..1 of the PAGE box — the SAME shape a rubber-band drag produces — so it flows
// through the existing region draft → regionTargetToRequest → pdf_selection{page,rect}
// path with ZERO schema change.
//
// Pure (DOM-free): the caller passes the two already-measured rects (the page box and
// the selection box, both in the same viewport coordinate space). It reuses core's
// normalizeRect by expressing the selection as a start/current point pair relative to
// the page's top-left, so the clamp + 0..1 math lives in exactly one place.

import { normalizeRect, type Rect } from "../../core/region/region";

/** A viewport rectangle (getBoundingClientRect shape) — only the fields we read. */
export type ViewportRect = { left: number; top: number; width: number; height: number };

// Convert a text selection's viewport box to a normalized page rect. Both rects are in
// the SAME coordinate space (viewport). The selection's top-left and bottom-right become
// the drag start/current points relative to the page origin, then normalizeRect clamps
// them into 0..1 of the page box.
export function selectionRectToPageRect(pageRect: ViewportRect, selRect: ViewportRect): Rect {
  const start = { x: selRect.left - pageRect.left, y: selRect.top - pageRect.top };
  const current = {
    x: selRect.left + selRect.width - pageRect.left,
    y: selRect.top + selRect.height - pageRect.top
  };
  return normalizeRect({ width: pageRect.width, height: pageRect.height }, start, current);
}
