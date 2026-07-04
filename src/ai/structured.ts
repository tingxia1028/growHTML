// Structured generation engine — the base-layer, KIT-AGNOSTIC core of "ask the
// model for a JSON object that validates against a schema". It builds the request
// (a JSON-only system instruction + the caller's messages), asks the provider for
// JSON (via `completeStructured` when available, else `complete()` + extraction),
// validates against the supplied zod schema, and re-prompts with the validation
// error on malformed output. NOTHING here imports a kit or core content specs —
// the caller passes the schema + (for the deterministic mock) a sample. Product
// Kit AI commands are thin wrappers over this (see `src/kits/structured.ts`).

import type { ZodTypeAny } from "zod";
import type { ChatContext, ChatMessage, ModelProvider } from "./provider";

export class StructuredGenerationError extends Error {}

// The instruction prepended (as a system message) so the model returns bare JSON.
// The second sentence is a GENERAL output-format rule for any schema that carries an
// `html` field: an agentic provider (claude-cli) tends to WRITE a file and return its
// PATH; this nudges it to inline the markup instead. It is best-effort — the RELIABLE
// enforcement is the schema's looksLikeHtml refine (which triggers the re-prompt loop
// below) + the caller's degrade-on-failure. Kept inline (no core import) so src/ai stays
// kit/core-agnostic.
const JSON_ONLY =
  "You output ONLY a single JSON object that matches the requested schema. " +
  "No prose, no markdown fences, no comments — just the JSON. " +
  "If the schema has an `html` field, it MUST contain the COMPLETE inline HTML markup " +
  "(doctype + tags + inline <style>/<script>) — NEVER a file path or filename, and NEVER " +
  "write a file to disk; put the full document text directly in the field.";

// Pull a JSON object out of a model reply: strip ``` fences, then take the first
// balanced {...} span. Throws if none parses.
export function extractJson(text: string): unknown {
  const unfenced = text.replace(/```(?:json)?/gi, "").trim();
  // Fast path: the whole thing is JSON.
  try {
    return JSON.parse(unfenced);
  } catch {
    /* fall through to brace scan */
  }
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return JSON.parse(unfenced.slice(start, end + 1));
  }
  throw new Error("No JSON object found in model output");
}

export type StructuredGenerateRequest = {
  /** The caller's prompt messages (a JSON-only system message is prepended). */
  messages: ChatMessage[];
  /** Validates the model's JSON; its parsed output is returned. */
  schema: ZodTypeAny;
  /** Deterministic, schema-valid object the mock provider echoes (real providers ignore). */
  sample?: unknown;
  /** Optional: lets a provider shape output; passed through to `completeStructured`. */
  contentType?: string;
  context?: ChatContext;
  /**
   * CG-2 "AI 顺手挂" (concept-light-and-graph §1.1): ask the model to ALSO emit an
   * optional top-level `concepts: string[]` side-channel beside the schema output.
   * The field is CAPTURED AND STRIPPED before schema validation (strict schemas
   * never see it), so any target schema rides the same seam untouched. Off by
   * default — legacy callers are byte-identical.
   */
  suggestConcepts?: boolean;
};

/** The engine result when the concepts side-channel is in play. */
export type StructuredWithConcepts = {
  /** The schema-validated output (exactly what `generateStructured` returns). */
  output: unknown;
  /** Side-channel concept names (empty when the model omitted them / mock echoes). */
  concepts: string[];
};

// The side-channel ask, appended to the JSON-only system message when requested.
const CONCEPTS_SIDE_CHANNEL =
  "Additionally, the JSON object MAY include one extra top-level field `concepts`: " +
  "an array of 1-5 SHORT names of the key concepts/terms central to the content, in " +
  "the content's own language. It rides beside the requested schema; omit it when unsure.";

/** Max side-channel names honored per generation (mirrors the wiki-link cap idea). */
const CONCEPTS_SIDE_CHANNEL_MAX = 8;

// Pull the `concepts` side-channel off a raw model object (when asked for): capture
// the string entries, return the object WITHOUT the key so schema.parse never
// chokes on — or silently keeps — the extra field.
function splitConceptsSideChannel(value: unknown): { concepts: string[]; rest: unknown } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { concepts: [], rest: value };
  const record = value as Record<string, unknown>;
  if (!("concepts" in record)) return { concepts: [], rest: value };
  const { concepts: raw, ...rest } = record;
  const concepts = Array.isArray(raw)
    ? raw
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .slice(0, CONCEPTS_SIDE_CHANNEL_MAX)
    : [];
  return { concepts, rest };
}

/**
 * Generate + validate structured content against `schema`, returning the validated
 * output AND the optional `concepts` side-channel (empty unless `suggestConcepts`
 * asked for it and the model volunteered names). On a schema mismatch it re-prompts
 * (up to `maxAttempts`) with the validation error, then throws.
 */
export async function generateStructuredWithConcepts(
  provider: ModelProvider,
  request: StructuredGenerateRequest,
  maxAttempts = 3
): Promise<StructuredWithConcepts> {
  const system = request.suggestConcepts ? `${JSON_ONLY}\n${CONCEPTS_SIDE_CHANNEL}` : JSON_ONLY;
  const messages: ChatMessage[] = [{ role: "system", content: system }, ...request.messages];

  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let raw: string;
    if (provider.completeStructured) {
      raw = (
        await provider.completeStructured({
          messages,
          context: request.context,
          contentType: request.contentType ?? "",
          sample: request.sample
        })
      ).json;
    } else {
      raw = (await provider.complete({ messages, context: request.context })).message.content;
    }
    try {
      const parsed = extractJson(raw);
      const { concepts, rest } = request.suggestConcepts
        ? splitConceptsSideChannel(parsed)
        : { concepts: [] as string[], rest: parsed };
      return { output: request.schema.parse(rest), concepts };
    } catch (error) {
      lastError = error;
      messages.push({
        role: "user",
        content: `That did not match the schema (${error instanceof Error ? error.message : "invalid"}). Return ONLY corrected JSON.`
      });
    }
  }
  throw new StructuredGenerationError(
    `Could not produce valid structured content: ${lastError instanceof Error ? lastError.message : "unknown"}`
  );
}

// Generate + validate structured content against `schema`. On a schema mismatch it
// re-prompts (up to `maxAttempts`) with the validation error, then throws. (The
// output-only view over generateStructuredWithConcepts — the pre-CG-2 contract.)
export async function generateStructured(
  provider: ModelProvider,
  request: StructuredGenerateRequest,
  maxAttempts = 3
): Promise<unknown> {
  return (await generateStructuredWithConcepts(provider, request, maxAttempts)).output;
}
