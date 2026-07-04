// W3 — AI doc synthesis service (ai-workspace.md §W3). Turns a chat transcript (+ its
// W2 attachment context) into a NEW first-class MARKDOWN source in the vault: build the
// synthesis messages (pure, src/ai/synthesizePrompt), ask the provider for a
// {title, markdown} object via the structured-generation engine (deterministic mock
// echo + the re-prompt loop), then `ingestSource` the markdown as an AUTHORED source.
// Its `#`/`##` headings become the reader's outline for free (projectedHtmlForSource) —
// NO schema change, NO new note type.
//
// SAFETY: synthesis rides the PLAIN chat lane — it never touches the profileContext
// gate or the auto-context envelope (those are generateKitContent's), so no learner
// profile can leak. Sealed notes are already filtered out UPSTREAM by the client's
// resolveAttachmentBundles (buildSourceBundle) before the context reaches this service.

import { z } from "zod";
import {
  buildSynthesisMessages,
  chatContextSchema,
  chatMessageSchema,
  generateStructured,
  synthesisDocSchema,
  type ModelProvider
} from "../../ai";
import { ingestSource } from "../../core/store/sources";
import type { SourceRecord } from "../../core/schema";
import type { StudyVault } from "../../core/vault";

export type SynthesisDeps = { provider: ModelProvider; vault: StudyVault };

// Body for POST /api/chat/synthesize — the transcript to consolidate + the (optional)
// W2 chat context (the attachments the client already resolved via
// resolveAttachmentBundles). `sample` forces a deterministic {title, markdown} against
// the offline mock (the e2e seeds it via the composer payload). `instruction` is an
// optional extra directive appended to the synthesis system message.
export const synthesizeRequestSchema = z.object({
  messages: z.array(chatMessageSchema).min(1),
  context: chatContextSchema.optional(),
  instruction: z.string().optional(),
  sample: z.unknown().optional()
});
export type SynthesizeInput = z.infer<typeof synthesizeRequestSchema>;

/**
 * A model output whose `markdown` is a bare FILE PATH rather than document text — the
 * claude-cli degrade risk (DELTA 5): a cli-agent's `completeStructured` falls back to
 * `complete()` + extractJson and can return a path it "wrote the doc to". Such a string
 * passes `min(1)` yet would persist a filename as the whole source. This is a coarse,
 * best-effort guard: a short single-line string that looks like a path and carries no
 * Markdown structure (no heading, no newline, no prose spaces). The RELIABLE fix is a
 * content-returning provider; the mock/`sample` path never trips this.
 */
function looksLikeBarePath(markdown: string): boolean {
  const trimmed = markdown.trim();
  if (trimmed.length === 0 || trimmed.length > 260) return false;
  if (trimmed.includes("\n")) return false; // a real doc has line breaks
  if (/\s{2,}/.test(trimmed) || / .+ /.test(trimmed)) return false; // prose has spaces
  // Windows or POSIX path shape, ending in a doc-ish extension.
  return /(^[a-zA-Z]:[\\/]|^[.~]?[\\/]|[\\/])/.test(trimmed) && /\.(md|markdown|txt|html?)$/i.test(trimmed);
}

/**
 * Synthesize a chat transcript (+ attachments) into a NEW markdown source. Validates
 * the model output ONLY against `synthesisDocSchema` (DELTA 4 — there is no
 * `synthesis-doc` note type; the output is a document body, not a note) and ingests the
 * markdown DIRECTLY as an authored source. `contentType: ""` is passed to
 * `generateStructured` (DELTA 4 — no fabricated content type). A `StructuredGenerationError`
 * from the engine bubbles up for the route to map to 400.
 */
export async function synthesizeDocument(
  { provider, vault }: SynthesisDeps,
  input: SynthesizeInput
): Promise<{ source: SourceRecord }> {
  const messages = buildSynthesisMessages({
    transcript: input.messages,
    context: input.context,
    instruction: input.instruction
  });

  const doc = synthesisDocSchema.parse(
    await generateStructured(provider, {
      messages,
      schema: synthesisDocSchema,
      // DELTA 4: NO fabricated note type — the output is a document, validated ONLY
      // against synthesisDocSchema, so no contentType is claimed.
      contentType: "",
      sample: input.sample
    })
  );

  // DELTA 5 guard: refuse to persist a bare file path masquerading as the document.
  if (looksLikeBarePath(doc.markdown)) {
    throw new SynthesisPathResultError(
      `Synthesis produced a file path instead of document text: ${doc.markdown}`
    );
  }

  // Ingest the markdown directly as a first-class AUTHORED source (annotatable like any
  // other; its headings become the reader outline via projectedHtmlForSource).
  const source = await ingestSource(vault, {
    sourceType: "markdown",
    title: doc.title,
    content: doc.markdown,
    origin: "authored",
    createdBy: "user"
  });

  return { source };
}

/** Thrown when the model returned a bare file path as the document body (DELTA 5). */
export class SynthesisPathResultError extends Error {}
