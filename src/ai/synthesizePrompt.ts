// W3 — AI doc synthesis prompt shaping (ai-workspace.md §W3). Turns a chat
// TRANSCRIPT (+ its W2 attachment context) into the messages that ask the model to
// emit ONE markdown document whose `#`/`##` headings are the table of contents. Pure
// string/message building over the provider seam (iron rule): imports nothing but
// `ChatContext`/`ChatMessage` + the shared `contextPreamble` weaver, so the
// "Attached: N source(s)" marker rides the SAME code path W2 chat does (the e2e /
// unit assertion hook). The schema the synthesis service validates the model output
// against lives here too so the pure layer owns the contract.

import { z } from "zod";
import { contextPreamble, messageText } from "./buildPrompt";
import type { ChatContext, ChatMessage } from "./provider";

/**
 * The synthesis output contract (REQUIRED DELTA 3). `.min(1)` on BOTH fields is what
 * stops an EMPTY source being persisted: `ingestSource` accepts empty content (the
 * source schema has no content-min), and the button's `isAvailable` only gates the
 * click — so an empty `{title:"",markdown:""}` would otherwise write a blank source.
 * The mock echoes the caller's `sample` (deterministic), real providers generate.
 */
export const synthesisDocSchema = z.object({
  title: z.string().min(1),
  markdown: z.string().min(1)
});
export type SynthesisDoc = z.infer<typeof synthesisDocSchema>;

/**
 * Transcript character budget (over the joined turn text). The transcript can be long;
 * we keep it under a cap the provider can accept by DROPPING OLDEST turns while always
 * keeping the FINAL user turn (the instruction that most directly steers the doc).
 */
export const SYNTHESIS_TRANSCRIPT_CAP = 24_000;

// A stable phrase the synthesis system instruction carries. The offline MOCK detects it
// (a request whose messages contain this marker) to return a DETERMINISTIC default
// {title, markdown} when the caller supplied no `sample` — the exact precedent the
// form-router default sets (mockProvider.ts), so a real button click (no sample) still
// yields a schema-valid document offline instead of an empty `{}` that would 400. Real
// providers ignore it; a supplied `sample` always wins.
export const SYNTHESIS_PROMPT_MARKER = "study-document synthesizer";

// The system instruction: synthesize the whole conversation + the attached sources into
// ONE cohesive markdown document, using `#`/`##` headings as the table of contents, and
// return it as {title, markdown}. Named so the JSON-only wrapper (structured.ts) still
// applies; this is the DOMAIN instruction that rides on top.
const SYNTHESIS_INSTRUCTION =
  `You are a ${SYNTHESIS_PROMPT_MARKER}. Read the ENTIRE conversation below (and any ` +
  "attached sources) and write ONE cohesive Markdown document that organizes and " +
  "consolidates what was discussed. Use `#` and `##` Markdown headings to structure it — " +
  "those headings ARE the document's table of contents, so make them meaningful. Return a " +
  "JSON object with two fields: `title` (a short, descriptive document title) and " +
  "`markdown` (the COMPLETE document body as inline Markdown text — never a file path or " +
  "filename, and never write a file to disk; put the full text directly in the field).";

/** One transcript turn rendered for the prompt: a role label + its content. */
function renderTurn(message: ChatMessage): string {
  const label = message.role === "user" ? "User" : message.role === "assistant" ? "Assistant" : "System";
  // V-1: collapse a multimodal turn to text (image → `[image]`) for the transcript.
  return `${label}: ${messageText(message.content)}`;
}

/**
 * Cap the transcript to `SYNTHESIS_TRANSCRIPT_CAP` chars of rendered text by dropping
 * the OLDEST turns first, but ALWAYS keeping the final user turn (the freshest
 * instruction). Returns the surviving turns in original order.
 *
 * The final user turn is kept even if it alone exceeds the cap (a single huge
 * instruction is better truncated by the provider than dropped entirely).
 */
function capTranscript(transcript: ChatMessage[]): ChatMessage[] {
  if (transcript.length === 0) return [];
  const lastUserIndex = (() => {
    for (let i = transcript.length - 1; i >= 0; i -= 1) {
      if (transcript[i].role === "user") return i;
    }
    return -1;
  })();

  // Walk newest→oldest accumulating length; stop once adding a turn would overflow.
  // The final user turn is force-included regardless of the running total.
  const kept: number[] = [];
  let used = 0;
  for (let i = transcript.length - 1; i >= 0; i -= 1) {
    const cost = renderTurn(transcript[i]).length + 1; // +1 for the joining newline
    if (i === lastUserIndex) {
      kept.push(i);
      used += cost;
      continue;
    }
    if (used + cost > SYNTHESIS_TRANSCRIPT_CAP) continue; // drop this (older) turn
    kept.push(i);
    used += cost;
  }
  kept.sort((a, b) => a - b);
  return kept.map((i) => transcript[i]);
}

/**
 * The deterministic OFFLINE default the mock returns for a synthesis request that
 * carried no `sample`: a small {title, markdown} doc WITH `#`/`##` headings (so the
 * reader outline is exercised) that echoes the final user turn. Real providers never
 * use this; a supplied `sample` always wins.
 */
export function defaultSynthesisDoc(messages: ChatMessage[]): SynthesisDoc {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const ask = (lastUser ? messageText(lastUser.content) : "").replace(/\s+/g, " ").trim().slice(0, 80);
  return {
    title: ask ? `Synthesized: ${ask.slice(0, 40)}` : "Synthesized Document",
    markdown: `# Synthesized Document\n\n## Summary\n\n${ask || "A synthesized study document."}`
  };
}

export type BuildSynthesisMessagesInput = {
  /** The chat transcript to consolidate. */
  transcript: ChatMessage[];
  /** The W2 chat context (attachments ride via contextPreamble's "Attached: N" marker). */
  context?: ChatContext;
  /** An optional extra instruction appended to the system directive. */
  instruction?: string;
};

/**
 * Build the messages for a synthesis call: a system message carrying the domain
 * instruction + the (optional) attachment/source preamble, then ONE user message
 * carrying the capped transcript. The attachment preamble is EMPTY at zero
 * attachments (contextPreamble returns "" then), so the marker is present only when
 * something is attached — the direct assertion hook.
 */
export function buildSynthesisMessages(input: BuildSynthesisMessagesInput): ChatMessage[] {
  const preamble = contextPreamble(input.context);
  const systemParts = [SYNTHESIS_INSTRUCTION];
  if (input.instruction?.trim()) systemParts.push(input.instruction.trim());
  if (preamble) systemParts.push(preamble);
  const system = systemParts.join("\n\n");

  const turns = capTranscript(input.transcript).map(renderTurn).join("\n");
  const user = turns
    ? `Here is the conversation to synthesize:\n\n${turns}`
    : "Synthesize the attached sources into one Markdown document.";

  return [
    { role: "system", content: system },
    { role: "user", content: user }
  ];
}
