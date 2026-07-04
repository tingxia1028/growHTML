// AI domain services (X0 shared-core extraction): chat completion, chat stream
// delta production, Product-Kit structured generation, and the adaptive-note form
// router (generate-block / classify). Transport-agnostic — the SSE pumping for
// /api/chat/stream stays in the route; here we only assemble the request and talk
// to the ModelProvider, yielding plain deltas/data.
import { z } from "zod";
import {
  chatContextSchema,
  chatRequestSchema,
  generateStructured,
  FORM_ROUTER_CONTENT_TYPE,
  type ModelProvider
} from "../../ai";
import {
  formRouterSchema,
  routerOutputToNote,
  INLINE_HTML_INSTRUCTION,
  type FormRouterOutput
} from "../../core/notes/formRouter";
import { getNoteContentSpec } from "../../core/notes/contentTypes";
import { generateOperationContent, StructuredGenerationError } from "../../kits/structured";
import type { StudyVault } from "../../core/vault";
import { composeAutoContext } from "./autoContext";
import { readOperationPrefs } from "./workspace";

export type ChatDeps = { provider: ModelProvider };
export type KitGenerateDeps = { vault: StudyVault; provider: ModelProvider };

export type ChatRequestInput = z.infer<typeof chatRequestSchema>;

// Body for POST /api/kits/generate — a kit AI command's structured request.
// `contentType` is optional since ACTION-2a: absent means "the resolved operation
// decides" — a simple op with no pinned output rides the adaptive-note form
// router and the response's `contentType` names the routed form.
export const kitGenerateSchema = z.object({
  promptId: z.string().min(1),
  contentType: z.string().min(1).optional(),
  input: z.record(z.string(), z.unknown()).optional()
});
export type KitGenerateInput = z.infer<typeof kitGenerateSchema>;

// Body for POST /api/notes/generate-block — the form-router request (adaptive note
// forms §4 Phase 4 item 1). The model is given the user's text + optional study
// context and returns a discriminated-union member (formRouterSchema); the server
// unwraps it into a real { contentType, content }. An optional `sample` lets a caller
// force a deterministic form against the offline mock (the e2e seeds a markmap).
export const generateBlockSchema = z.object({
  text: z.string().min(1),
  context: chatContextSchema.optional(),
  sample: z.unknown().optional()
});
export type GenerateBlockInput = z.infer<typeof generateBlockSchema>;

/** One-shot chat completion. */
export async function chatComplete({ provider }: ChatDeps, input: ChatRequestInput) {
  const response = await provider.complete(input);
  return { message: response.message, provider: provider.id };
}

/**
 * Produce the chat reply as a stream of text deltas. Providers without `stream()`
 * fall back to a single delta from `complete()`. The transport (SSE route today,
 * mobile direct-call tomorrow) owns framing/accumulation.
 */
export async function* streamChatDeltas(
  { provider }: ChatDeps,
  input: ChatRequestInput
): AsyncGenerator<string, void, undefined> {
  if (provider.stream) {
    for await (const delta of provider.stream(input)) {
      yield delta;
    }
  } else {
    yield (await provider.complete(input)).message.content;
  }
}

/**
 * REV-2 privacy gate (learner-memory §5/§6.3): the learner profile is default-on for
 * LOCAL provider kinds (mock / cli-agent / http-BYOK) and HARD OFF for `kind:
 * "managed"` — it must never leave the machine silently, and the explicit-consent UI
 * only arrives with MEM-3, so under a managed provider the key is STRIPPED here
 * before the prompt is built. This function is the authoritative choke point: the
 * server (not the client) holds the live ModelProvider and its capabilities.kind,
 * and every transport (HTTP route + the direct-call adapter) funnels through
 * generateKitContent.
 *
 * ACTION-2a GENERALIZED the gate (absorbing MEM-3's "profileContext into all kit
 * prompts"): the strip is no longer scoped to review.explain — under a managed
 * provider the key is removed from EVERY operation's runtime input, and the
 * envelope side (composeAutoContext) independently omits the learner section for
 * managed kinds, so profile data never reaches a managed provider through either
 * path. Local kinds stay default-on everywhere.
 */
const PROFILE_CONTEXT_KEY = "profileContext";

function applyProfileContextGate(
  provider: ModelProvider,
  runtimeInput: Record<string, unknown>
): Record<string, unknown> {
  if (provider.capabilities.kind !== "managed") return runtimeInput;
  if (!(PROFILE_CONTEXT_KEY in runtimeInput)) return runtimeInput;
  const { [PROFILE_CONTEXT_KEY]: _stripped, ...rest } = runtimeInput;
  return rest;
}

/**
 * Product Kit structured generation: merge the per-vault placeholder params for
 * this promptId UNDER the runtime input (so runtime values like anchorText always
 * win), apply the profileContext privacy gate, compose the auto-context envelope
 * (ACTION-2a — selection/doc/learner, capped server-side), build the kit prompt,
 * generate, validate against the target contentType's NoteContentSpec schema (or
 * the form-router union for a simple auto-output operation). Unknown
 * prompt/contentType or unsatisfiable output → StructuredGenerationError (mapped to
 * 400 at the edge — a client/AI problem, not a server fault). Custom op_ ids simply
 * have no params. The response's `contentType` names what was actually produced
 * (additive — equal to the requested type whenever one was sent).
 */
export async function generateKitContent({ vault, provider }: KitGenerateDeps, input: KitGenerateInput) {
  const prefs = await readOperationPrefs({ vault });
  const params = prefs.params[input.promptId] ?? {};
  const runtimeInput = applyProfileContextGate(provider, {
    ...params,
    ...(input.input ?? {})
  });
  const autoContext = await composeAutoContext({ vault, provider }, { input: runtimeInput });
  const { contentType, content, concepts } = await generateOperationContent(
    provider,
    { ...input, input: runtimeInput, autoContext },
    3,
    vault.stores.operations
  );
  // CG-2 side-channel (AI 顺手挂): suggested concept names ride the response so the
  // preview can chip them; the key is ABSENT when the model offered none (mock),
  // keeping pre-CG-2 exact-shape assertions and clients untouched.
  return {
    content,
    contentType,
    provider: provider.id,
    ...(concepts && concepts.length > 0 ? { concepts } : {})
  };
}

// —— Adaptive note forms · Phase 4 ——————————————————————————————————————————
// Run the FORM ROUTER (item 1): one structured call where the MODEL picks the form
// AND fills it. We generate against `formRouterSchema` (a discriminated union), then
// unwrap the chosen member into a real { contentType, content } shaped for that
// type's NoteContentSpec — so the result flows through the normal preview/save/render
// path (§0.5: a registered contentType, no bypass). The mock is deterministic for
// this schema (echoes `sample`, else synthesizes the first union member).
async function runFormRouter(
  provider: ModelProvider,
  text: string,
  context: unknown,
  sample: unknown
): Promise<FormRouterOutput> {
  try {
    const output = (await generateStructured(provider, {
      messages: [
        {
          role: "user",
          content:
            "Choose the BEST note form for the following content and return it as the router " +
            "JSON (pick the single most appropriate `form`).\n" +
            // Inline-HTML guard (FIX 1, best-effort half): if the model picks the html
            // form it must inline the markup, never write a file / return a path. The
            // RELIABLE half is the schema's looksLikeHtml refine + the degrade below.
            INLINE_HTML_INSTRUCTION +
            "\n\n" +
            text
        }
      ],
      schema: formRouterSchema,
      contentType: FORM_ROUTER_CONTENT_TYPE,
      sample,
      context: chatContextSchema.optional().parse(context) ?? undefined
    })) as FormRouterOutput;
    return output;
  } catch (error) {
    // DEGRADE GRACEFULLY (FIX 1, reliable half): generation failed to produce a valid
    // union member after the re-prompt loop. The dominant cause with the agentic
    // claude-cli provider is an html arm whose `html` was a FILE PATH (rejected by the
    // looksLikeHtml refine on every attempt). Rather than surface a hard error — or,
    // worse, persist a path as html — fall back to a MARKDOWN note carrying the original
    // text. The robust long-term fix is a content-returning API provider (DeepSeek), not
    // an agent that writes files; this keeps the offline/path case from corrupting a note.
    if (error instanceof StructuredGenerationError) {
      return { form: "markdown", markdown: text };
    }
    throw error;
  }
}

/**
 * Form-router generation for a new note block: the model picks the form and fills
 * it; the unwrapped content is validated against the target type's core schema
 * before it leaves the server — the routed form must be a real, persistable note.
 */
export async function generateBlock({ provider }: ChatDeps, input: GenerateBlockInput) {
  const output = await runFormRouter(provider, input.text, input.context, input.sample);
  const routed = routerOutputToNote(output);
  const spec = getNoteContentSpec(routed.contentType);
  const content = spec ? spec.schema.parse(routed.content) : routed.content;
  return { contentType: routed.contentType, content, provider: provider.id };
}

/**
 * AI-assisted classification (item 2) — the low-confidence FALLBACK behind the
 * client's resolveFormAsync. It reuses the SAME form-router to decide the form for
 * ambiguous prose, returning a ClassifiedForm. The client only calls this when its
 * pure heuristic was low-confidence (heuristic stays primary; this is gated on the
 * client by provider availability), so offline/deterministic flows are unaffected.
 */
export async function classifyText({ provider }: ChatDeps, input: GenerateBlockInput) {
  const output = await runFormRouter(provider, input.text, input.context, input.sample);
  const routed = routerOutputToNote(output);
  // A MARKDOWN verdict means "this is prose, keep it as-is" — so PRESERVE the
  // original text rather than the router's (possibly regenerated/empty) markdown.
  // This makes the AI pass a no-op on content for the markdown case (it only changes
  // the FORM when it picks a richer one), so the heuristic's safe markdown fallback
  // is honored verbatim and deterministic offline flows keep the original text.
  if (routed.contentType === "markdown") {
    return { contentType: "markdown", content: input.text, confidence: "low", provider: provider.id };
  }
  const spec = getNoteContentSpec(routed.contentType);
  const content = spec ? spec.schema.parse(routed.content) : routed.content;
  // The model picked a RICHER form → high confidence (an explicit, non-fallback
  // choice). The client only reaches here on a low heuristic, so this never
  // overrides a confident heuristic.
  return { contentType: routed.contentType, content, confidence: "high" as const, provider: provider.id };
}
