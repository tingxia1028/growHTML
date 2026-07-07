// TopBar (R1) — the full-width chrome bar above the dock. Three segments:
//   • Left: anchor logo + "Growte" wordmark (the brand moved here from LibraryView).
//   • Center: a 2-way segmented control — Notes Overlay / Anchor Focus.
//       - Notes Overlay → the opened document reader with note overlay/gutter cards.
//       - Anchor Focus  → the same document column swaps to the Anchor Focus board
//         (document-order rows / stage-layer columns). Presentation mode is untouched.
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
// The Anchor Focus tab switches the center document slot to a real anchors+notes board.
// The store stays outside WorkspaceContext because this is transient view chrome.
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

  // Two tabs, one document slot: Notes Overlay shows the reader, Anchor Focus swaps the
  // same slot to the board. The active tab follows the shared open-state.
  const boardOpen = useAnchorBoardOpen();
  const notesOverlayActive = !boardOpen;
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
          aria-selected={notesOverlayActive}
          className={`topbar-tab${notesOverlayActive ? " active" : ""}`}
          onClick={() => {
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
