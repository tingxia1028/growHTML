import { z } from "zod";
import {
  anchorIdSchema,
  conceptIdSchema,
  layerIdSchema,
  noteIdSchema,
  recordEnvelopeSchema,
  sourceIdSchema,
  visibilitySchema
} from "./common";

// Open string (not an enum): note types are plugins (NoteContentSpec + client
// NoteTypePlugin keyed by contentType). The *shape* of `content` is validated
// by the matching NoteContentSpec at the API boundary, not here — core stays
// agnostic so a new note type never forces a core schema change.
export const noteContentTypeSchema = z.string().min(1);

// Kept deliberately minimal: only fields with a current consumer. Speculative
// fields (title, tags, commandId, displayMode, assetRefs) were dropped — with no
// stored data and optional/default fields, any of them can be re-added later at
// zero migration cost when a feature actually needs it.
export const noteSchema = recordEnvelopeSchema("note", noteIdSchema).extend({
  // Attachments — all optional; a note can be anchored to several passages, tied
  // to concepts, or standalone.
  sourceId: sourceIdSchema.optional(),
  anchorIds: z.array(anchorIdSchema).default([]),
  conceptIds: z.array(conceptIdSchema).default([]),

  // Content — structured value interpreted per contentType (NoteContentSpec owns
  // its zod schema); core does not constrain the shape.
  contentType: noteContentTypeSchema.default("markdown"),
  content: z.unknown(),

  visibility: visibilitySchema.default("private"),

  // Study Layer membership (multi). A note's lens(es); a note is visible iff
  // layerIds intersects the enabled layers (OR across its layers). Defaults empty;
  // migration backfills the source's "owned" layer. Mirrors anchorIds/conceptIds.
  layerIds: z.array(layerIdSchema).default([]),
  // DEPRECATED, migration-only: the legacy single-membership field. Retained for
  // one release so the layerIds backfill can read a pre-multi note's stored id
  // (the strict envelope would otherwise strip it on parse). Do not write it; it
  // is dropped once the backfill has run everywhere.
  layerId: layerIdSchema.optional(),
  // Provenance for a note copied out of an imported layer into the user's own.
  origin: z
    .object({
      layerId: layerIdSchema.optional(),
      noteId: noteIdSchema.optional(),
      copiedFrom: z.string().optional()
    })
    .optional()
});

export type NoteContentType = z.infer<typeof noteContentTypeSchema>;
export type NoteRecord = z.infer<typeof noteSchema>;
