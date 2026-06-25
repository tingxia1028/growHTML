import { z } from "zod";
import { layerIdSchema, recordEnvelopeSchema, sourceIdSchema, visibilitySchema } from "./common";
import { sourceTypeSchema } from "./source";

// SourceFingerprint — a content-based identity for a source, used to match an
// imported Study Layer to the importer's OWN copy of the same document (their
// sourceId differs from the author's). It is a value object: it lives on a layer
// and is written into the `.studypack` export. Match priority (strongest first):
// contentHash > fileHash > canonicalUrl > url > title.
export const sourceFingerprintSchema = z.object({
  contentHash: z.string().optional(),
  fileHash: z.string().optional(),
  canonicalUrl: z.string().optional(),
  url: z.string().optional(),
  title: z.string().optional(),
  sourceType: sourceTypeSchema.optional()
});

export const importModeSchema = z.enum(["owned", "imported", "subscribed"]);
export const matchStatusSchema = z.enum(["matched", "fuzzy", "unmatched"]);

// StudyLayer — the unit of sharing. A layer is a bundle of {anchors + notes} over
// one source identity (sourceFingerprint). Every anchor/note belongs to a layer:
//   owned      = the user's own annotations (one auto-created per source)
//   imported   = pulled from a `.studypack` file (a read-only baseline, copy-to-mine)
//   subscribed = cloud subscription (V3 placeholder)
// `enabled` is the on/off toggle — a disabled layer's anchors are not painted.
export const studyLayerSchema = recordEnvelopeSchema("layer", layerIdSchema).extend({
  sourceFingerprint: sourceFingerprintSchema.default({}),
  // Resolved binding to the importer's local source (empty until matched).
  localSourceId: sourceIdSchema.optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  author: z.object({ id: z.string().optional(), name: z.string().optional() }).optional(),
  visibility: visibilitySchema.default("private"),
  importMode: importModeSchema.default("owned"),
  enabled: z.boolean().default(true),
  origin: z
    .object({
      packId: z.string().optional(),
      importedAt: z.string().optional(),
      sourceLayerId: z.string().optional()
    })
    .optional()
});

export type SourceFingerprint = z.infer<typeof sourceFingerprintSchema>;
export type ImportMode = z.infer<typeof importModeSchema>;
export type MatchStatus = z.infer<typeof matchStatusSchema>;
export type StudyLayerRecord = z.infer<typeof studyLayerSchema>;
