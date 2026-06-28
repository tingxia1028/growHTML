// resolveForm — the SINGLE choke point that turns any produced output (a chat reply,
// a paste, a kit/model generation) into a note FORM = { contentType, content,
// confidence } (design plan §0.5-A, decision §6.7).
//
//   • Declared form (caller / kit / model supplied a contentType) → TRUST it
//     (confidence "high"). A flashcard generator always produces flashcards; a routed
//     prompt names its own type — neither should be forced through the heuristic.
//   • No declared form → delegate to classifyContent(text) (the inference path used by
//     chat / paste / free text).
//
// Placing every note-producing path behind this one function is what lets the
// "identification side" of the contract harden later (decision §6.6): today it is a
// strong convention + the live chat-save consumer; a single seam to enforce.
//
// Pure + dependency-free (no React / fetch), so server and client share it.

import { classifyContent, type ClassifiedForm } from "./classifyContent";

export type ResolveFormInput = {
  /** A declared form's contentType, when the producer already knows it. */
  contentType?: string;
  /** Content for a declared form (verbatim — trusted as-is). */
  content?: unknown;
  /** Free text to classify when no form is declared. */
  text?: string;
};

/**
 * Resolve a produced output into a note form. A declared `contentType` is trusted
 * (high); otherwise `text` is classified. With neither, falls back to an empty
 * markdown note (low) — never throws.
 */
export function resolveForm(input: ResolveFormInput): ClassifiedForm {
  // Declared form wins: trust the producer (markmap kit, routed model, …) — do NOT
  // re-run the heuristic over content the caller already shaped.
  if (typeof input.contentType === "string" && input.contentType.length > 0) {
    return { contentType: input.contentType, content: input.content, confidence: "high" };
  }
  // Inference path: classify the free text (chat / paste / unlabelled).
  return classifyContent(typeof input.text === "string" ? input.text : "");
}
