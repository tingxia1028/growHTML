import { z } from "zod";
import {
  anchorIdSchema,
  conceptIdSchema,
  layerIdSchema,
  memoryEventIdSchema,
  noteIdSchema,
  recordEnvelopeSchema,
  sourceIdSchema
} from "./common";

// Learner memory — the 短期 (short-term) tier: one captured behavior event
// (docs/design/learner-memory.md §2/§3). The verb envelope is CORE-OWNED and CLOSED —
// "what happened" is core vocabulary; "what that behavior means" (错题/生词/…) is a
// kit-registered taxonomy that ENRICHES events in MEM-3, never a new verb here.
export const memoryVerbSchema = z.enum([
  "open",
  "read",
  "anchor.create",
  "note.create",
  "note.edit",
  "note.review",
  "ai.ask",
  "ai.generate",
  "import",
  "export",
  "search",
  "navigate"
]);

// WHAT the behavior touched. Every field is optional (an `open` may know only the
// source; a note command adds noteId/contentType); the id fields validate against
// the same grammars as the entities they reference.
export const memorySubjectSchema = z.object({
  sourceId: sourceIdSchema.optional(),
  anchorId: anchorIdSchema.optional(),
  noteId: noteIdSchema.optional(),
  conceptId: conceptIdSchema.optional(),
  layerId: layerIdSchema.optional(),
  kitId: z.string().min(1).optional(),
  contentType: z.string().min(1).optional()
});

// The raw-stream record (append-only, high volume, prunable — §2). `createdAt` IS the
// event time; `updatedAt` mirrors it (events are immutable, the envelope just keeps
// the uniform store contract). PRIVACY (§6): memoryEvent is deliberately NOT a member
// of `vaultEntitySchema` and is never read by `buildStudyPack`, so memory can never
// ride an export — pinned by the guard test in src/server/memory.test.ts.
export const memoryEventSchema = recordEnvelopeSchema("memoryEvent", memoryEventIdSchema).extend({
  verb: memoryVerbSchema,
  subject: memorySubjectSchema.default({}),
  // Small, verb-specific extras (e.g. action: "delete", commandId, durationMs).
  payload: z.record(z.string(), z.unknown()).optional(),
  // Groups one sitting's events (a per-page-load client id).
  sessionId: z.string().min(1).optional()
});

export type MemoryVerb = z.infer<typeof memoryVerbSchema>;
export type MemorySubject = z.infer<typeof memorySubjectSchema>;
export type MemoryEventRecord = z.infer<typeof memoryEventSchema>;
