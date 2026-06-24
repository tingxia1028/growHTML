import { createEntityId } from "../../core/ids";
import { webTextQuoteAnchorSchema, type CreatedBy, type WebTextQuoteAnchor } from "../../core/schema";

export type WebTextQuoteDraft = {
  sourceId: string;
  normalizedUrl: string;
  /** exact (TextQuoteSelector) */
  quote: string;
  /** prefix */
  contextBefore?: string;
  /** suffix */
  contextAfter?: string;
  createdBy?: CreatedBy;
  createdAt?: string;
};

// Builds a W3C TextQuoteSelector anchor for a live web page: no study-ids, the
// envelope's quote/contextBefore/contextAfter carry exact/prefix/suffix.
export function createWebTextQuoteAnchor(draft: WebTextQuoteDraft): WebTextQuoteAnchor {
  const now = draft.createdAt ?? new Date().toISOString();
  return webTextQuoteAnchorSchema.parse({
    id: createEntityId("anchor"),
    type: "anchor",
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    createdBy: draft.createdBy ?? "user",
    sourceId: draft.sourceId,
    anchorKind: "web_text_quote",
    normalizedUrl: draft.normalizedUrl,
    quote: draft.quote,
    contextBefore: draft.contextBefore ?? "",
    contextAfter: draft.contextAfter ?? ""
  });
}
