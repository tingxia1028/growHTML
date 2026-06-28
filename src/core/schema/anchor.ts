import { z } from "zod";
import { rectSchema } from "../region/region";
import { anchorIdSchema, layerIdSchema, recordEnvelopeSchema, sourceIdSchema } from "./common";

export const anchorKindSchema = z.enum([
  "html_selection",
  "pdf_selection",
  "code_range",
  "image_region",
  "web_text_quote"
]);

const anchorEnvelopeSchema = recordEnvelopeSchema("anchor", anchorIdSchema).extend({
  sourceId: sourceIdSchema,
  // Default empty so geometric anchors (image regions, PDF figures) can omit it;
  // text-based kinds (html/web) re-require it below.
  quote: z.string().default(""),
  contextBefore: z.string().default(""),
  contextAfter: z.string().default(""),
  // Study Layer membership. DEPRECATED as the paint filter — anchor visibility is
  // now DERIVED from the notes referencing this anchor (an anchor paints iff it has
  // a note in an enabled layer). Kept for backward-compat and standalone/legacy
  // anchors; optional, and migration still backfills it onto the "owned" layer.
  layerId: layerIdSchema.optional(),
  // Set only on imported anchors — how confidently the rematch resolver re-located
  // the portable quote in the importer's local source copy.
  matchStatus: z.enum(["matched", "fuzzy", "unmatched"]).optional()
});

export const htmlSelectionAnchorSchema = anchorEnvelopeSchema.extend({
  anchorKind: z.literal("html_selection"),
  quote: z.string().min(1),
  studyId: z.string().min(1),
  selector: z.string().min(1)
});

export const pdfSelectionAnchorSchema = anchorEnvelopeSchema.extend({
  anchorKind: z.literal("pdf_selection"),
  page: z.number().int().positive(),
  // Geometric hint in normalized page coords [x, y, w, h] (0..1). Primary
  // re-location is by page + quote when there's text; rect is the fallback and
  // the only locator for figures / scanned pages (where quote is empty).
  rect: rectSchema.optional()
});

export const codeRangeAnchorSchema = anchorEnvelopeSchema.extend({
  anchorKind: z.literal("code_range"),
  filePath: z.string().min(1),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  symbol: z.string().optional()
});

export const imageRegionAnchorSchema = anchorEnvelopeSchema.extend({
  anchorKind: z.literal("image_region"),
  rect: rectSchema
});

// Live web pages have no injected study-ids, so anchor by W3C TextQuoteSelector:
// the envelope's quote/contextBefore/contextAfter are the exact/prefix/suffix.
export const webTextQuoteAnchorSchema = anchorEnvelopeSchema.extend({
  anchorKind: z.literal("web_text_quote"),
  normalizedUrl: z.string().min(1)
});

export const anchorSchema = z.discriminatedUnion("anchorKind", [
  htmlSelectionAnchorSchema,
  pdfSelectionAnchorSchema,
  codeRangeAnchorSchema,
  imageRegionAnchorSchema,
  webTextQuoteAnchorSchema
]);

export type AnchorKind = z.infer<typeof anchorKindSchema>;
export type HtmlSelectionAnchor = z.infer<typeof htmlSelectionAnchorSchema>;
export type WebTextQuoteAnchor = z.infer<typeof webTextQuoteAnchorSchema>;
export type PdfSelectionAnchor = z.infer<typeof pdfSelectionAnchorSchema>;
export type AnchorRecord = z.infer<typeof anchorSchema>;

