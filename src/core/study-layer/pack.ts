import { z } from "zod";
import { anchorKindSchema, sourceFingerprintSchema, visibilitySchema } from "../schema";

// `.studypack` — the offline transport format for sharing a Study Layer. It carries
// ONLY portable locators (quote + context, page/url/rect); the author's local
// realizations (sourceId / studyId / selector) are stripped on export and rebuilt by
// the importer's rematch resolver.

export const portableAnchorSchema = z.object({
  // Pack-local id so notes can reference their anchors without leaking real ids.
  refId: z.string().min(1),
  anchorKind: anchorKindSchema,
  quote: z.string().default(""),
  contextBefore: z.string().default(""),
  contextAfter: z.string().default(""),
  page: z.number().int().positive().optional(),
  normalizedUrl: z.string().optional(),
  rect: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  filePath: z.string().optional(),
  symbol: z.string().optional()
});

export const portableNoteSchema = z.object({
  contentType: z.string().min(1).default("markdown"),
  content: z.unknown(),
  anchorRefs: z.array(z.string()).default([]),
  conceptRefs: z.array(z.string()).default([])
});

export const studyPackSchema = z.object({
  packId: z.string().min(1),
  createdAt: z.string().min(1),
  app: z.string().default("ai-study-vault"),
  sourceFingerprint: sourceFingerprintSchema.default({}),
  layer: z.object({
    title: z.string().min(1),
    description: z.string().optional(),
    author: z.object({ id: z.string().optional(), name: z.string().optional() }).optional(),
    visibility: visibilitySchema.default("public")
  }),
  anchors: z.array(portableAnchorSchema).default([]),
  notes: z.array(portableNoteSchema).default([]),
  // Provenance stamp on PROTECTED (.svpack) payloads — which publisher issued the pack
  // and that its content must not be re-exported. EXPLICIT on purpose (design
  // studypack-sharing §3.3): z.object STRIPS unknown keys, so without this field the
  // stamp would silently vanish on parse. Absent on legacy plaintext `.studypack`.
  provenance: z
    .object({
      publisherId: z.string().min(1),
      packId: z.string().min(1),
      exportable: z.boolean()
    })
    .optional()
});

export type PortablePackAnchor = z.infer<typeof portableAnchorSchema>;
export type PortablePackNote = z.infer<typeof portableNoteSchema>;
export type StudyPack = z.infer<typeof studyPackSchema>;
