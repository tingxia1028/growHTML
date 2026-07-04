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

  // Lifecycle status (D6, note-presentation-unified.md §6) — OPTIONAL + additive, so
  // every pre-existing note parses unchanged (ABSENT = a normal, committed note; zero
  // migration). "draft" marks a note AUTO-MATERIALIZED from an anchor-context AI answer
  // (materializeAnchor → createNote): it EXISTS immediately (its D2 chip paints at the
  // passage) but is flagged draft so the UI can show a distinguishing marker and pair it
  // with an undo toast. It is NOT a render fork — a draft note still renders ONLY through
  // getNoteType().render; `status` is a flag the card wrapper reads, never a branch in a
  // note type. The single literal keeps the field closed to future values at zero cost.
  status: z.literal("draft").optional(),

  // Presentation (D10, note-presentation-unified.md §10) — OPTIONAL + additive, so
  // every pre-existing note parses unchanged (zero migration). A note pinned open at
  // a remembered position carries its own layout here so it travels with the vault
  // jsonl and (once portableNoteSchema forwards it) rides an export to a recipient's
  // device. `offset` is ANCHOR-RELATIVE (never absolute px): absolute pixels break on
  // reflow / zoom / font-size / screen and are meaningless on another device, while a
  // relative offset survives all of them. `open` = pinned open (vs collapsed to a D2
  // chip); `size` = the card's resized box. The device-local ephemeral fallback for
  // an un-pinned card stays in the annotationLayer CardGeom localStorage store.
  display: z
    .object({
      open: z.boolean().optional(),
      offset: z.object({ dx: z.number(), dy: z.number() }).optional(),
      size: z.object({ w: z.number(), h: z.number() }).optional()
    })
    .optional(),

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
      copiedFrom: z.string().optional(),
      // Protected-pack (.svpack) provenance (design studypack-sharing §7.1): the
      // publisher and pack this note arrived from, plus the export choke-point flag.
      // `exportable: false` ⇒ buildStudyPack refuses to ship the note; ABSENT means
      // exportable, so every pre-existing note parses (and exports) unchanged.
      publisherId: z.string().optional(),
      packId: z.string().optional(),
      exportable: z.boolean().optional()
    })
    .optional()
});

export type NoteContentType = z.infer<typeof noteContentTypeSchema>;
export type NoteRecord = z.infer<typeof noteSchema>;
