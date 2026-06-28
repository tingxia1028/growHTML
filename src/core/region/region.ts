import { z } from "zod";
import type { AnchorKind } from "../schema/anchor";
import type { RematchContext, RematchResult } from "../study-layer/rematch";

// Region selection, named as ONE source-agnostic principle — the geometric
// counterpart of the text path's TextQuoteSelector. Every rect that appears in the
// schema, the client gesture, and the rematch resolver resolves to the single
// definitions here, so "this surface renders to a box, therefore it supports region
// selection" becomes a concept with one home instead of logic re-derived per kind.
// Pure + dependency-light (only zod) so it is a runtime leaf — no import cycles.

// A normalized rectangle [x, y, w, h] in 0..1 of some rendered box.
export type Rect = [number, number, number, number];

// Which box a Rect is normalized to: a pdf page, or the whole single-box surface
// (an image today; any whole-surface region later). The two spaces that exist —
// polygon / time-range are deliberately deferred (see §5 Risks).
export type RegionSpace =
  | { kind: "page"; page: number }
  | { kind: "whole" };

// The named region locator, mirroring TextQuoteSelector.
export type RegionTarget = { rect: Rect; space: RegionSpace };

// The ONE rect zod. Both region-carrying anchor schemas import this instead of
// inlining the tuple, so the stored JSON shape has a single source of truth.
// Infers to Rect; pdf uses `.optional()`, image uses it required — same as before.
export const rectSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]);

// Normalize a drag (start + current point, both relative to `rect`) to a Rect in
// 0..1 of `rect`, clamped to its bounds. THE home of the normalize math — moved
// verbatim from overlay.ts::normalizeDragRect; overlay.ts re-exports it under that
// name so the client readers and core share one definition. Pure (DOM-free).
export function normalizeRect(
  rect: { width: number; height: number },
  start: { x: number; y: number },
  current: { x: number; y: number }
): Rect {
  const curX = Math.max(0, Math.min(rect.width, current.x));
  const curY = Math.max(0, Math.min(rect.height, current.y));
  const x0 = Math.min(start.x, curX);
  const y0 = Math.min(start.y, curY);
  const w = Math.abs(curX - start.x);
  const h = Math.abs(curY - start.y);
  return [x0 / rect.width, y0 / rect.height, w / rect.width, h / rect.height];
}

// The ONE rect resolver — the region-mode counterpart of rematchText. A region
// re-locates by binary identity: same binary => the stored rect is exact (matched),
// otherwise it may have shifted (fuzzy). Behavior is identical to the inline rect
// tails that lived in rematch.ts (pdf_selection / image_region). `target` is carried
// for symmetry + future use; resolution today depends only on ctx.sameBinary.
export function rematchRegion(
  _target: RegionTarget,
  ctx: Pick<RematchContext, "sameBinary">
): RematchResult {
  return { status: ctx.sameBinary === false ? "fuzzy" : "matched" };
}

// Whether an anchorKind is region-capable (carries a rect locator): pdf_selection
// (when it has a rect — figures/scans) or image_region. Names the kinds the rect
// principle spans, without merging them.
export function isRegionAnchorKind(kind: AnchorKind): boolean {
  return kind === "pdf_selection" || kind === "image_region";
}
