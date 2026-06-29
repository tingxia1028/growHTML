// ArtifactCard — the shared "compact card → click → centered overlay" capability
// (design plan §3.5 requirement 1/2). ONE component used uniformly by BOTH the chat
// thread (rich assistant replies / saved rich notes) and the note viewer — not
// re-implemented per surface (§0.5 / abstract-recurring-capabilities).
//
// A card is a compact preview: a form icon + a title/snippet + a small form-label
// badge + an optional first-screen thumbnail rendered through the SAME registry path
// a saved note uses — getNoteType(contentType).render({ ..., mode: "card" }). Clicking
// the card opens the block's FULL interactive view in the shared FocusOverlay
// (mode:"full"). So card, overlay, and saved note all flow through the one
// getNoteType().render entry — there is no bespoke render path here.
//
// GENERIC card fallback: any contentType gets a card for FREE. We always show the
// icon + title + a text snippet (derived from the content); a plugin that opts into a
// nicer card (e.g. markmap/mermaid render a light preview in "card" mode) supplies the
// thumbnail body, but a plugin that ignores `mode` still gets a usable card from the
// title/snippet alone (and we DON'T mount its heavy full render inline).

import { useState, type ReactNode } from "react";
import { FileText, Network, GitBranch, Code2, Boxes } from "lucide-react";
import type { NoteRecord } from "../data/entityClient";
import { getNoteType } from "../notes/noteTypeRegistry";
import { FocusOverlay, type FocusOverlayBlock } from "./FocusOverlay";

// A plain-text snippet from any content shape (string passes through; an object is
// JSON-stringified) — the generic card's title/preview line, never raw HTML.
function snippetOf(content: unknown): string {
  const text = typeof content === "string" ? content : JSON.stringify(content ?? {});
  return text.replace(/\s+/g, " ").trim();
}

// A small per-form icon. Unknown types fall back to a generic block icon — purely
// decorative (the badge already names the form), so a missing mapping never matters.
function FormIcon({ contentType }: { contentType: string }) {
  const size = 15;
  switch (contentType) {
    case "markmap":
      return <Network size={size} />;
    case "mermaid":
      return <GitBranch size={size} />;
    case "code-snippet":
      return <Code2 size={size} />;
    case "markdown":
    case "plain-text":
      return <FileText size={size} />;
    default:
      return <Boxes size={size} />;
  }
}

// Whether a plugin offers a richer card body. We try its "card" render; if it returns
// nothing we fall back to the generic snippet. (A plugin that ignores `mode` returns
// its normal node, which is fine as a thumbnail — but the heavy diagram plugins
// explicitly render a LIGHT preview for "card", so the thread never mounts live SVG.)
function cardBody(block: FocusOverlayBlock): ReactNode {
  const plugin = getNoteType(block.contentType);
  if (plugin) {
    const node = plugin.render({ content: block.content, note: block.note, mode: "card" });
    if (node) return node;
  }
  return null;
}

export function ArtifactCard({ block }: { block: FocusOverlayBlock }) {
  const [open, setOpen] = useState(false);
  const title = block.title ?? (snippetOf(block.content).slice(0, 80) || block.contentType);
  const body = cardBody(block);

  return (
    <>
      <button
        type="button"
        className={`sv-artifact-card sv-artifact-card-${block.contentType}`}
        aria-haspopup="dialog"
        title={`Open ${block.contentType} (interactive)`}
        onClick={() => setOpen(true)}
      >
        <span className="sv-artifact-head">
          <span className="sv-artifact-icon" aria-hidden="true">
            <FormIcon contentType={block.contentType} />
          </span>
          <span className="sv-artifact-title">{title}</span>
          <span className="sv-artifact-badge">{block.contentType}</span>
        </span>
        {body ? <span className="sv-artifact-thumb">{body}</span> : null}
      </button>
      {open ? <FocusOverlay block={block} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
