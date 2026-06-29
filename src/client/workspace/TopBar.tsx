// TopBar (R1) — the full-width chrome bar above the dock. Three segments:
//   • Left: anchor logo + "Growte" wordmark (the brand moved here from LibraryView).
//   • Center: a 3-way segmented control — Document / Notes Overlay / Anchor Focus —
//     wired to the EXISTING WorkspaceContext state (annotationMode + focus.anchor), so
//     this is the primary annotation-mode control (the old reader-header toggle is gone).
//       - Document      → annotationMode "floating" (normal inline reading).
//       - Notes Overlay → annotationMode "margin"   (the gutter / margin cards).
//       - Anchor Focus  → highlights the currently-focused anchor (re-reveals it); shows
//         a count badge of 1 when an anchor is focused (the only focus state that exists).
//   • Right: an "Anchor layer" opacity placeholder (no such state exists yet → disabled,
//     per spec: don't invent persistence) + icon buttons that open existing panes in the
//     left rail slot (Layers / Concepts / Reader-focus) + a Settings gear menu that hosts
//     the theme + layout switchers relocated from the old reader-header.
//
// The icon buttons + gear DO NOT own new state: they call back into WorkspaceShell to set
// the left-pane kind (rail selection) and read/write the context's theme/layout setters.

import { useEffect, useRef, useState } from "react";
import {
  Anchor,
  BookOpen,
  Crosshair,
  FileText,
  Layers,
  Network,
  PanelRight,
  Settings
} from "lucide-react";
import type { WorkspaceContext } from "./viewRegistry";

export type TopBarProps = {
  ctx: WorkspaceContext;
  /** The view-kind currently shown in the left rail slot (icon-rail selection). */
  leftPaneKind: string;
  /** Show a pane kind in the left rail slot (used by the right-side icon buttons). */
  onSelectPane(kind: string): void;
};

export function TopBar({ ctx, leftPaneKind, onSelectPane }: TopBarProps) {
  const {
    annotationMode,
    setAnnotationMode,
    focus,
    activeLayoutId,
    availableLayouts,
    setActiveLayout,
    activeThemeId,
    availableThemes,
    setActiveTheme
  } = ctx;

  const hasAnchor = !!focus.anchor;
  // The three tabs map onto TWO existing states: annotationMode ("floating"|"margin") for
  // Document/Notes-Overlay, and an EXPLICIT "Anchor Focus" selection within floating mode
  // (a transient choice, not derived from focus.anchor — having a focused anchor is the
  // normal reading state, so it must NOT silently flip the active tab). Notes-Overlay
  // (margin) always wins when set; otherwise the last-chosen floating tab is active.
  const [floatingTab, setFloatingTab] = useState<"document" | "anchor">("document");
  const overlayActive = annotationMode === "margin";
  const documentActive = !overlayActive && floatingTab === "document";
  const focusActive = !overlayActive && floatingTab === "anchor";

  const [gearOpen, setGearOpen] = useState(false);
  const gearRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!gearOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (gearRef.current && !gearRef.current.contains(e.target as Node)) setGearOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [gearOpen]);

  return (
    <header className="topbar">
      <div className="topbar-left">
        <span className="topbar-logo" aria-hidden="true">
          <Anchor size={20} />
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
          {hasAnchor ? <span className="topbar-tab-badge">1</span> : null}
        </button>
      </div>

      <div className="topbar-right">
        <button
          type="button"
          className="topbar-opacity"
          disabled
          title="Anchor layer opacity (coming soon)"
        >
          Anchor layer
        </button>

        <button
          type="button"
          className={`topbar-pill${leftPaneKind === "layer.switcher" ? " active" : ""}`}
          aria-pressed={leftPaneKind === "layer.switcher"}
          title="Layers"
          onClick={() => onSelectPane("layer.switcher")}
        >
          <Layers size={16} aria-hidden="true" />
          <span>Layers</span>
        </button>
        <button
          type="button"
          className={`topbar-pill${leftPaneKind === "concept.list" ? " active" : ""}`}
          aria-pressed={leftPaneKind === "concept.list"}
          title="Concepts &amp; relations"
          onClick={() => onSelectPane("concept.list")}
        >
          <Network size={16} aria-hidden="true" />
          <span>Concepts</span>
        </button>
        <button
          type="button"
          className={`topbar-icon-btn${leftPaneKind === "library" ? " active" : ""}`}
          aria-label="Reader / library"
          title="Reader / library"
          onClick={() => onSelectPane("library")}
        >
          <BookOpen size={18} />
        </button>

        <div className="topbar-gear" ref={gearRef}>
          <button
            type="button"
            className={`topbar-icon-btn${gearOpen ? " active" : ""}`}
            aria-label="Settings"
            aria-haspopup="menu"
            aria-expanded={gearOpen}
            title="Settings"
            onClick={() => setGearOpen((v) => !v)}
          >
            <Settings size={18} />
          </button>
          {gearOpen ? (
            <div className="topbar-gear-menu" role="menu">
              <label className="topbar-gear-row">
                <span>Theme</span>
                <select
                  className="theme-select"
                  aria-label="Theme"
                  title="Switch the app theme (colors/typography only)"
                  value={activeThemeId}
                  onChange={(event) => setActiveTheme(event.target.value)}
                >
                  {availableThemes.map((theme) => (
                    <option key={theme.id} value={theme.id}>
                      {theme.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="topbar-gear-row">
                <span>Layout</span>
                <select
                  className="layout-select"
                  aria-label="Workspace layout"
                  title="Switch the workspace layout (which panes are shown and how they're arranged)"
                  value={activeLayoutId}
                  onChange={(event) => setActiveLayout(event.target.value)}
                >
                  {availableLayouts.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
