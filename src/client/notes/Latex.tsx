// <Latex> — the ONE shared LaTeX render seam (subject-kits.md PART 4.1 + §8 KaTeX
// decision). All math-rendering note types (subject.formula now; derivation/theorem in
// M-C) call THIS component / helper — the same "one shared implementation behind a
// contract" discipline the diagram types keep with DiagramNote. No other module may
// import katex directly.
//
// Decision (M-B gate, verified empirically 2026-07-02 — evidence in subject-kits.md §8):
// katex@0.17.0 renderToString is a PURE string renderer — no window/document needed
// (SSR-safe), works under the repo's jsdom vitest env, and Vite bundles katex.min.css +
// fonts out of the box (relative url(fonts/…) → hashed assets).
//
// Hard options, always:
//   • throwOnError:false — bad TeX degrades to KaTeX's inert .katex-error span; a
//     hand-rolled/AI-mangled formula can never crash a note list (the render-never-throws
//     contract every plugin obeys).
//   • trust:false — \href/\includegraphics style commands cannot emit live URLs
//     (javascript: injection stays dead; KaTeX escapes all text output).
// A belt-and-braces try/catch covers non-parse throws with an escaped <code> fallback —
// the PART 4.1 "raw + copy affordance" degradation, so the seam is total.

import { useMemo } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import { escapeHtml } from "../../adapters/notes/render";

/** Typeset TeX → HTML string. Pure (no DOM needed); never throws. */
export function renderMath(tex: string, opts?: { display?: boolean }): string {
  const source = typeof tex === "string" ? tex : "";
  try {
    return katex.renderToString(source, {
      displayMode: opts?.display === true,
      throwOnError: false,
      trust: false
    });
  } catch {
    // throwOnError:false already swallows ParseErrors; this guards anything else.
    return `<code class="sv-latex-raw">${escapeHtml(source)}</code>`;
  }
}

export type LatexProps = {
  value: string;
  /** true → inline (<span>, text-sized); default → display/block math. */
  inline?: boolean;
};

/** The shared math element. `dangerouslySetInnerHTML` is safe here: the HTML comes
    exclusively from katex.renderToString (trust:false escapes all user text) or from
    our own escapeHtml fallback — never raw note content. */
export function Latex({ value, inline }: LatexProps) {
  const html = useMemo(() => renderMath(value, { display: !inline }), [value, inline]);
  const className = `sv-latex ${inline ? "sv-latex-inline" : "sv-latex-block"}`;
  return inline ? (
    <span className={className} dangerouslySetInnerHTML={{ __html: html }} />
  ) : (
    <div className={className} dangerouslySetInnerHTML={{ __html: html }} />
  );
}
