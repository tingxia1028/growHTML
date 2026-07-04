// Product Kit structured generation — a THIN wrapper over the base-layer engine
// (`src/ai/structured.ts`). It resolves a kit prompt + the contentType's
// NoteContentSpec schema, then delegates the generate/validate/retry loop to the
// engine. The kit owns only the domain bits (which prompt, which schema, the
// deterministic sample); `src/ai` owns the mechanism and never imports a kit.
//
// ACTION-2a adds `generateOperationContent` — the ONE path the server's generate
// service rides for every operation kind: template/built-in prompts flow through
// the classic schema-targeted loop (contentType now defaultable from the resolved
// prompt), while a SIMPLE operation with no pinned output rides the adaptive-note
// FORM ROUTER (the model picks the form AND fills it; the routed contentType is a
// registered spec, so preview/save reuse resolveForm's declared-form default).

import { getNoteContentSpec } from "../core/notes/contentTypes";
import { formRouterSchema, routerOutputToNote, type FormRouterOutput } from "../core/notes/formRouter";
import type { OperationRecord } from "../core/schema";
import type { SnapshotStore } from "../core/store/snapshotStore";
import type { AutoContext } from "../ai/autoContext";
import { FORM_ROUTER_CONTENT_TYPE } from "../ai/mockProvider";
import type { ChatContext, ModelProvider } from "../ai/provider";
import {
  generateStructuredWithConcepts,
  StructuredGenerationError,
  type StructuredWithConcepts
} from "../ai/structured";
import { resolvePrompt, type ResolvedPrompt } from "./resolvePrompt";

// Re-export so existing importers (and tests) keep their import path.
export { StructuredGenerationError, extractJson } from "../ai/structured";

export type GenerateStructuredRequest = {
  promptId: string;
  /** Target contentType. Optional since ACTION-2a — absent means "the resolved
      prompt decides" (a simple op with no pinned output then rides the router). */
  contentType?: string;
  input?: Record<string, unknown>;
  context?: ChatContext;
  /** The server-composed auto-context envelope (ACTION-2a) — resolvePrompt maps
      it into the template namespace or prepends it as a context preamble. */
  autoContext?: AutoContext;
};

// Run the classic schema-targeted loop for an already-resolved prompt. Returns the
// validated output PLUS the CG-2 concepts side-channel (AI 顺手挂 — the model tags
// the key concepts beside the content; empty under the deterministic mock).
async function generateForPrompt(
  provider: ModelProvider,
  prompt: ResolvedPrompt,
  request: GenerateStructuredRequest,
  maxAttempts: number
): Promise<StructuredWithConcepts> {
  const contentType = request.contentType ?? prompt.outputType;
  const spec = getNoteContentSpec(contentType);
  if (!spec) throw new StructuredGenerationError(`Unknown contentType: ${contentType}`);
  if (prompt.outputType !== contentType) {
    throw new StructuredGenerationError(
      `Prompt ${prompt.id} outputs ${prompt.outputType}, not ${contentType}`
    );
  }

  const input = request.input ?? {};
  const sample = prompt.mockContent ? prompt.mockContent(input) : spec.createDefault();
  return generateStructuredWithConcepts(
    provider,
    {
      messages: [{ role: "user", content: prompt.build(input) }],
      schema: spec.schema,
      sample,
      contentType,
      context: request.context,
      suggestConcepts: true
    },
    maxAttempts
  );
}

// Build the kit prompt, generate against the contentType's schema, return the
// parsed content. Unknown prompt/contentType (or a prompt whose output type
// doesn't match) is a StructuredGenerationError (the caller maps it to 400).
export async function generateStructuredContent(
  provider: ModelProvider,
  request: GenerateStructuredRequest,
  maxAttempts = 3,
  store?: SnapshotStore<OperationRecord>
): Promise<unknown> {
  // Unify built-in code prompts and custom data operations at this one step.
  const prompt = await resolvePrompt(request.promptId, store, request.autoContext);
  if (!prompt) throw new StructuredGenerationError(`Unknown promptId: ${request.promptId}`);
  return (await generateForPrompt(provider, prompt, request, maxAttempts)).output;
}

export type GeneratedOperationContent = {
  contentType: string;
  content: unknown;
  /** CG-2 side-channel: AI-suggested concept names for this content (absent = none). */
  concepts?: string[];
};

/**
 * The ACTION-2a superset path (used by the server's generateKitContent): handles
 * BOTH operation modes through the one resolve step.
 *   • Concrete output (built-in / template op / pinned simple op): the classic
 *     schema-targeted loop; `contentType` may be omitted — it defaults to the
 *     resolved prompt's outputType.
 *   • AUTO output (simple op, no pinned type): compile the prompt and generate
 *     against the adaptive-note form-router union; the routed member unwraps to a
 *     registered { contentType, content } and is validated against that spec
 *     before it leaves — resolveForm's declared-form default then trusts it.
 */
export async function generateOperationContent(
  provider: ModelProvider,
  request: GenerateStructuredRequest,
  maxAttempts = 3,
  store?: SnapshotStore<OperationRecord>
): Promise<GeneratedOperationContent> {
  const prompt = await resolvePrompt(request.promptId, store, request.autoContext);
  if (!prompt) throw new StructuredGenerationError(`Unknown promptId: ${request.promptId}`);

  if (prompt.outputType === FORM_ROUTER_CONTENT_TYPE) {
    if (request.contentType && request.contentType !== FORM_ROUTER_CONTENT_TYPE) {
      throw new StructuredGenerationError(
        `Operation ${prompt.id} resolves its output form automatically; omit contentType`
      );
    }
    // No sample: real providers generate; the mock synthesizes the deterministic
    // first router member (a markdown note) — see MockModelProvider.
    const routerResult = await generateStructuredWithConcepts(
      provider,
      {
        messages: [{ role: "user", content: prompt.build(request.input ?? {}) }],
        schema: formRouterSchema,
        contentType: FORM_ROUTER_CONTENT_TYPE,
        context: request.context,
        suggestConcepts: true
      },
      maxAttempts
    );
    const routed = routerOutputToNote(routerResult.output as FormRouterOutput);
    const spec = getNoteContentSpec(routed.contentType);
    return {
      contentType: routed.contentType,
      content: spec ? spec.schema.parse(routed.content) : routed.content,
      // Key absent when empty so pre-CG-2 response-shape assertions stay exact.
      ...(routerResult.concepts.length > 0 ? { concepts: routerResult.concepts } : {})
    };
  }

  const contentType = request.contentType ?? prompt.outputType;
  const generated = await generateForPrompt(provider, prompt, request, maxAttempts);
  return {
    contentType,
    content: generated.output,
    ...(generated.concepts.length > 0 ? { concepts: generated.concepts } : {})
  };
}
