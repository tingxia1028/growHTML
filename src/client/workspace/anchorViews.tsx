// anchor.excerpt — the top section of the redesigned RIGHT column (spec §0 RIGHT.1 + the
// "整体 IA 重建" Anchor section). It reads the shared focus (focus.anchor, else focus.draft's
// quote) plus the source's notes/anchors — no new state. Three stacked blocks:
//   • Context — source filename (file icon) + Page N (Section …) + an "Anchor at …" row.
//   • Excerpt — the focused passage in an amber highlight box (+ formula if present).
//   • Linked notes — a row of note-type icons for the notes attached to this anchor.
// When nothing is focused it shows the existing "Select a passage…" empty state.

import { Anchor, Crosshair, FileText } from "lucide-react";
import { registerView, type WorkspaceContext } from "./viewRegistry";
import { draftQuoteText } from "../focus/FocusContext";
import { PanelMenu } from "./PanelMenu";
import { noteTypeIcon } from "../notes/noteTypeIcon";
import { getNoteType } from "../notes/noteTypeRegistry";

function AnchorExcerptView({ ctx }: { ctx: WorkspaceContext }) {
  const { focus, activeSource, visibleNotes } = ctx;
  const anchor = focus.anchor;
  const quote = anchor?.quote ?? draftQuoteText(focus.draft);
  const page =
    (anchor && "page" in anchor ? anchor.page : undefined) ??
    (focus.draft && "page" in focus.draft ? focus.draft.page : undefined);
  // A focused anchor's contextAfter/Before can hint a "section"; we only show what exists.
  const section =
    anchor && "contextAfter" in anchor && typeof anchor.contextAfter === "string"
      ? anchor.contextAfter.trim().split(/\s+/).slice(0, 4).join(" ")
      : undefined;
  // Optional formula (textbook anchors may carry one); shown under the excerpt if present.
  const formula = anchor && "formula" in anchor ? (anchor as { formula?: string }).formula : undefined;

  // Notes attached to the currently focused anchor → the "Linked notes" icon row.
  const linkedNotes = anchor ? visibleNotes.filter((note) => note.anchorIds.includes(anchor.id)) : [];

  return (
    <aside className="anchor-panel">
      <div className="panel-title anchor-panel-title">
        <Anchor size={16} />
        Anchor
        <PanelMenu label="Anchor actions" align="right">
          <button
            className="panel-menu-item"
            type="button"
            disabled={!anchor && !focus.draft}
            onClick={() => focus.clear()}
          >
            Clear anchor
          </button>
        </PanelMenu>
      </div>

      {quote ? (
        <>
          {/* —— Context —— */}
          <div className="anchor-context">
            <div className="anchor-context-source">
              <FileText size={14} />
              <span className="anchor-context-name" title={activeSource?.title}>
                {activeSource?.title ?? "Current source"}
              </span>
              <button
                className="anchor-context-jump"
                type="button"
                title="Reveal this anchor in the reader"
                aria-label="Reveal this anchor in the reader"
                disabled={!anchor}
                onClick={() => anchor && focus.setAnchor(anchor)}
              >
                <Crosshair size={14} />
              </button>
            </div>
            {page != null ? (
              <div className="anchor-context-meta">
                Page {page}
                {section ? ` (${section}…)` : ""}
              </div>
            ) : null}
          </div>

          {/* —— Excerpt —— amber highlight box */}
          <div className="anchor-excerpt-card">
            <p className="anchor-excerpt-quote">{quote}</p>
            {formula ? <p className="anchor-excerpt-formula">{formula}</p> : null}
          </div>

          {/* —— Linked notes (visible layers) —— */}
          <div className="anchor-linked">
            <span className="anchor-linked-label">Linked notes</span>
            {linkedNotes.length ? (
              <div className="anchor-linked-icons">
                {linkedNotes.map((note) => {
                  const contentType = note.contentType ?? "markdown";
                  const Icon = noteTypeIcon(contentType);
                  const label = getNoteType(contentType)?.label ?? contentType;
                  return (
                    <button
                      key={note.id}
                      className="anchor-linked-icon"
                      type="button"
                      title={label}
                      aria-label={label}
                      // Best-effort: re-focus this anchor so the reader scrolls to it.
                      onClick={() => anchor && focus.setAnchor(anchor)}
                    >
                      <Icon size={15} />
                    </button>
                  );
                })}
              </div>
            ) : (
              <span className="anchor-linked-empty">None yet</span>
            )}
          </div>
        </>
      ) : (
        <p className="anchor-excerpt-empty">Select a passage to focus an anchor.</p>
      )}
    </aside>
  );
}

registerView({ kind: "anchor.excerpt", render: (_node, ctx) => <AnchorExcerptView ctx={ctx} /> });
