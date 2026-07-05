// contentPart — the WIRE / PERSISTED multimodal message-content shape (vision-input.md
// §2, V-1/A5). A chat message's `content` widens from a bare string to a UNION of
// `string | ContentPart[]`; this module owns the part shapes that ride that union.
//
// TWO ContentPart shapes exist in the system, and ONLY the WIRE one lives here:
//  - WIRE / PERSISTED (this file): an image part is `{type:"image", assetId, mimeType?}`
//    — a bounded ULID REF into the existing asset store (src/core/store/assets.ts).
//    NEVER base64 in anything durable (request body, ChatSessionRecord.messages, vault
//    JSONL) — roadmap.md:159's guard. A text part is `{type:"text", text}`.
//  - PROVIDER-FACING / RESOLVED (an src/ai-local type, NOT here): the server resolves
//    the assetId → bytes ONLY for `capabilities.vision` providers, in-process, right
//    before the provider call (src/server/services/ai.ts). Never persisted, never in core.
//
// This is a PURE core schema module (imports only zod + the asset-id schema). It is
// deliberately importable by BOTH src/ai (provider.ts) and src/core/schema
// (chatSession.ts) so the union is defined once and both the wire-input validator and
// the persisted-record validator share it — while src/ai still imports NOTHING from
// src/server or src/core/store (the iron rule). core importing from src/ai stays
// forbidden; this file lets both sides depend on core instead.

import { z } from "zod";
import { assetIdSchema } from "./common";

/** A plain-text part of a multimodal message. */
export const textContentPartSchema = z.object({
  type: z.literal("text"),
  text: z.string()
});
export type TextContentPart = z.infer<typeof textContentPartSchema>;

/**
 * An image part — a REF into the asset store (never inline bytes). `assetId` points at
 * an already-imported asset (POST /api/assets returns one); `mimeType` is an optional
 * hint (the server reads the authoritative one off the AssetRecord when resolving).
 */
export const imageContentPartSchema = z.object({
  type: z.literal("image"),
  assetId: assetIdSchema,
  mimeType: z.string().optional()
});
export type ImageContentPart = z.infer<typeof imageContentPartSchema>;

/**
 * One part of a multimodal message (wire/persisted). The audio part
 * (speech-and-young-learners.md §2, SPEECH-2 STT lane) is INTENTIONALLY not added yet —
 * the union shape stays open for it, unimplemented in V-1.
 */
export const contentPartSchema = z.discriminatedUnion("type", [textContentPartSchema, imageContentPartSchema]);
export type ContentPart = z.infer<typeof contentPartSchema>;

/**
 * The message-content union: a bare string (text-only, byte-identical to the pre-V-1
 * contract) OR a non-empty array of parts. Shared verbatim by the four content
 * validators (provider.ts, chatSession.ts, chatSessions.ts input, the client mirror).
 */
export const messageContentSchema = z.union([z.string().min(1), z.array(contentPartSchema).min(1)]);
export type MessageContent = z.infer<typeof messageContentSchema>;
