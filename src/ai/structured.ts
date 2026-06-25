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
const JSON_ONLY =
  "You output ONLY a single JSON object that matches the requested schema. " +
  "No prose, no markdown fences, no comments — just the JSON.";

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
};

// Generate + validate structured content against `schema`. On a schema mismatch it
// re-prompts (up to `maxAttempts`) with the validation error, then throws.
export async function generateStructured(
  provider: ModelProvider,
  request: StructuredGenerateRequest,
  maxAttempts = 3
): Promise<unknown> {
  const messages: ChatMessage[] = [{ role: "system", content: JSON_ONLY }, ...request.messages];

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
      return request.schema.parse(extractJson(raw));
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
