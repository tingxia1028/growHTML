// Markdown SOURCE-body preview (SRC-1 editor live pane). This renders a document
// BODY, not note content — the §0.5-B display contract (note content only through
// getNoteType().render) does not apply here, and the workspace-surface guard
// (src/client/notes/contract.guard.test.ts) rightly forbids raw renderNoteContent
// calls in host files. So the one sanctioned source-preview call lives in THIS
// module, outside the guarded host surface, mirroring the server's
// projectedHtmlForSource (services/sourceAuthoring.ts): same renderer in, same
// HTML out, so the live preview matches what the reader will show after save
// (minus study-id injection, which the preview doesn't need).
import { renderNoteContent } from "../adapters/notes/render";

/** Sanitized preview HTML for a markdown source body (the editor's live pane). */
export function renderMarkdownSourcePreview(markdown: string): string {
  return renderNoteContent("markdown", markdown).html;
}
