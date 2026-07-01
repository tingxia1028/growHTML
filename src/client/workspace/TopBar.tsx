// TopBar (R1) — the full-width chrome bar above the dock. Three segments:
//   • Left: anchor logo + "Growte" wordmark (the brand moved here from LibraryView).
//   • Center: a 3-way segmented control — Document / Notes Overlay / Anchor Focus —
//     wired to the EXISTING WorkspaceContext state (annotationMode + focus.anchor), so
//     this is the primary annotation-mode control (the old reader-header toggle is gone).
//       - Document      → annotationMode "floating" (normal inline reading).
//       - Notes Overlay → annotationMode "margin"   (the gutter / margin cards).
//       - Anchor Focus  → highlights the currently-focused anchor (re-reveals it); shows
//         a count badge of 1 when an anchor is focused (the only focus state that exists).
//   • Right: native desktop window controls only.

import { useState } from "react";
import {
  Anchor,
  Crosshair,
  FileText,
  Minus,
  PanelRight,
  Square,
  X
} from "lucide-react";
import type { WorkspaceContext } from "./viewRegistry";

export type TopBarProps = {
  ctx: WorkspaceContext;
};

export function TopBar({ ctx }: TopBarProps) {
  const {
    annotationMode,
    setAnnotationMode,
    focus
  } = ctx;

  // The three tabs map onto TWO existing states: annotationMode ("floating"|"margin") for
  // Document/Notes-Overlay, and an EXPLICIT "Anchor Focus" selection within floating mode
  // (a transient choice, not derived from focus.anchor — having a focused anchor is the
  // normal reading state, so it must NOT silently flip the active tab). Notes-Overlay
  // (margin) always wins when set; otherwise the last-chosen floating tab is active.
  const [floatingTab, setFloatingTab] = useState<"document" | "anchor">("document");
  const overlayActive = annotationMode === "margin";
  const documentActive = !overlayActive && floatingTab === "document";
  const focusActive = !overlayActive && floatingTab === "anchor";

  const windowControls = typeof window !== "undefined" ? window.studyVault?.windowControls : undefined;

  return (
    <header className={`topbar${windowControls ? " topbar-desktop-window" : ""}`}>
      <div className="topbar-left">
        <span className="topbar-logo" aria-hidden="true">
          <Anchor size={28} strokeWidth={2.1} />
        </span>
        <span className="topbar-wordmark">Growte</span>
      </div>

      <div className="topbar-center" role="tablist" aria-label="Reading mode">
        <button
          type="button"
          role="tab"
          aria-selected={documentActive}
          className={`topbar-tab${documentActive ? " active" : ""}`}
          onClick={() => {
            setFloatingTab("document");
            setAnnotationMode("floating");
          }}
        >
          <FileText size={15} aria-hidden="true" />
          Document
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={overlayActive}
          className={`topbar-tab${overlayActive ? " active" : ""}`}
          onClick={() => setAnnotationMode("margin")}
        >
          <PanelRight size={15} aria-hidden="true" />
          Notes Overlay
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={focusActive}
          className={`topbar-tab${focusActive ? " active" : ""}`}
          title="Focus the current anchor"
          onClick={() => {
            // Anchor Focus = floating reading centered on the focused anchor. Switch to
            // floating, mark this tab chosen, and re-reveal the focused anchor (bumps
            // revealSeq → the reader scrolls the passage into view).
            setFloatingTab("anchor");
            setAnnotationMode("floating");
            if (focus.anchor) focus.setAnchor(focus.anchor);
          }}
        >
          <Crosshair size={15} aria-hidden="true" />
          Anchor Focus
        </button>
      </div>

      {windowControls ? (
        <div className="topbar-window-controls" aria-label="Window controls">
          <button
            type="button"
            className="window-control-btn"
            aria-label="Minimize window"
            title="Minimize"
            onClick={() => windowControls.minimize()}
          >
            <Minus size={14} strokeWidth={1.9} />
          </button>
          <button
            type="button"
            className="window-control-btn"
            aria-label="Maximize or restore window"
            title="Maximize / Restore"
            onClick={() => windowControls.toggleMaximize()}
          >
            <Square size={12} strokeWidth={1.9} />
          </button>
          <button
            type="button"
            className="window-control-btn window-control-close"
            aria-label="Close window"
            title="Close"
            onClick={() => windowControls.close()}
          >
            <X size={14} strokeWidth={1.9} />
          </button>
        </div>
      ) : null}
    </header>
  );
}
