// Shared study-context prompt shaping — the sourceBlock/passageBlock weaving
// lifted out of cliAgent/spec.ts into the tiny shared module the design doc
// names (docs/design/multi-provider-ai-agent.md §4.1: "the existing CLI
// providers' sourceBlock/passageBlock prompt-shaping logic can be lifted into a
// shared src/ai/buildPrompt.ts so every provider weaves study context
// identically"). cli-agent adapters join these blocks into prompt STRINGS;
// http providers prepend them as a system MESSAGE — same text either way.
// Pure string building over ChatContext; imports nothing but the provider
// seam (iron rule).

import type { ChatContext, ChatContextSource } from "./provider";

/**
 * Identify the source so the model knows what's being discussed: title, type,
 * and where it lives (URL / file path / page).
 */
export function sourceBlock(ctx: ChatContext | undefined): string {
  if (!ctx) return "";
  const head = [ctx.sourceTitle, ctx.sourceType ? `(${ctx.sourceType})` : ""].filter(Boolean).join(" ");
  const lines = [head ? `Source: ${head}` : "", ctx.location ? `Location: ${ctx.location}` : ""].filter(Boolean);
  return lines.join("\n");
}

/**
 * The selected passage with its surrounding context, so the model can locate the
 * exact span the user means even when the quote is short or ambiguous.
 */
export function passageBlock(ctx: ChatContext | undefined): string {
  if (!ctx?.quote) return "";
  const before = ctx.contextBefore ? `…${ctx.contextBefore}` : "";
  const after = ctx.contextAfter ? `${ctx.contextAfter}…` : "";
  return `Selected passage (between ⟦⟧, with surrounding context):\n${before}⟦${ctx.quote}⟧${after}`;
}

/**
 * One attached source rendered as a labelled block: its identity line, the bounded
 * body excerpt, and each note's text. Pure over the already-bounded ChatContextSource
 * (the bundle service caps the excerpt + note count; the resolver caps the
 * cross-source total) — this weaver only formats.
 */
function attachedSourceBlock(source: ChatContextSource, index: number): string {
  const head = [source.title, source.type ? `(${source.type})` : ""].filter(Boolean).join(" ");
  const lines = [`[${index + 1}] ${head || "Untitled source"}`];
  if (source.location) lines.push(`Location: ${source.location}`);
  if (source.excerpt) lines.push(`Excerpt:\n${source.excerpt}`);
  const notes = source.notes ?? [];
  if (notes.length > 0) {
    lines.push("Notes:");
    for (const note of notes) {
      const label = note.contentType ? `(${note.contentType}) ` : "";
      lines.push(`- ${label}${note.text}`);
    }
  }
  return lines.join("\n");
}

/**
 * The W2 attachments block: every source the chat carries as context, headed by a
 * count marker ("Attached: N source(s)") the deterministic mock echoes to prove an
 * attachment reached the prompt. Empty string when nothing is attached — so a
 * zero-attachment request produces NO extra text (the byte-for-byte prior path).
 */
export function attachmentsBlock(ctx: ChatContext | undefined): string {
  const sources = ctx?.sources ?? [];
  if (sources.length === 0) return "";
  const header = `Attached: ${sources.length} source(s)`;
  const blocks = sources.map((source, index) => attachedSourceBlock(source, index));
  return [header, ...blocks].join("\n\n");
}

/**
 * The context blocks joined the way every prompt-shaper composes them (source
 * identity first, then the passage, then the W2 attachments). Empty string when the
 * context carries nothing — callers skip the weaving entirely in that case. The
 * attachments block appends only when `sources[]` is non-empty, so the pre-W2 output
 * is byte-identical for a zero-attachment context.
 */
export function contextPreamble(ctx: ChatContext | undefined): string {
  return [sourceBlock(ctx), passageBlock(ctx), attachmentsBlock(ctx)].filter(Boolean).join("\n\n");
}
