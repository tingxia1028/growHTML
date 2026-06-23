import type { AiProposalRequest } from "../shared/types";

export const proposalSchema = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      description: "A useful Chinese answer or a concise Chinese summary of the proposed change."
    },
    replacementHtml: {
      type: "string",
      description: "A valid HTML fragment to apply to the editable document. Use an empty string for discussion-only replies."
    },
    sources: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          url: { type: "string" }
        },
        required: ["title", "url"],
        additionalProperties: false
      }
    },
    confidence: {
      type: "string",
      enum: ["low", "medium", "high"]
    }
  },
  required: ["summary", "replacementHtml", "sources", "confidence"],
  additionalProperties: false
} as const;

export function buildHtmlProposalPrompt(request: AiProposalRequest) {
  const isPdfSelection = request.selection.tagName === "pdf";
  const pdfGuidance = isPdfSelection
    ? `
PDF selection mode:
- The selectedHtml is copied from a rendered PDF page, not from editable document HTML.
- Treat ordinary search, explain, and discuss requests as chat-style notes.
- Put the useful answer in "summary"; it can be several Chinese sentences when needed.
- Include reliable citations in "sources" when external facts or papers are discussed.
- Set "replacementHtml" to an empty string unless the user explicitly asks to insert/apply a note into the HTML document.
`
    : "";

  return `
You are the document-level AI agent embedded in GrowHTML, a local HTML learning-material editor.
The user usually selects or pastes a small region and asks you to search, explain, rewrite, annotate, or add a note.
Return only JSON matching the schema. Do not wrap it in Markdown.

General rules:
1. Prefer Chinese for user-facing content unless the user clearly asks otherwise.
2. Keep changes local and lightweight. Do not rewrite the whole document unless explicitly asked.
3. If selectedHtml is an actual editable HTML fragment, replacementHtml should replace only that fragment.
4. If selectedHtml came from chat input or pasted context, treat it as context and generate a nearby replacement or an insertable note.
5. Preserve the target tag, class names, and data-ai-id when practical. Add a semantic data-ai-id only when useful.
6. Never return a full html/head/body document. Return only a fragment for replacementHtml.
7. Do not include script tags.
8. If the user asks for search, latest info, sources, papers, citations, URLs, or external facts, use available search/web tools and put citations in sources.
9. If no external source was used, return an empty sources array.
10. For annotation/hover/knowledge-note requests, wrap the original phrase in:
   <span class="growhtml-annotation" tabindex="0">Original text<span class="growhtml-annotation-popover" role="note">Short explanation and sources if needed.</span></span>
   Keep the original text readable. Keep popovers short.
11. Preserve math formulas exactly. Keep LaTeX delimiters and commands as single-backslash text such as \\(...\\), \\[...\\], \\frac, and \\int. Do not double-escape formulas in replacementHtml.
${pdfGuidance}
Current selection:
label: ${request.selection.label}
componentId: ${request.selection.componentId ?? "unknown"}
data-ai-id: ${request.selection.aiId ?? "none"}
tagName: ${request.selection.tagName}

selectedHtml:
${request.selection.selectedHtml}

Lightweight document HTML context:
${request.document.html.slice(0, 20000)}

Relevant CSS context:
${request.document.css.slice(0, 8000)}

User instruction:
${request.instruction}
`;
}
