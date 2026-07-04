// TopBar (R1) — the full-width chrome bar above the dock. Three segments:
//   • Left: anchor logo + "Growte" wordmark (the brand moved here from LibraryView).
//   • Center: a 2-way segmented control — Notes Overlay / Anchor Focus. The overlay IS
//     the document (user decision 2026-07-04): the old "Document" tab (annotationMode
//     "floating", a notes-less reading mode) is gone; annotationMode stays "margin".
//       - Notes Overlay → the default reading surface (gutter / margin cards).
//       - Anchor Focus  → re-reveals the currently-focused anchor (scrolls the passage
//         into view) without changing the presentation mode.
//   • Right: native desktop window controls only.

import { useState } from "react";
import {
  Anchor,
  Crosshair,
  Minus,
  PanelRight,
  Square,
  X
} from "lucide-react";
import { defineMessages, t, useLocale } from "../i18n";
import type { WorkspaceContext } from "./viewRegistry";

export type TopBarProps = {
  ctx: WorkspaceContext;
};

const topBarMessages = defineMessages({
  readingMode: { zh: "阅读模式", en: "Reading mode" },
  notesOverlay: { zh: "笔记叠层", en: "Notes Overlay" },
  anchorFocus: { zh: "锚点聚焦", en: "Anchor Focus" },
  anchorFocusTitle: { zh: "聚焦当前锚点", en: "Focus the current anchor" },
  windowControls: { zh: "窗口控制", en: "Window controls" },
  minimizeWindow: { zh: "最小化窗口", en: "Minimize window" },
  minimize: { zh: "最小化", en: "Minimize" },
  maximizeWindow: { zh: "最大化或还原窗口", en: "Maximize or restore window" },
  maximizeRestore: { zh: "最大化 / 还原", en: "Maximize / Restore" },
  closeWindow: { zh: "关闭窗口", en: "Close window" },
  close: { zh: "关闭", en: "Close" }
});

export function TopBar({ ctx }: TopBarProps) {
  useLocale();
  const {
    setAnnotationMode,
    focus
  } = ctx;

  // Two tabs, one presentation mode: the overlay (annotationMode "margin") is the
  // document. Anchor Focus is a transient selection (an explicit click, not derived
  // from focus.anchor — having a focused anchor is the normal reading state, so it
  // must NOT silently flip the active tab) that re-reveals the focused passage.
  const [tab, setTab] = useState<"overlay" | "anchor">("overlay");
  const overlayActive = tab === "overlay";
  const focusActive = tab === "anchor";

  const windowControls = typeof window !== "undefined" ? window.studyVault?.windowControls : undefined;

  return (
    <header className={`topbar${windowControls ? " topbar-desktop-window" : ""}`}>
      <div className="topbar-left">
        <span className="topbar-logo" aria-hidden="true">
          <Anchor size={28} strokeWidth={2.1} />
        </span>
        <span className="topbar-wordmark">Growte</span>
      </div>

      <div className="topbar-center" role="tablist" aria-label={t(topBarMessages.readingMode)}>
        <button
          type="button"
          role="tab"
          aria-selected={overlayActive}
          className={`topbar-tab${overlayActive ? " active" : ""}`}
          onClick={() => {
            setTab("overlay");
            // The overlay is the document; keep the presentation mode pinned to margin
            // (self-heals any stale "floating" state left by the removed Document tab).
            setAnnotationMode("margin");
          }}
        >
          <PanelRight size={15} aria-hidden="true" />
          {t(topBarMessages.notesOverlay)}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={focusActive}
          className={`topbar-tab${focusActive ? " active" : ""}`}
          title={t(topBarMessages.anchorFocusTitle)}
          onClick={() => {
            // Re-reveal the focused anchor (bumps revealSeq → the reader scrolls the
            // passage into view). Presentation mode is untouched — overlay stays on.
            setTab("anchor");
            if (focus.anchor) focus.setAnchor(focus.anchor);
          }}
        >
          <Crosshair size={15} aria-hidden="true" />
          {t(topBarMessages.anchorFocus)}
        </button>
      </div>

      {windowControls ? (
        <div className="topbar-window-controls" aria-label={t(topBarMessages.windowControls)}>
          <button
            type="button"
            className="window-control-btn"
            aria-label={t(topBarMessages.minimizeWindow)}
            title={t(topBarMessages.minimize)}
            onClick={() => windowControls.minimize()}
          >
            <Minus size={14} strokeWidth={1.9} />
          </button>
          <button
            type="button"
            className="window-control-btn"
            aria-label={t(topBarMessages.maximizeWindow)}
            title={t(topBarMessages.maximizeRestore)}
            onClick={() => windowControls.toggleMaximize()}
          >
            <Square size={12} strokeWidth={1.9} />
          </button>
          <button
            type="button"
            className="window-control-btn window-control-close"
            aria-label={t(topBarMessages.closeWindow)}
            title={t(topBarMessages.close)}
            onClick={() => windowControls.close()}
          >
            <X size={14} strokeWidth={1.9} />
          </button>
        </div>
      ) : null}
    </header>
  );
}
