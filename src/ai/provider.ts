// Capability-based ModelProvider boundary. Everything above this interface
// (chat endpoint, note generation, UI) is provider-agnostic; concrete providers
// (a deterministic mock, the Claude CLI subprocess, a future hosted API) plug in
// behind it. Tests run against the mock so they are deterministic and offline.

import { z } from "zod";

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
  /** True when the provider can run agentic tools (file edits, web, etc.). */
  agentic: boolean;
};

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
}
