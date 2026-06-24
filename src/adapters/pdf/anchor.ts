import { createEntityId } from "../../core/ids";
import { pdfSelectionAnchorSchema, type CreatedBy, type PdfSelectionAnchor } from "../../core/schema";

export type PdfSelectionDraft = {
  sourceId: string;
  page: number;
  /** Selected text (TextQuoteSelector exact). */
  quote: string;
  contextBefore?: string;
  contextAfter?: string;
  rect?: [number, number, number, number];
  createdBy?: CreatedBy;
  createdAt?: string;
};

// PDF selections are relocated by page + quote (envelope quote/contextBefore/
// contextAfter form a per-page TextQuoteSelector); rect is an optional hint.
export function createPdfSelectionAnchor(draft: PdfSelectionDraft): PdfSelectionAnchor {
  const now = draft.createdAt ?? new Date().toISOString();
  return pdfSelectionAnchorSchema.parse({
    id: createEntityId("anchor"),
    type: "anchor",
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    createdBy: draft.createdBy ?? "user",
    sourceId: draft.sourceId,
    anchorKind: "pdf_selection",
    page: draft.page,
    rect: draft.rect,
    quote: draft.quote,
    contextBefore: draft.contextBefore ?? "",
    contextAfter: draft.contextAfter ?? ""
  });
}
