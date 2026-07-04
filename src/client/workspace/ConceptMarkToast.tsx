// ConceptMarkToast (CONCEPT-UX-1) — the brief feedback for 标为概念: after
// concept.mark-selection runs, the workspace parks a ConceptMarkFeedback and this
// host-level chrome (mounted once in WorkspaceShell, like SelectionFloatingToolbar)
// shows "已标为概念 <name>" with a 撤销 affordance. Undo is CHEAP by design: it
// deletes the just-created marker note — the anchor↔concept link — via the context's
// undoConceptMark (the concept record itself stays; there is no concept-delete API).
// Auto-dismisses after a few seconds; a new mark re-arms the timer (feedback.seq).

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Undo2, X } from "lucide-react";
import { useWorkspace } from "./WorkspaceContext";
import { conceptMessages } from "./conceptMessages";
import { t } from "../i18n";
import "./conceptUx.css";

const AUTO_DISMISS_MS = 6000;

export function ConceptMarkToast() {
  const { conceptMark, undoConceptMark, dismissConceptMark } = useWorkspace();
  const seq = conceptMark?.seq ?? null;

  // Auto-dismiss, re-armed whenever a NEW mark lands (seq bumps).
  useEffect(() => {
    if (seq === null) return;
    const timer = window.setTimeout(dismissConceptMark, AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [seq, dismissConceptMark]);

  if (!conceptMark || typeof document === "undefined") return null;

  return createPortal(
    <div className="concept-mark-toast" role="status">
      <span className="concept-mark-toast-text">
        {t(conceptMark.linkedExisting ? conceptMessages.toastLinkedExisting : conceptMessages.toastMarked)}
        <strong className="concept-mark-toast-name">{conceptMark.conceptName}</strong>
      </span>
      <button
        type="button"
        className="concept-mark-undo"
        onClick={() => void undoConceptMark()}
      >
        <Undo2 size={13} />
        {t(conceptMessages.undo)}
      </button>
      <button
        type="button"
        className="concept-mark-dismiss"
        aria-label={t(conceptMessages.dismiss)}
        title={t(conceptMessages.dismiss)}
        onClick={dismissConceptMark}
      >
        <X size={13} />
      </button>
    </div>,
    document.body
  );
}
