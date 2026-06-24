import { z } from "zod";
import {
  anchorIdSchema,
  conceptIdSchema,
  noteIdSchema,
  recordEnvelopeSchema,
  sourceIdSchema,
  visibilitySchema
} from "./common";

export const noteKindSchema = z.enum([
  "explanation",
  "annotation",
  "summary",
  "example",
  "correction",
  "question",
  "quiz",
  "source_analysis",
  "diagram"
]);

// Open string (not an enum): note types are plugins (NoteContentRenderer keyed
// by contentType). Closed enum here would force a core change per note plugin.
// Orthogonal to noteKind (semantic purpose) — contentType is the render format.
export const noteContentTypeSchema = z.string().min(1);

export const noteSchema = recordEnvelopeSchema("note", noteIdSchema).extend({
  sourceId: sourceIdSchema,
  anchorId: anchorIdSchema.optional(),
  noteKind: noteKindSchema,
  contentType: noteContentTypeSchema.default("markdown"),
  title: z.string().optional(),
  question: z.string().optional(),
  content: z.string().min(1),
  linkedConceptIds: z.array(conceptIdSchema).default([]),
  authorId: z.string().min(1).optional(),
  visibility: visibilitySchema.default("private")
});

export type NoteKind = z.infer<typeof noteKindSchema>;
export type NoteContentType = z.infer<typeof noteContentTypeSchema>;
export type NoteRecord = z.infer<typeof noteSchema>;

