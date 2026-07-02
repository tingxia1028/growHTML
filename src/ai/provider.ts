// Capability-based ModelProvider boundary. Everything above this interface
// (chat endpoint, note generation, UI) is provider-agnostic; concrete providers
// (a deterministic mock, the Claude CLI subprocess, a future hosted API) plug in
// behind it. Tests run against the mock so they are deterministic and offline.

import { z } from "zod";
import type { ToolDefinition } from "./tools";

export const chatRoleSchema = z.enum(["system", "user", "assistant"]);
export type ChatRole = z.infer<typeof chatRoleSchema>;

export const chatMessageSchema = z.object({
  role: chatRoleSchema,
  content: z.string().min(1)
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

// Study context the provider weaves into its answer so it knows exactly which
// passage, of which source, the user is asking about.
export const chatContextSchema = z
  .object({
    sourceTitle: z.string().optional(),
    sourceType: z.string().optional(),
    // Where the source lives: a URL, a file path, and/or a page reference.
    location: z.string().optional(),
    quote: z.string().optional(),
    contextBefore: z.string().optional(),
    contextAfter: z.string().optional()
  })
  .default({});
export type ChatContext = z.infer<typeof chatContextSchema>;

export const chatRequestSchema = z.object({
  messages: z.array(chatMessageSchema).min(1),
  context: chatContextSchema.optional()
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;

export type ChatResponse = {
  message: ChatMessage;
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
  | { type: "done"; message: ChatMessage };

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
