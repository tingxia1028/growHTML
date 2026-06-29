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

// An OPTIONAL structured AI classify pass (design plan §4 Phase 4 item 2). It is
// supplied by a CALLER that has a model wired (e.g. the client routing through a server
// endpoint) — the pure core never imports a provider/fetch. Given the ambiguous text it
// returns a resolved form, or null to keep the heuristic's result. Kept as a callback
// so the dependency lives at the call site, NOT inside the pure resolve/classify core.
export type AiClassify = (text: string) => Promise<ClassifiedForm | null>;

export type ResolveFormAsyncOptions = {
  /** When present AND the heuristic is low-confidence, asks the model to decide. */
  classify?: AiClassify;
};

/**
 * Async resolve — the recognition choke point WITH an optional AI fallback for
 * ambiguous prose (Phase 4 item 2). Order, additive and offline-safe by default:
 *   1. Declared contentType → TRUST it (high) — same as the sync path, no model call.
 *   2. Else run the pure heuristic `classifyContent(text)`.
 *   3. If that is HIGH confidence → use it (NO model call — heuristic stays primary).
 *   4. If LOW confidence AND a `classify` callback is provided → ask the model; use its
 *      answer when it returns one, else keep the heuristic's markdown fallback.
 *   5. No callback (offline / no provider) → today's behavior exactly (heuristic +
 *      markdown fallback). NEVER throws — a failing AI pass degrades to the heuristic.
 *
 * The pure sync `resolveForm` is left intact for callers that don't want a model call.
 */
export async function resolveFormAsync(
  input: ResolveFormInput,
  options: ResolveFormAsyncOptions = {}
): Promise<ClassifiedForm> {
  // 1. Declared form wins — never a model call.
  if (typeof input.contentType === "string" && input.contentType.length > 0) {
    return { contentType: input.contentType, content: input.content, confidence: "high" };
  }
  // 2. Heuristic first (primary path).
  const text = typeof input.text === "string" ? input.text : "";
  const heuristic = classifyContent(text);
  // 3. A confident heuristic match is authoritative — no model call.
  if (heuristic.confidence === "high") return heuristic;
  // 4. Low confidence + a provider available → AI classify; tolerate failure.
  if (options.classify) {
    try {
      const ai = await options.classify(text);
      if (ai) return ai;
    } catch {
      // AI pass failed/unavailable — fall through to the heuristic's safe fallback.
    }
  }
  // 5. No provider, or the AI declined → the heuristic's markdown fallback (low).
  return heuristic;
}
