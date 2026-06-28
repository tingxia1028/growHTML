// PDF zoom math — the tiny pure core behind the PdfReader's zoom controls.
// Kept PDF-only (the other overlay reader, ImageReader, has no zoom; rule-of-three
// is not met, so there is intentionally no cross-reader zoom abstraction). Lives as
// pure functions so the clamp/step logic is unit-testable without pdf.js or the DOM.

// Zoom bounds + step. The numeric scale is pdf.js's `currentScale` (1 = 100%, i.e.
// the page at its intrinsic CSS size). Bounds are tighter than pdf.js's own
// MIN_SCALE/MAX_SCALE (0.1 / 25) — a study reader never needs 2500% — but the step
// mirrors pdf.js's DEFAULT_SCALE_DELTA (1.1) so each click is a familiar ~10%.
export const MIN_SCALE = 0.25;
export const MAX_SCALE = 4.0;
export const ZOOM_STEP = 1.1;

// Clamp an arbitrary scale into [MIN_SCALE, MAX_SCALE]. Non-finite input (NaN from
// a not-yet-laid-out viewer) falls back to MIN_SCALE so callers never push NaN into
// pdf.js's `currentScale` setter (which throws on NaN).
export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return MIN_SCALE;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

// The scale one zoom click away from `current`, in `direction` (+1 = in, -1 = out),
// multiplicatively stepped by ZOOM_STEP and clamped to bounds. Multiplicative (not
// additive) so zooming feels even at every magnification — the pdf.js convention.
export function nextZoom(current: number, direction: 1 | -1): number {
  const base = Number.isFinite(current) ? current : MIN_SCALE;
  return clampScale(direction > 0 ? base * ZOOM_STEP : base / ZOOM_STEP);
}

// Format a numeric scale as a whole-percent label for the zoom indicator (1.2 → "120%").
export function formatZoomPct(scale: number): string {
  return `${Math.round(clampScale(scale) * 100)}%`;
}
