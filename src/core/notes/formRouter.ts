// formRouter — the "model picks the form" transport for adaptive note forms
// (design plan §4 Phase 4 item 1; research §4.1 Design A). A SINGLE structured call
// lets the model BOTH choose a render form AND fill it in, by returning a member of a
// discriminated union keyed on `form`. This file is PURE + dependency-free (no React,
// no fetch, no DOM, no module state) so server and client share it and it unit-tests
// trivially.
//
// `formRouterSchema` is a TRANSPORT envelope, NOT a stored content shape. The model's
// output is unwrapped into a real `{ contentType, content }` (shaped for that type's
// existing core NoteContentSpec schema) by `routerOutputToNote`, so the result flows
// through the SAME registry render/preview/save path every other note uses (§0.5 —
// every note resolves to a REGISTERED contentType; no bypass, no new render path).
//
// SCOPE — only the CURRENTLY-SUPPORTED forms that already render are offered (markdown,
// markmap, mermaid, code-snippet, video{embed}, html-sandbox{interactive}, flashcard,
// quiz). Adding a future form = one union member + one mapper arm; nothing else moves.

import { z } from "zod";
import { parseVideoUrl } from "./parseVideoUrl";

// looksLikeHtml — a pure, dependency-free guard that the `html-interactive` arm's
// `html` field is ACTUAL markup, not a file path / filename / plain prose. This is the
// RELIABLE half of the "don't save a path as html" fix (the prompt instruction is only
// best-effort): an agentic provider (claude-cli) tends to WRITE a file to disk and
// return only its path (e.g. "generated/公顷和平方千米-互动游戏.html"); without this guard
// that path would land verbatim as the note's html content and never run.
//
// Rule: the string must contain a real HTML tag (an opening `<tag …>` or a closing
// `</tag>`). A bare path ("generated/x.html"), a filename ("x.html"), or plain prose
// has no such tag and FAILS. Wired into the html arm via `.refine`, a failing value
// makes the union member reject → `generateStructured`'s existing re-prompt loop fires;
// after retries it degrades (server: a markdown note carrying the text) — never a path
// persisted as html.
export function looksLikeHtml(value: string): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  // A real tag: an opening `<tagname …>` / `<tagname/>` (the tag name follows `<` with
  // NO space, as in real HTML) OR a closing `</tagname>`. The body up to `>` may carry
  // attributes and a self-closing slash. A bare "generated/x.html" or prose like
  // "a < b and c > d" (a space after `<`) has no such tag, so this is false for paths.
  return /<\/?[a-zA-Z][\w:-]*(\s[^<>]*)?\/?>/.test(trimmed);
}

// The router's output: a discriminated union over the offered forms. Each member
// carries ONLY the fields that form needs (the model fills them). `form` is the
// discriminator — it maps to a registered contentType in `routerOutputToNote`.
export const formRouterSchema = z.discriminatedUnion("form", [
  z.object({ form: z.literal("markdown"), markdown: z.string() }),
  z.object({ form: z.literal("markmap"), outline: z.string() }),
  z.object({ form: z.literal("mermaid"), diagram: z.string() }),
  z.object({
    form: z.literal("code-snippet"),
    language: z.string().default("text"),
    code: z.string()
  }),
  // video — the EMBED variant (a remote provider URL). The mapper parses the URL into
  // the stored embed shape; an unparseable URL degrades to a markdown note (never throws).
  z.object({ form: z.literal("video-embed"), url: z.string() }),
  // html — the INTERACTIVE variant (a self-contained game/widget that runs scripts).
  // `html` is REFINED with looksLikeHtml: it MUST be inline markup, never a file path /
  // filename / prose. A path fails the refine → the union member rejects → the structured
  // re-prompt loop fires (and degrades after retries) rather than persisting a path as
  // html. The refine message doubles as a corrective hint the re-prompt echoes back.
  z.object({
    form: z.literal("html-interactive"),
    html: z
      .string()
      .refine(looksLikeHtml, {
        message:
          "html must be the COMPLETE inline HTML markup (doctype + tags + inline <style>/<script>), " +
          "NOT a file path or filename. Return the full document text, never a path like generated/x.html."
      })
  }),
  z.object({ form: z.literal("flashcard"), front: z.string(), back: z.string() }),
  z.object({
    form: z.literal("quiz"),
    question: z.string(),
    options: z.array(z.string()).min(2),
    answerIndex: z.number().int().nonnegative(),
    explanation: z.string().optional()
  })
]);

export type FormRouterOutput = z.infer<typeof formRouterSchema>;

// The output-format instruction injected into any HTML-producing generation prompt
// (the form router). Best-effort nudge that pairs with the looksLikeHtml refine guard:
// it tells the model to inline the markup rather than write a file + return its path
// (the agentic claude-cli's natural tendency). Exported so the server prompt and any
// future html-producing prompt share one wording.
export const INLINE_HTML_INSTRUCTION =
  "For any html output, the `html` field MUST be the COMPLETE, self-contained HTML " +
  "document inline (a <!doctype html> plus inline <style>/<script>). NEVER write a file " +
  "to disk, NEVER reference or return a file path or filename — the field must be the " +
  "full markup itself, not a path like generated/x.html.";

// The unwrapped, registry-ready result: a registered contentType + content shaped for
// that type's core NoteContentSpec schema (so getNoteContentSpec(contentType).schema
// validates it and getNoteType(contentType).render draws it).
export type RoutedNote = {
  contentType: string;
  content: unknown;
};

/**
 * Map a router output → a real `{ contentType, content }`. PURE + total: every union
 * member is handled, and a malformed embed URL degrades to a markdown note rather than
 * throwing (the union itself already constrains the shape, so this only guards the
 * derived parse). The contentType is always one already registered in
 * `builtinNoteContentSpecs`, so the result renders/saves with zero extra wiring.
 */
export function routerOutputToNote(output: FormRouterOutput): RoutedNote {
  switch (output.form) {
    case "markdown":
      return { contentType: "markdown", content: output.markdown };
    case "markmap":
      return { contentType: "markmap", content: output.outline };
    case "mermaid":
      return { contentType: "mermaid", content: output.diagram };
    case "code-snippet":
      return {
        contentType: "code-snippet",
        content: { language: output.language, code: output.code }
      };
    case "video-embed": {
      // Unwrap the URL into the `video` union's embed member. An unrecognized URL is
      // NOT a hard error — fall back to a markdown note carrying the link.
      const parsed = parseVideoUrl(output.url);
      if (!parsed) return { contentType: "markdown", content: output.url };
      return {
        contentType: "video",
        content: { kind: "embed", provider: parsed.provider, videoId: parsed.videoId, url: output.url }
      };
    }
    case "html-interactive":
      // The persisted contentType id is "html-sandbox" (see contentTypes.ts — NOT
      // renamed); the interactive variant is an internal flag, not a top-level type.
      return { contentType: "html-sandbox", content: { html: output.html, interactive: true } };
    case "flashcard":
      return { contentType: "flashcard", content: { front: output.front, back: output.back } };
    case "quiz":
      return {
        contentType: "quiz",
        content: {
          question: output.question,
          options: output.options,
          answerIndex: output.answerIndex,
          ...(output.explanation !== undefined ? { explanation: output.explanation } : {})
        }
      };
  }
}

// A deterministic, schema-valid sample the offline MOCK provider echoes for the router
// schema (real providers ignore it and actually generate). It is the FIRST union member
// (a markdown note) so the mock is valid + stable out of the box; a caller wanting a
// different deterministic form passes its own sample (e.g. an e2e seeding a markmap).
export const formRouterSample: FormRouterOutput = { form: "markdown", markdown: "" };
