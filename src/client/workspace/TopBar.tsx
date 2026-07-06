// TopBar (R1) — the full-width chrome bar above the dock. Three segments:
//   • Left: anchor logo + "Growte" wordmark (the brand moved here from LibraryView).
//   • Center: a 2-way segmented control — Notes Overlay / Anchor Focus. The overlay IS
//     the document (user decision 2026-07-04): the old "Document" tab (annotationMode
//     "floating", a notes-less reading mode) is gone; annotationMode stays "margin".
//       - Notes Overlay → the default reading surface (gutter / margin cards).
//       - Anchor Focus  → opens the Anchor Focus BOARD (N6/§D12): a full anchors+notes
//         surface (document-order rows / stage-layer columns), replacing the old weak
//         one-anchor reveal. Presentation mode is untouched.
//   • Right: native desktop window controls only.

import {
  Anchor,
  Crosshair,
  Minus,
  PanelRight,
  Square,
  X
} from "lucide-react";
import { defineMessages, t, useLocale } from "../i18n";
import { getPlatformOptional } from "../platform/platformSingleton";
import type { WorkspaceContext } from "./viewRegistry";
// N6/§D12: the "Anchor Focus" tab now opens the Anchor Focus BOARD (a real anchors+notes
// surface), replacing the weak one-anchor reveal. The board mounts in the shell overlay;
// this store is the open-state seam both share (keeps WorkspaceContext untouched).
import { useAnchorBoardOpen, setAnchorBoardOpen } from "./anchorFocusBoardStore";

export type TopBarProps = {
  ctx: WorkspaceContext;
};

const topBarMessages = defineMessages({
  readingMode: { zh: "阅读模式", en: "Reading mode" },
  notesOverlay: { zh: "笔记叠层", en: "Notes Overlay" },
  anchorFocus: { zh: "锚点聚焦", en: "Anchor Focus" },
  anchorFocusTitle: { zh: "打开锚点聚焦看板", en: "Open the Anchor Focus board" },
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
  const { setAnnotationMode } = ctx;

  // Two tabs, one presentation mode: the overlay (annotationMode "margin") is the
  // document. Anchor Focus now OPENS THE BOARD (§D12) — a full anchors+notes surface,
  // not the old one-anchor reveal. The active tab follows the board's open-state (shared
  // store), so opening/closing the board flips the segmented control without local state.
  const boardOpen = useAnchorBoardOpen();
  const overlayActive = !boardOpen;
  const focusActive = boardOpen;

  // Custom window chrome: present only in the desktop shell (capabilities.windowChrome).
  // The object itself carries the minimize/toggleMaximize/close methods, so read it via
  // the native slot with the same window.studyVault fallback the old code used.
  const windowControls =
    getPlatformOptional()?.native?.windowControls ??
    (typeof window !== "undefined" ? window.studyVault?.windowControls : undefined);

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
            // The overlay is the document; close the board and keep the presentation mode
            // pinned to margin (self-heals any stale "floating" state).
            setAnchorBoardOpen(false);
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
            // Open the Anchor Focus board (§D12) — the anchors+notes surface. Presentation
            // mode is untouched; the shell-mounted board reads the shared open-state.
            setAnchorBoardOpen(true);
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
