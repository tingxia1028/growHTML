import { createEntityId } from "../../core/ids";
import { imageRegionAnchorSchema, type CreatedBy, type AnchorRecord } from "../../core/schema";

export type ImageRegionDraft = {
  sourceId: string;
  /** Normalized region in image coords [x, y, w, h] (0..1). */
  rect: [number, number, number, number];
  /** Optional human label / OCR text for the region. */
  quote?: string;
  createdBy?: CreatedBy;
  createdAt?: string;
};

// Image regions are purely geometric (a rubber-banded rectangle over the image);
// they carry no text locator, only the normalized rect. Mirrors createPdf/Html
// anchor builders so the server path is uniform.
export function createImageRegionAnchor(draft: ImageRegionDraft): AnchorRecord {
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
    quote: draft.quote ?? ""
  });
}
