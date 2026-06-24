// Geometry helpers for rectangular region anchors (images + PDF figures).
// Pure + framework-free so the normalization math is unit-testable without a DOM.
//
// A region is stored as a normalized rect [x, y, w, h] with every component in
// 0..1, relative to the target's intrinsic box. Normalizing makes the anchor
// resolution-independent: it survives the image/page being rendered at any zoom.

export type NormRect = [number, number, number, number];

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

// Two drag points (in pixels, relative to a box of width×height) → a normalized
// rect, regardless of drag direction. Clamped to the box.
export function normalizeRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width: number,
  height: number
): NormRect {
  if (width <= 0 || height <= 0) return [0, 0, 0, 0];
  const left = clamp01(Math.min(x0, x1) / width);
  const top = clamp01(Math.min(y0, y1) / height);
  const right = clamp01(Math.max(x0, x1) / width);
  const bottom = clamp01(Math.max(y0, y1) / height);
  return [left, top, right - left, bottom - top];
}

// Normalized rect → pixel box for the current rendered size.
export function denormalizeRect(rect: NormRect, width: number, height: number): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
  return { left: rect[0] * width, top: rect[1] * height, width: rect[2] * width, height: rect[3] * height };
}

// A drag is only a region (not an accidental click) once it covers a minimum
// fraction of the box in both axes.
export function isMeaningfulRegion(rect: NormRect, minFraction = 0.01): boolean {
  return rect[2] >= minFraction && rect[3] >= minFraction;
}
