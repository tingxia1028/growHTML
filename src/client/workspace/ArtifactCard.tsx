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
import { noteCardMeta } from "../notes/noteCardMeta";
import { useWorkspaceOptional } from "./WorkspaceContext";
import type { PluginPrefs } from "../data/entityClient";
import { resolveViewer, getViewer, NOTETYPE_SENTINEL } from "../notes/viewerRegistry";
// Side-effect import: ensures the built-in Table viewer is registered at APP runtime.
// The shared PreviewCard is the one path every surface funnels through, so importing it
// here guarantees the exclusive viewer registry is populated wherever a card renders
// (not dependent on the retired dead NoteContentView / views.tsx side-effect).
import "../notes/tableViewer";

// A plain-text snippet from any content shape (string passes through; an object is
// JSON-stringified) — the generic card's title fallback, never raw HTML.
function snippetOf(content: unknown): string {
  const text = typeof content === "string" ? content : JSON.stringify(content ?? {});
  return text.replace(/\s+/g, " ").trim();
}

// The card body (light preview). The EXCLUSIVE viewer resolver decides the display layer
// first (plugin-viewer-model §4): resolveViewer picks a winner by match()/priority/user
// association — data-driven, NEVER a `contentType ===` branch. When a real viewer wins we
// render its light "card" node; otherwise the resolver returns the "notetype" sentinel and
// we FALL THROUGH to getNoteType().render UNCHANGED (the adaptive-note contract, and the
// byte-for-byte-identical path when no viewer matches). `prefs` (from the workspace
// context, absent in standalone/tests) supplies any user viewer pin; without it the
// resolver still auto-picks by match(), so a card renders WITHOUT a provider.
//
// A plugin that ignores `mode` still returns a usable node; the heavy diagram/html
// plugins explicitly return a LIGHT preview for "card" so the thread never mounts a live
// diagram/iframe. Null → the wrapper alone.
function cardBody(block: FocusOverlayBlock, prefs?: PluginPrefs): ReactNode {
  const renderCtx = block.openLocalFile ? { openLocalFile: block.openLocalFile } : undefined;
  const resolved = resolveViewer(
    { content: block.content, note: block.note, contentType: block.contentType },
    prefs
  );
  if (resolved.viewerId !== NOTETYPE_SENTINEL) {
    const viewer = getViewer(resolved.viewerId);
    if (viewer) {
      const node = viewer.render({ content: block.content, note: block.note, mode: "card" });
      if (node) return node;
    }
  }
  const plugin = getNoteType(block.contentType);
  if (plugin) {
    const node = plugin.render({ content: block.content, note: block.note, mode: "card", ctx: renderCtx });
    if (node) return node;
  }
  return null;
}

// The footer meta line "P<page> · <extra> · <layer>" — only the parts we actually have.
function FooterMeta({ block }: { block: FocusOverlayBlock }) {
  const parts: string[] = [];
  if (block.page != null) parts.push(`P${block.page}`);
  if (block.extra) parts.push(block.extra);
  if (block.layer || block.note) parts.push(block.layer ?? "My Notes");
  if (parts.length === 0) return null;
  return <span className="sv-card-footer">{parts.join(" · ")}</span>;
}

function CardFooterMeta({ block }: { block: FocusOverlayBlock }) {
  const parts: string[] = [];
  if (block.page != null) parts.push(`P${block.page}`);
  if (block.extra) parts.push(block.extra);
  if (block.layer || block.note) parts.push(block.layer ?? "My Notes");
  if (parts.length === 0) return null;
  return (
    <span className="sv-card-footer">
      {parts.map((part) => (
        <span className="sv-card-footer-part" key={part}>
          {part}
        </span>
      ))}
    </span>
  );
}

export function ArtifactCard({ block }: { block: FocusOverlayBlock }) {
  const [open, setOpen] = useState(false);
  // Null-safe context read: outside a provider (standalone/tests) `ws` is null and the
  // resolver gets undefined prefs (still auto-picks by match()/priority — no crash).
  const ws = useWorkspaceOptional();
  const meta = noteCardMeta(block.contentType, block.content);
  const title = block.title ?? meta.title ?? (snippetOf(block.content).slice(0, 80) || block.contentType);
  const displayBlock = {
    ...block,
    title,
    extra: block.extra ?? meta.extra,
    openLocalFile: block.openLocalFile ?? ws?.openLocalFile
  };
  const body = cardBody(displayBlock, ws?.pluginPrefs);
  const Icon = noteTypeIcon(block.contentType);
  // D6: a DRAFT note (auto-materialized from an anchor-context AI answer) gets a
  // distinguishing wrapper marker. This is a WRAPPER FLAG — the body still comes through
  // cardBody → getNoteType().render UNCHANGED; `status` never branches the render path.
  const isDraft = block.note?.status === "draft";

  return (
    <>
      <div
        className={`sv-artifact-card sv-preview-card sv-artifact-card-${block.contentType}${isDraft ? " sv-note-draft" : ""}`}
        data-note-status={block.note?.status}
        role="button"
        tabIndex={0}
        aria-haspopup="dialog"
        data-content-type={block.contentType}
        title={`Open ${title}`}
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
          <span className="sv-artifact-badge sv-card-type">{meta.typeLabel}</span>
          <span className="sv-card-more" aria-hidden="true">
            <MoreHorizontal size={15} />
          </span>
        </span>
        <span className="sv-card-title sv-artifact-title">{title}</span>
        {body ? <span className="sv-artifact-thumb sv-card-body">{body}</span> : null}
        <CardFooterMeta block={displayBlock} />
      </div>
      {open ? <FocusOverlay block={displayBlock} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
