// Product Kit structured generation — a THIN wrapper over the base-layer engine
// (`src/ai/structured.ts`). It resolves a kit prompt + the contentType's
// NoteContentSpec schema, then delegates the generate/validate/retry loop to the
// engine. The kit owns only the domain bits (which prompt, which schema, the
// deterministic sample); `src/ai` owns the mechanism and never imports a kit.

import { getNoteContentSpec } from "../core/notes/contentTypes";
import type { OperationRecord } from "../core/schema";
import type { SnapshotStore } from "../core/store/snapshotStore";
import type { ChatContext, ModelProvider } from "../ai/provider";
import { generateStructured, StructuredGenerationError } from "../ai/structured";
import { resolvePrompt } from "./resolvePrompt";

// Re-export so existing importers (and tests) keep their import path.
export { StructuredGenerationError, extractJson } from "../ai/structured";

export type GenerateStructuredRequest = {
  promptId: string;
  contentType: string;
  input?: Record<string, unknown>;
  context?: ChatContext;
};

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
  const prompt = await resolvePrompt(request.promptId, store);
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
  return generateStructured(
    provider,
    {
      messages: [{ role: "user", content: prompt.build(input) }],
      schema: spec.schema,
      sample,
      contentType: request.contentType,
      context: request.context
    },
    maxAttempts
  );
}
