// Structured generation — the React-free core of Product Kit AI commands. Given a
// promptId + contentType + input, it builds the prompt, asks the provider for JSON,
// extracts + validates it against the contentType's NoteContentSpec schema, and
// retries a few times on malformed output. The MOCK provider echoes the prompt's
// deterministic `mockContent`, so this is fully testable offline.

import { getNoteContentSpec } from "../core/notes/contentTypes";
import type { ChatContext, ChatMessage, ModelProvider } from "../ai/provider";
import { getKitPrompt } from "./prompts";

export type GenerateStructuredRequest = {
  promptId: string;
  contentType: string;
  input?: Record<string, unknown>;
  context?: ChatContext;
};

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

export class StructuredGenerationError extends Error {}

// Generate + validate structured note content. `maxAttempts` re-prompts the model
// with the validation error when its output doesn't fit the schema.
export async function generateStructuredContent(
  provider: ModelProvider,
  request: GenerateStructuredRequest,
  maxAttempts = 3
): Promise<unknown> {
  const prompt = getKitPrompt(request.promptId);
  if (!prompt) throw new StructuredGenerationError(`Unknown promptId: ${request.promptId}`);
  const spec = getNoteContentSpec(request.contentType);
  if (!spec) throw new StructuredGenerationError(`Unknown contentType: ${request.contentType}`);
  if (prompt.outputType !== request.contentType) {
    throw new StructuredGenerationError(
      `Prompt ${prompt.id} outputs ${prompt.outputType}, not ${request.contentType}`
    );
  }

  const input = request.input ?? {};
  const sample = prompt.mockContent ? prompt.mockContent(input) : spec.createDefault();
  const messages: ChatMessage[] = [
    { role: "system", content: JSON_ONLY },
    { role: "user", content: prompt.build(input) }
  ];

  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let raw: string;
    if (provider.completeStructured) {
      raw = (await provider.completeStructured({ messages, context: request.context, contentType: request.contentType, sample })).json;
    } else {
      raw = (await provider.complete({ messages, context: request.context })).message.content;
    }
    try {
      return spec.schema.parse(extractJson(raw));
    } catch (error) {
      lastError = error;
      messages.push({
        role: "user",
        content: `That did not match the schema (${error instanceof Error ? error.message : "invalid"}). Return ONLY corrected JSON.`
      });
    }
  }
  throw new StructuredGenerationError(
    `Could not produce valid ${request.contentType} content: ${lastError instanceof Error ? lastError.message : "unknown"}`
  );
}
