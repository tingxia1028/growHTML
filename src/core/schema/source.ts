import { z } from "zod";
import { recordEnvelopeSchema, sourceIdSchema } from "./common";

export const sourceTypeSchema = z.enum([
  "html",
  "markdown",
  "pdf",
  "image",
  "word",
  "webpage",
  "web_live",
  "code",
  "transcript"
]);

export const sourceSchema = recordEnvelopeSchema("source", sourceIdSchema).extend({
  sourceType: sourceTypeSchema,
  title: z.string().min(1),
  path: z.string().min(1),
  mimeType: z.string().min(1).optional(),
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/)
  // `metadata` now comes from the shared record envelope.
});

export type SourceType = z.infer<typeof sourceTypeSchema>;
export type SourceRecord = z.infer<typeof sourceSchema>;

