import { z } from "zod";
import { anchorIdSchema, recordEnvelopeSchema, sourceIdSchema } from "./common";

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
  contextAfter: z.string().default("")
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
  rect: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional()
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
  rect: z.tuple([z.number(), z.number(), z.number(), z.number()])
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
export type ImageRegionAnchor = z.infer<typeof imageRegionAnchorSchema>;
export type AnchorRecord = z.infer<typeof anchorSchema>;

