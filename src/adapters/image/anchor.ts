import { createEntityId } from "../../core/ids";
import { imageRegionAnchorSchema, type CreatedBy, type ImageRegionAnchor } from "../../core/schema";

export type ImageRegionDraft = {
  sourceId: string;
  /** Region in normalized image coords [x, y, w, h] (0..1) — resolution-independent. */
  rect: [number, number, number, number];
  /** Optional human label / OCR text for the region (envelope quote). May be empty. */
  quote?: string;
  contextBefore?: string;
  contextAfter?: string;
  createdBy?: CreatedBy;
  createdAt?: string;
};

// Image regions are located purely geometrically (a normalized rect over the
// image), so unlike text anchors they need no quote — the picture doesn't reflow.
// An optional quote can still carry a caption / OCR snippet for search.
export function createImageRegionAnchor(draft: ImageRegionDraft): ImageRegionAnchor {
  const now = draft.createdAt ?? new Date().toISOString();
  return imageRegionAnchorSchema.parse({
    id: createEntityId("anchor"),
    type: "anchor",
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    createdBy: draft.createdBy ?? "user",
    sourceId: draft.sourceId,
    anchorKind: "image_region",
    rect: draft.rect,
    quote: draft.quote ?? "",
    contextBefore: draft.contextBefore ?? "",
    contextAfter: draft.contextAfter ?? ""
  });
}
