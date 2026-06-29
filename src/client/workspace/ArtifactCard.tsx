// PreviewCard (exported as ArtifactCard for back-compat) — the ONE shared lightweight
// note preview (§10.1 "Preview Card", design plan §3.5). Used UNIFORMLY by every
// surface that shows a note compactly: the chat thread, the note viewer, the reader's
// anchor note clusters, the right-column related-note list. There is no per-surface
// card — each caller hands the SAME block, and the body comes through the one sanctioned
// path getNoteType(contentType).render({ ..., mode: "card" }) (display-side hard
// contract §0.5-B). Double-click (or click) opens the FULL interactive view in the
// shared CenterView (FocusOverlay), so card · overlay · saved note all flow through one
// render entry.
//
// §10 card chrome (this wrapper owns it; the plugin owns only the small body):
//   ┌ [type icon] type-name … ⋯ ┐
//   │ Bold title                │
//   │ short per-type body       │
//   └ P<page> · <extra> · <layer> ┘
// The footer parts are OPTIONAL block metadata the host threads in (page/layer come from
// the note's anchor/layer; extra = a content-derived hint like "3 questions" / a
// language). Absent parts are simply omitted — the card never fabricates them.

import { useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { getNoteType } from "../notes/noteTypeRegistry";
import { noteTypeIcon } from "../notes/noteTypeIcon";
import { FocusOverlay, type FocusOverlayBlock } from "./FocusOverlay";

// A plain-text snippet from any content shape (string passes through; an object is
// JSON-stringified) — the generic card's title fallback, never raw HTML.
function snippetOf(content: unknown): string {
  const text = typeof content === "string" ? content : JSON.stringify(content ?? {});
  return text.replace(/\s+/g, " ").trim();
}

// The plugin's "card" body (light preview). A plugin that ignores `mode` still returns a
// usable node; the heavy diagram/html plugins explicitly return a LIGHT preview for
// "card" so the thread never mounts a live diagram/iframe. Null → the wrapper alone.
function cardBody(block: FocusOverlayBlock): ReactNode {
  const plugin = getNoteType(block.contentType);
  if (plugin) {
    const node = plugin.render({ content: block.content, note: block.note, mode: "card" });
    if (node) return node;
  }
  return null;
}

// The footer meta line "P<page> · <extra> · <layer>" — only the parts we actually have.
function FooterMeta({ block }: { block: FocusOverlayBlock }) {
  const parts: string[] = [];
  if (block.page != null) parts.push(`P${block.page}`);
  if (block.extra) parts.push(block.extra);
  if (block.layer) parts.push(block.layer);
  if (parts.length === 0) return null;
  return <span className="sv-card-footer">{parts.join(" · ")}</span>;
}

export function ArtifactCard({ block }: { block: FocusOverlayBlock }) {
  const [open, setOpen] = useState(false);
  const title = block.title ?? (snippetOf(block.content).slice(0, 80) || block.contentType);
  const body = cardBody(block);
  const Icon = noteTypeIcon(block.contentType);

  return (
    <>
      <div
        className={`sv-artifact-card sv-preview-card sv-artifact-card-${block.contentType}`}
        role="button"
        tabIndex={0}
        aria-haspopup="dialog"
        title={`Open ${block.contentType} (double-click)`}
        // Single click and double-click both open the centered view — single keeps the
        // long-standing behavior the chat thread/tests rely on, double-click matches the
        // §10 "双击预览卡 → Center View" gesture. Keyboard: Enter/Space opens too.
        onClick={() => setOpen(true)}
        onDoubleClick={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="sv-artifact-head sv-card-head">
          <span className="sv-artifact-icon" aria-hidden="true">
            <Icon size={15} />
          </span>
          {/* The type NAME (the §10 header label). Keeps the legacy .sv-artifact-badge
              hook so the form is named exactly once. */}
          <span className="sv-artifact-badge sv-card-type">{block.contentType}</span>
          <span className="sv-card-more" aria-hidden="true">
            <MoreHorizontal size={15} />
          </span>
        </span>
        <span className="sv-card-title sv-artifact-title">{title}</span>
        {body ? <span className="sv-artifact-thumb sv-card-body">{body}</span> : null}
        <FooterMeta block={block} />
      </div>
      {open ? <FocusOverlay block={block} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
