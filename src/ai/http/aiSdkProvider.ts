// http kind (A3a) — ONE AiSdkProvider over the Vercel AI SDK, the engine
// behind every BYOK API-key vendor (docs/design/multi-provider-ai-agent.md
// §3.1/§4.1 Phase 1). Concrete vendors are just registry presets that hand
// this class a lazy model factory (see ./presets.ts) — "add a vendor" stays
// configuration, not code (§9.4).
//
// Laziness contract: the ESM-only `ai` package (and the `@ai-sdk/*` vendor
// packages inside `makeModel`) are NEVER imported at module scope — this file
// is reachable from the CJS electron main bundle via src/ai/index, so like the
// cliAgent adapters everything loads through a dynamic import() on first use
// (which is also what keeps unit tests offline: `makeModel` returns a fake
// model from `ai/test`, and no vendor module ever loads). `makeModel` runs
// BEFORE the first `import("ai")`, so a config-gated factory (presets throw
// HttpProviderNotConfiguredError) rejects before any SDK/model construction.
//
// Installed reality (AI SDK 7.0.11 — the doc's §3.1 was researched around
// AI SDK 6; deltas that matter here):
//   - `LanguageModel` = model-id string | LanguageModelV2/V3/V4 (vendor
//     packages currently return V4 models).
//   - System messages inside `messages` are REJECTED by default
//     (`allowSystemInMessages` defaults to false; InvalidPromptError). Our
//     ChatMessage[] legitimately carries system entries (generateStructured
//     prepends its JSON-only instruction), so every call opts in.
//   - `generateObject({ output: "no-schema" })` is still supported and is the
//     native structured path used below.

import type { LanguageModel, ModelMessage } from "ai";
import { contextPreamble } from "../buildPrompt";
import type {
  ChatContext,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ModelProvider,
  StructuredRequest
} from "../provider";

/** The slice of the `ai` module the provider uses (loaded lazily, see above). */
type AiCore = Pick<typeof import("ai"), "generateText" | "streamText" | "generateObject" | "NoObjectGeneratedError">;

// Lazy ESM load (see module comment). The loader caches the module, so the
// per-call await is a lookup after the first use.
async function loadAiCore(): Promise<AiCore> {
  return import("ai");
}

function toModelMessage(message: ChatMessage): ModelMessage {
  switch (message.role) {
    case "system":
      return { role: "system", content: message.content };
    case "user":
      return { role: "user", content: message.content };
    case "assistant":
      return { role: "assistant", content: message.content };
  }
}

/**
 * Map our ChatMessage[] + ChatContext onto AI SDK messages. The study context
 * (source identity + selected passage) is woven in as a LEADING system message
 * built from the SAME shared blocks the cli-agent adapters join into their
 * prompt strings (src/ai/buildPrompt.ts, mirroring flattenPrompt's
 * context-first order) — every provider kind weaves identical context text.
 * Exported for the colocated unit tests.
 */
export function toModelMessages(messages: ChatMessage[], context?: ChatContext): ModelMessage[] {
  const preamble = contextPreamble(context);
  const converted = messages.map(toModelMessage);
  return preamble ? [{ role: "system", content: preamble }, ...converted] : converted;
}

export type AiSdkProviderOptions = {
  /** Registry id, e.g. "deepseek" / "openai-compatible". */
  id: string;
  /** User-facing name (matches the registry descriptor's label). */
  label: string;
  /**
   * Lazily builds the AI SDK model on FIRST use — no vendor SDK import, no
   * network, no key handling before then. Presets gate config in here: an
   * unconfigured provider constructs fine and this rejects with
   * HttpProviderNotConfiguredError before touching any SDK module.
   */
  makeModel: () => Promise<LanguageModel>;
};

/**
 * `ModelProvider` over the Vercel AI SDK: complete() → generateText,
 * stream() → streamText().textStream, completeStructured() → generateObject
 * in no-schema JSON mode (StructuredRequest carries no schema — validation
 * happens above the boundary in generateStructured, exactly like every other
 * provider).
 */
export class AiSdkProvider implements ModelProvider {
  readonly id: string;
  readonly label: string;
  readonly capabilities = {
    chat: true,
    // runAgent (the multi-step app-tool loop) and app-defined tool calling are
    // the A4 slice — not advertised until they exist.
    agentic: false,
    streaming: true,
    // Native structured path: generateObject's no-schema JSON mode (vendor
    // JSON output where supported; DeepSeek and mainstream OpenAI-compatible
    // endpoints do). A long-tail endpoint that rejects JSON mode surfaces its
    // vendor error honestly rather than degrading silently.
    structured: true,
    tools: false,
    kind: "http"
  } as const;

  private readonly makeModel: () => Promise<LanguageModel>;
  private model: LanguageModel | null = null;

  constructor(options: AiSdkProviderOptions) {
    this.id = options.id;
    this.label = options.label;
    this.makeModel = options.makeModel;
  }

  /**
   * Memoize the RESOLVED model only: a failed makeModel (typically "not
   * configured") must not stick to the long-lived provider instance — the
   * next call re-runs the factory, so fixing the config heals without
   * reconstruction (same recheck-per-call spirit as ManagedProvider).
   */
  private async getModel(): Promise<LanguageModel> {
    if (this.model === null) this.model = await this.makeModel();
    return this.model;
  }

  async complete(request: ChatRequest): Promise<ChatResponse> {
    const model = await this.getModel(); // config gate — BEFORE the SDK loads
    const { generateText } = await loadAiCore();
    const { text } = await generateText({
      model,
      allowSystemInMessages: true,
      messages: toModelMessages(request.messages, request.context)
    });
    return { message: { role: "assistant", content: text } };
  }

  async *stream(request: ChatRequest): AsyncIterable<string> {
    const model = await this.getModel();
    const { streamText } = await loadAiCore();
    const result = streamText({
      model,
      allowSystemInMessages: true,
      messages: toModelMessages(request.messages, request.context)
    });
    // textStream yields plain text deltas; their concatenation equals the
    // complete() text for the same reply. Stream errors surface on iteration.
    for await (const delta of result.textStream) yield delta;
  }

  /**
   * Native structured path (capabilities.structured). `sample` is the mock's
   * affordance and is deliberately ignored; contentType needs no mapping —
   * the JSON-only instruction arrives as a system message from
   * generateStructured. On NoObjectGeneratedError (model emitted prose around
   * or instead of JSON) the RAW text is returned instead of throwing, so the
   * above-boundary extractJson + re-prompt loop keeps its recovery semantics.
   */
  async completeStructured(request: StructuredRequest): Promise<{ json: string }> {
    const model = await this.getModel();
    const { generateObject, NoObjectGeneratedError } = await loadAiCore();
    try {
      const { object } = await generateObject({
        model,
        output: "no-schema",
        allowSystemInMessages: true,
        messages: toModelMessages(request.messages, request.context)
      });
      return { json: JSON.stringify(object) };
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error) && typeof error.text === "string") {
        return { json: error.text };
      }
      throw error;
    }
  }
}
