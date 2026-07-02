// Shared study-context prompt shaping — the sourceBlock/passageBlock weaving
// lifted out of cliAgent/spec.ts into the tiny shared module the design doc
// names (docs/design/multi-provider-ai-agent.md §4.1: "the existing CLI
// providers' sourceBlock/passageBlock prompt-shaping logic can be lifted into a
// shared src/ai/buildPrompt.ts so every provider weaves study context
// identically"). cli-agent adapters join these blocks into prompt STRINGS;
// http providers prepend them as a system MESSAGE — same text either way.
// Pure string building over ChatContext; imports nothing but the provider
// seam (iron rule).

import type { ChatContext } from "./provider";

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
 * Both context blocks joined the way every prompt-shaper composes them
 * (source identity first, then the passage). Empty string when the context
 * carries nothing — callers skip the weaving entirely in that case.
 */
export function contextPreamble(ctx: ChatContext | undefined): string {
  return [sourceBlock(ctx), passageBlock(ctx)].filter(Boolean).join("\n\n");
}
