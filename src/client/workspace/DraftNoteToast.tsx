// DraftNoteToast (D6, note-presentation-unified.md §6) — the brief feedback for an
// AUTO-MATERIALIZED anchor-context AI note. When an AI answer arrives WITH a focused
// anchor at generation time, the workspace materializes it as a note with status:"draft"
// (it exists + paints its D2 chip at the passage immediately) and parks a
// DraftNoteFeedback. This host-level chrome (mounted once in WorkspaceShell, exactly like
// ConceptMarkToast / SelectionFloatingToolbar) shows "已生成笔记 · 撤销" whose 撤销
// dispatches note.delete on the materialized note — the safety net for a note the user
// never explicitly saved. Auto-dismisses after a few seconds; a new materialization
// re-arms the timer (feedback.seq). It is NOT a render path — it only shows a chip +
// undo; the draft note itself still renders solely through getNoteType().render.

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Undo2, X } from "lucide-react";
import { useWorkspace } from "./WorkspaceContext";
import { draftNoteMessages } from "./draftNoteMessages";
import { getNoteType } from "../notes/noteTypeRegistry";
import { t, resolveText } from "../i18n";
import "./draftNote.css";

const AUTO_DISMISS_MS = 6000;

export function DraftNoteToast() {
  const { draftNote, undoDraftNote, dismissDraftNote } = useWorkspace();
  const seq = draftNote?.seq ?? null;

  // Auto-dismiss, re-armed whenever a NEW materialization lands (seq bumps).
  useEffect(() => {
    if (seq === null) return;
    const timer = window.setTimeout(dismissDraftNote, AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [seq, dismissDraftNote]);

  if (!draftNote || typeof document === "undefined") return null;

  // The type label is a courtesy tag (defaults to the raw contentType) — sourced from
  // the SAME plugin registry the render path uses, never a bespoke label table.
  const plugin = getNoteType(draftNote.contentType);
  const typeLabel = plugin?.label ? resolveText(plugin.label) : draftNote.contentType;

  return createPortal(
    <div className="draft-note-toast" role="status">
      <span className="draft-note-toast-badge">{t(draftNoteMessages.draftBadge)}</span>
      <span className="draft-note-toast-text">
        {t(draftNoteMessages.toastMaterialized)}
        <span className="draft-note-toast-type">{typeLabel}</span>
      </span>
      <button type="button" className="draft-note-undo" onClick={() => void undoDraftNote()}>
        <Undo2 size={13} />
        {t(draftNoteMessages.undo)}
      </button>
      <button
        type="button"
        className="draft-note-dismiss"
        aria-label={t(draftNoteMessages.dismiss)}
        title={t(draftNoteMessages.dismiss)}
        onClick={dismissDraftNote}
      >
        <X size={13} />
      </button>
    </div>,
    document.body
  );
}
