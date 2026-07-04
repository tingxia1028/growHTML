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
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  // `metadata` now comes from the shared record envelope.
  // —— SRC-1/2 (docs/design/source-authoring.md §3, additive) ——
  // Provenance: documents born in the app ("authored") have an editable body; every
  // ingested/imported document stays read-only ("imported"). Older records without
  // the field parse as "imported" — the safe default.
  origin: z.enum(["authored", "imported"]).default("imported"),
  // Edit revision: starts at 1, bumps on every content save (SRC-2 edit pipeline).
  revision: z.number().int().min(1).default(1)
});

export type SourceType = z.infer<typeof sourceTypeSchema>;
export type SourceRecord = z.infer<typeof sourceSchema>;

