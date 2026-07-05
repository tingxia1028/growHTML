// chatSession — a durable AI chat conversation (docs/design/ai-workspace.md §2.1, W1).
// The session list + resumable history behind the chat panel: title (auto from the
// first user message, user-renamable), the full message transcript, and the session's
// context set (`attachments` — source refs the W2 attach/bundle wave will feed into
// ChatContext; W1 only records them). Stored like every other entity (jsonl snapshot
// store), but — like operation/memoryEvent — deliberately NOT part of the generic
// `vaultEntitySchema` union: conversations are private, so no generic entity flow
// (share/import/aggregate) may pick them up by accident. The full-vault data-trust
// backup/export still carries the store file via `entityFileNames`.

import { z } from "zod";
import { chatSessionIdSchema, isoDateTimeSchema, recordEnvelopeSchema, sourceIdSchema } from "./common";
import { messageContentSchema } from "./contentPart";

// Mirrors src/ai/provider.ts `chatMessageSchema` ({role, content}) — core must not
// import from src/ai — PLUS the persistence-side `ts` stamp (when the turn landed).
// A plain ai ChatMessage structurally satisfies the wire INPUT (ts is stamped by the
// server on append), and a persisted message structurally satisfies ChatMessage.
export const chatSessionMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  // V-1 (vision-input.md §2): the PERSISTED content widens to `string | ContentPart[]`.
  // An image message's content is an ARRAY whose image part carries an assetId REF
  // (never base64 in JSONL — roadmap.md:159 guard); a text-only message stays a bare
  // string so its JSONL is byte-identical to the pre-V-1 record.
  content: messageContentSchema,
  ts: isoDateTimeSchema
});
export type ChatSessionMessage = z.infer<typeof chatSessionMessageSchema>;

/** One entry of the session's context set (ai-workspace §2.1). W1 records the refs;
    W2 widens ChatContext to actually bundle these sources (+notes) into prompts. */
export const chatSessionAttachmentSchema = z.object({
  sourceId: sourceIdSchema,
  includeNotes: z.boolean().default(true)
});
export type ChatSessionAttachment = z.infer<typeof chatSessionAttachmentSchema>;

export const chatSessionSchema = recordEnvelopeSchema("chatSession", chatSessionIdSchema).extend({
  /** Auto-derived from the first user message (truncated), user-renamable via PATCH. */
  title: z.string().default(""),
  messages: z.array(chatSessionMessageSchema).default([]),
  attachments: z.array(chatSessionAttachmentSchema).default([])
});

export type ChatSessionRecord = z.infer<typeof chatSessionSchema>;
