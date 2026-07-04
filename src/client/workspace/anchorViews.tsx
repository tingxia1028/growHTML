// anchor.excerpt — the top section of the redesigned RIGHT column (spec §0 RIGHT.1 + the
// "整体 IA 重建" Anchor section). It reads the shared focus (focus.anchor, else focus.draft's
// quote) plus the source's notes/anchors — no new state. Three stacked blocks:
//   • Context — source filename (file icon) + Page N (Section …) + an "Anchor at …" row.
//   • Excerpt — the focused passage in a blue highlight box (+ formula if present).
//   • Linked notes — a row of note-type icons for the notes attached to this anchor.
// When nothing is focused it shows the existing "Select a passage…" empty state.

import { useState } from "react";
import { Anchor as AnchorIcon, Crosshair, FileText } from "lucide-react";
import { registerView, type WorkspaceContext } from "./viewRegistry";
import { draftQuoteText } from "../focus/FocusContext";
import { noteTypeIcon } from "../notes/noteTypeIcon";
import { getNoteType } from "../notes/noteTypeRegistry";
import { ActionGrid } from "./ActionGrid";
import { SpeakButton } from "../speech/SpeakButton";
import { persistAnchorGlyphVisibility, readStoredAnchorGlyphVisibility } from "../annotations";
import { setAnchorGlyphVisibility } from "../markerOverlay";
import { defineMessages, resolveText, t, useLocale } from "../i18n";
import "./anchorViews.css";

const anchorViewMessages = defineMessages({
  actions: { zh: "锚点操作", en: "Anchor actions" },
  clearAnchor: { zh: "清除锚点", en: "Clear anchor" },
  showAnchorMarkers: { zh: "显示锚点标记", en: "Show anchor markers" },
  currentSource: { zh: "当前资料", en: "Current source" },
  revealAnchor: { zh: "在阅读器中显示此锚点", en: "Reveal this anchor in the reader" },
  page: { zh: "第", en: "Page" },
  pageSuffix: { zh: "页", en: "" },
  linkedNotes: { zh: "关联笔记", en: "Linked notes" },
  noneYet: { zh: "暂无", en: "None yet" },
  showNoteInNotes: { zh: "在笔记中显示", en: "Show in Notes" },
  empty: { zh: "选择一段文本来聚焦锚点。", en: "Select a passage to focus an anchor." }
});

// 显示锚点标记 — the GLOBAL anchor-glyph switch (D2 amendment, 2026-07-04). Off hides
// every anchor glyph chip across all readers (note-slot chips stay); persisted via
// the annotations.ts localStorage helper (the annotation-mode idiom) and pushed
// live through the markerOverlay module store (host realms repaint immediately;
// webview guests receive it over the sv:anchors payload).
function AnchorGlyphSwitch() {
  useLocale();
  const [visible, setVisible] = useState(() => readStoredAnchorGlyphVisibility());
  const toggle = () => {
    const next = !visible;
    setVisible(next);
    persistAnchorGlyphVisibility(next);
    setAnchorGlyphVisibility(next);
  };
  const label = t(anchorViewMessages.showAnchorMarkers);
  return (
    <button
      type="button"
      className={`anchor-glyph-switch${visible ? " active" : ""}`}
      title={label}
      aria-label={label}
      aria-pressed={visible}
      onClick={toggle}
    >
      <AnchorIcon size={15} aria-hidden="true" />
    </button>
  );
}

function AnchorExcerptView({ ctx }: { ctx: WorkspaceContext }) {
  useLocale();
  const { focus, activeSource, visibleNotes, anchorBarActions, runAction, generating } = ctx;
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

  const focusLinkedNote = (noteId: string) => {
    if (!anchor) return;
    focus.setAnchor(anchor);
    focus.setFocus({ type: "note", noteId });
  };

  return (
    <aside className="anchor-panel">
      {quote ? (
        <>
          {/* —— Context —— */}
          <div className="anchor-context">
            <div className="anchor-context-source">
              <FileText size={14} />
              <span className="anchor-context-name" title={activeSource?.title}>
                {activeSource?.title ?? t(anchorViewMessages.currentSource)}
              </span>
              <span className="anchor-context-actions">
                <AnchorGlyphSwitch />
                <button
                  className="anchor-context-jump"
                  type="button"
                  title={t(anchorViewMessages.revealAnchor)}
                  aria-label={t(anchorViewMessages.revealAnchor)}
                  disabled={!anchor}
                  onClick={() => anchor && focus.setAnchor(anchor)}
                >
                  <Crosshair size={14} />
                </button>
              </span>
            </div>
            {page != null ? (
              <div className="anchor-context-meta">
                {t(anchorViewMessages.page)} {page}
                {t(anchorViewMessages.pageSuffix)}
                {section ? ` (${section}…)` : ""}
              </div>
            ) : null}
          </div>

          {/* —— Excerpt —— blue highlight box */}
          <div className="anchor-excerpt-card">
            <p className="anchor-excerpt-quote">{quote}</p>
            {formula ? <p className="anchor-excerpt-formula">{formula}</p> : null}
          </div>

          {/* —— Action Bar (R6.1) —— the anchor-scope action grid. Icon-only triggers
              (built-in kit actions + custom ops); each only FIRES runAction — results
              flow through the existing GenerationPreview / note render, not here. */}
          <div className="anchor-action-bar">
            {/* 朗读 (SPEECH-1): read the focused passage aloud (低年级 users may not
                recognize every character). Stateful trigger (朗读 ↔ 停止), so it sits
                beside the dispatched-action grid instead of inside it. */}
            <SpeakButton text={quote} />
            <ActionGrid
              items={anchorBarActions}
              onRun={runAction}
              disabled={!anchor && !focus.draft}
              busy={generating}
              density="grid"
            />
          </div>

          {/* —— Linked notes (visible layers) —— note-type icons focus the Notes viewer
              and re-reveal the source anchor; no inline popover here. */}
          <div className="anchor-linked">
            <span className="anchor-linked-label">{t(anchorViewMessages.linkedNotes)}</span>
            {linkedNotes.length ? (
              <div className="anchor-linked-icons">
                {linkedNotes.map((note) => {
                  const contentType = note.contentType ?? "markdown";
                  const Icon = noteTypeIcon(contentType);
                  const noteType = getNoteType(contentType);
                  const label = noteType?.label ? resolveText(noteType.label) : contentType;
                  const active = focus.focus?.type === "note" && focus.focus.noteId === note.id;
                  const buttonLabel = `${t(anchorViewMessages.showNoteInNotes)}: ${label}`;
                  return (
                    <button
                      key={note.id}
                      className={`anchor-linked-icon${active ? " active" : ""}`}
                      type="button"
                      title={buttonLabel}
                      aria-label={buttonLabel}
                      aria-pressed={active}
                      onClick={() => focusLinkedNote(note.id)}
                    >
                      <Icon size={15} />
                    </button>
                  );
                })}
              </div>
            ) : (
              <span className="anchor-linked-empty">{t(anchorViewMessages.noneYet)}</span>
            )}
          </div>
        </>
      ) : (
        <>
          {/* N1a law: the 显示锚点标记 switch renders in BOTH states — hiding glyphs is a
              document-level preference, not a focused-anchor affordance. With no focused
              context row to host it, the empty state keeps a minimal toolbar. */}
          <div className="anchor-panel-toolbar">
            <span className="anchor-panel-toolbar-spacer" />
            <AnchorGlyphSwitch />
          </div>
          <p className="anchor-excerpt-empty">{t(anchorViewMessages.empty)}</p>
          {/* The Action Bar still shows in the empty state, but disabled — so the user
              sees what's available before focusing a passage. */}
          <div className="anchor-action-bar">
            {/* Same 朗读 slot, disabled (no text) — the capability stays discoverable. */}
            <SpeakButton text="" />
            <ActionGrid items={anchorBarActions} onRun={runAction} disabled busy={generating} density="grid" />
          </div>
        </>
      )}
    </aside>
  );
}

registerView({ kind: "anchor.excerpt", render: (_node, ctx) => <AnchorExcerptView ctx={ctx} /> });
