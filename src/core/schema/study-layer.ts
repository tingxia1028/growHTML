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
  // Presentation / organization only (all optional, additive): role is compatibility
  // and permission metadata (preset = kit-seeded child layer, custom = user-made,
  // shared = imported); color is a UI chip; order sorts siblings. None affect
  // filter/visibility.
  role: z.enum(["preset", "custom", "shared"]).optional(),
  color: z.string().optional(),
  order: z.number().optional(),
  // Hierarchy (R7, additive): the parent layer this one nests under in the Layer Lens
  // tree. Empty/undefined = a top-level layer. Kit-seeded preset/custom owned layers
  // hang under the owned/Mine layer; importing a `.studypack` hangs the imported layer
  // under a per-source "Imported" parent (ensureImportedParent). The filter semantics
  // are unchanged: notes are visible when any of their layerIds is enabled.
  parentId: layerIdSchema.optional(),
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
