// Capability-based ModelProvider boundary. Everything above this interface
// (chat endpoint, note generation, UI) is provider-agnostic; concrete providers
// (a deterministic mock, the Claude CLI subprocess, a future hosted API) plug in
// behind it. Tests run against the mock so they are deterministic and offline.

import { z } from "zod";
import { messageContentSchema } from "../core/schema/contentPart";
import type { ToolDefinition } from "./tools";

// The WIRE multimodal content shape lives in a PURE core schema module so BOTH this
// provider seam and the persisted chatSession record share ONE definition (iron rule
// intact: this imports a pure core SCHEMA, never src/server or src/core/store). The
// PROVIDER-FACING RESOLVED shape (assetId → bytes) is an src/ai-local type below.
export type { ContentPart, ImageContentPart, TextContentPart, MessageContent } from "../core/schema/contentPart";
import type { ContentPart } from "../core/schema/contentPart";

export const chatRoleSchema = z.enum(["system", "user", "assistant"]);
export type ChatRole = z.infer<typeof chatRoleSchema>;

export const chatMessageSchema = z.object({
  role: chatRoleSchema,
  // V-1 (vision-input.md §2): content widens from a bare string to `string |
  // ContentPart[]`. Text-only messages stay a bare string (byte-identical to the
  // pre-V-1 contract); an image ATTACHMENT rides an ARRAY carrying an image REF part.
  content: messageContentSchema
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

/**
 * The PROVIDER-FACING / RESOLVED image part (vision-input.md §2). EPHEMERAL,
 * in-process only — the server resolves a wire `{type:"image", assetId}` into this by
 * reading the asset bytes, ONLY for `capabilities.vision` providers, right before the
 * provider call. NEVER persisted, NEVER in core. `data` is base64 (what AI SDK v7's
 * FilePart accepts as a bare `DataContent` shorthand).
 */
export type ResolvedImageContentPart = { type: "image"; data: string; mimeType: string };
/** A message content part as a provider sees it: text verbatim, image already resolved. */
export type ResolvedContentPart = { type: "text"; text: string } | ResolvedImageContentPart;

/**
 * A non-vision provider was handed a message carrying an image part. Thrown in the ai
 * service BEFORE the provider call (beside HttpProviderNotConfiguredError's precedent),
 * mapped to a clean 400 at the edge — a client/capability problem, not a server fault.
 * DEGRADE-NOT-DISAPPEAR: the attach affordance stays visible; a non-vision send just
 * surfaces this once.
 */
export class VisionUnsupportedError extends Error {
  constructor(message = "This AI provider does not support image input.") {
    super(message);
    this.name = "VisionUnsupportedError";
  }
}

/** True when a message carries at least one image part (so it needs a vision provider). */
export function messageHasImage(content: string | ContentPart[]): boolean {
  return Array.isArray(content) && content.some((part) => part.type === "image");
}

// One attached SOURCE the chat carries as context (ai-workspace.md §W2). Beside the
// flat single-passage fields (below), a session can attach whole sources — each with
// a bounded body excerpt and its notes — so the model reasons over several documents
// at once. A compact note digest keeps the high-signal part cheap; the excerpt is a
// capped head slice (the bundle service enforces the caps, the resolver enforces the
// cross-source total — provider.ts stays a pure shape).
export const chatContextNoteSchema = z.object({
  /** The note's contentType (markdown/flashcard/…) so the model reads it in context. */
  contentType: z.string().optional(),
  /** The note reduced to plain text (via its spec's toSearchText), bounded upstream. */
  text: z.string()
});
export type ChatContextNote = z.infer<typeof chatContextNoteSchema>;

export const chatContextSourceSchema = z.object({
  title: z.string().optional(),
  type: z.string().optional(),
  /** Where the source lives: a URL, a file path, and/or a page reference. */
  location: z.string().optional(),
  /** A bounded head slice of the source body (the bundle service caps it). */
  excerpt: z.string().optional(),
  /** The source's notes, reduced to text (sealed notes are filtered out upstream). */
  notes: z.array(chatContextNoteSchema).optional()
});
export type ChatContextSource = z.infer<typeof chatContextSourceSchema>;

// Study context the provider weaves into its answer so it knows exactly which
// passage, of which source, the user is asking about. The flat single-passage fields
// are the pre-W2 contract (untouched — the byte-for-byte zero-attachment path); the
// optional `sources[]` is the ADDITIVE W2 widening (source-level attachments + their
// notes). `sources` is OMITTED when empty so a zero-attachment request serializes
// byte-identically to before (a hard regression lock, tested directly).
export const chatContextSchema = z
  .object({
    sourceTitle: z.string().optional(),
    sourceType: z.string().optional(),
    // Where the source lives: a URL, a file path, and/or a page reference.
    location: z.string().optional(),
    quote: z.string().optional(),
    contextBefore: z.string().optional(),
    contextAfter: z.string().optional(),
    // W2: source-level attachments (the focused source ∪ the session's explicit
    // attachments, de-duped by sourceId). Absent when nothing is attached.
    sources: z.array(chatContextSourceSchema).optional()
  })
  .default({});
export type ChatContext = z.infer<typeof chatContextSchema>;

export const chatRequestSchema = z.object({
  messages: z.array(chatMessageSchema).min(1),
  context: chatContextSchema.optional()
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;

// The assistant REPLY message. A provider's reply content is ALWAYS a plain string
// (no provider emits image parts in its answer) — so reply-side readers
// (`response.message.content` in structured.ts / the gateway / streamChatDeltas'
// fallback) keep a string and stay untouched by the V-1 content widening. Only the
// REQUEST-side `ChatMessage.content` (where an image attachment lives) is the union.
export type AssistantReplyMessage = { role: "assistant"; content: string };

export type ChatResponse = {
  message: AssistantReplyMessage;
};

// A request for STRUCTURED (JSON) generation — used by Product Kit AI commands
// (e.g. generate a textbook exercise). `sample` is a deterministic, schema-valid
// object the host supplies so the offline MOCK can echo it (real providers ignore
// it and actually generate JSON from `messages`). The contentType lets a provider
// shape its output if it wants; validation against the type's zod schema happens
// above this boundary.
export type StructuredRequest = {
  messages: ChatMessage[];
  context?: ChatContext;
  contentType: string;
  sample?: unknown;
};

export type ProviderCapabilities = {
  chat: boolean;
  /**
   * True when the provider can run agentic tools (file edits, web, etc.). For
   * cli-agent providers this means the BINARY runs its own internal tools — it
   * does NOT imply app-defined tool calling (that is `tools`).
   */
  agentic: boolean;
  /** True when the provider implements `stream()` for incremental output. */
  streaming: boolean;
  /**
   * True when the provider has a NATIVE structured-output path (a
   * `completeStructured` that genuinely yields JSON, e.g. the mock's sample
   * echo or a vendor JSON mode). False → callers fall back to `complete()` +
   * JSON extraction (`extractJson` retry loop in structured.ts).
   */
  structured: boolean;
  /**
   * True when the provider supports APP-DEFINED tool/function calling (the
   * future `runAgent` loop). Distinct from `agentic`: a subscription agent CLI
   * runs its own tools (agentic: true) yet accepts none of ours (tools: false).
   */
  tools: boolean;
  /**
   * True when the provider accepts IMAGE input (vision-input.md §2, V-1/A5). A
   * message carrying an image part is resolved (assetId → bytes) and passed through
   * only to vision providers; a non-vision provider handed an image throws
   * VisionUnsupportedError before any call. Text-only chat is unaffected.
   */
  vision: boolean;
  /**
   * Integration model — drives config UI + key handling.
   * "mock" (offline determinism) | "cli-agent" (locally installed,
   * already-subscribed agent CLI: claude / codex / …) | "http" (BYOK API-key
   * vendor) | "managed" (hosted credits gateway).
   */
  kind: "mock" | "cli-agent" | "http" | "managed";
};

// One typed event of the multi-step agent loop (docs/design/multi-provider-ai-agent.md
// §4.1(2)): text as it streams, each tool call and its result, step boundaries, and a
// final `done` carrying the assistant message — the superset the /api/agent/stream SSE
// route forwards so the client can render tool-call/result cards.
export type AgentStepEvent =
  | { type: "text-delta"; delta: string }
  | { type: "tool-call"; toolName: string; args: unknown; id: string }
  | { type: "tool-result"; id: string; result: unknown }
  | { type: "step"; index: number }
  | { type: "done"; message: AssistantReplyMessage };

/** A chat request plus the tools the loop may call and a step budget. */
export type AgentRequest = ChatRequest & { tools?: ToolDefinition[]; maxSteps?: number };

export interface ModelProvider {
  readonly id: string;
  readonly capabilities: ProviderCapabilities;
  complete(request: ChatRequest): Promise<ChatResponse>;
  /**
   * Optional structured-generation path. When present, returns raw JSON TEXT
   * (parsed + validated against the contentType's schema by the caller). Providers
   * that don't implement it fall back to `complete()` + JSON extraction. The mock
   * implements it by echoing `request.sample` for deterministic tests.
   */
  completeStructured?(request: StructuredRequest): Promise<{ json: string }>;
  /**
   * Optional streaming chat: yields the assistant reply in text chunks as they are
   * produced. Callers concatenate the chunks to reconstruct the full message. When
   * absent, the streaming endpoint falls back to `complete()` emitted as one chunk.
   */
  stream?(request: ChatRequest): AsyncIterable<string>;
  /**
   * Optional multi-step tool loop, streamed as typed events. Present iff
   * `capabilities.agentic` (http providers today; cli-agent binaries run their
   * OWN tools and never implement this). Feature-detected by the agent SSE route
   * exactly like `stream` is by /api/chat/stream — purely additive.
   */
  runAgent?(request: AgentRequest): AsyncIterable<AgentStepEvent>;
}
