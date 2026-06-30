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

import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  Anchor,
  Check,
  Crosshair,
  FileText,
  Layers,
  Minus,
  Network,
  PanelRight,
  RotateCcw,
  Square,
  X
} from "lucide-react";
import type { WorkspaceContext } from "./viewRegistry";
import { BOOKMARK_CONTENT_TYPE } from "../../core/notes/contentTypes";
import {
  buildLayerTree,
  countNotesInLayers,
  descendantLeafIds,
  parentToggleState,
  type LayerNode
} from "./layerTree";

export type TopBarProps = {
  ctx: WorkspaceContext;
  /** The view-kind currently shown in the left rail slot (icon-rail selection). */
  leftPaneKind: string;
  /** Show a pane kind in the left rail slot (used by the right-side icon buttons). */
  onSelectPane(kind: string): void;
};

// Stable fallback palette for layers without an explicit color (assigned by position so
// sibling rows read as distinct chips). The owned/preset layers usually carry no color.
const LAYER_PALETTE = ["#3b82f6", "#3fb96b", "#8b5cf6", "#ff6b73", "#ff9d55", "#46c2c9", "#d97cf0"];

function LayerLensPopover({ ctx }: { ctx: WorkspaceContext }) {
  const { sourceLayers, notes, visibleNotes, toggleLayerFilter, setLayersEnabled } = ctx;

  const enabledIds = useMemo(
    () => new Set(sourceLayers.filter((layer) => layer.enabled).map((layer) => layer.id)),
    [sourceLayers]
  );
  // Sort siblings by order then title before building the tree (buildLayerTree preserves
  // input order within a parent).
  const roots = useMemo(
    () => buildLayerTree([...sourceLayers].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title))),
    [sourceLayers]
  );
  // The footer total = distinct visible (enabled-OR) non-bookmark notes.
  const visibleCount = useMemo(
    () => visibleNotes.filter((note) => (note.contentType ?? "markdown") !== BOOKMARK_CONTENT_TYPE).length,
    [visibleNotes]
  );

  const colorFor = (layer: { color?: string }, index: number) => layer.color ?? LAYER_PALETTE[index % LAYER_PALETTE.length];

  const renderRow = (node: LayerNode, depth: number, index: number): ReactNode => {
    const isParent = node.children.length > 0;
    const leafIds = descendantLeafIds(node);
    const count = countNotesInLayers(notes, leafIds, BOOKMARK_CONTENT_TYPE);
    const state = isParent
      ? parentToggleState(node, enabledIds)
      : enabledIds.has(node.layer.id)
        ? "on"
        : "off";
    return (
      <Fragment key={node.layer.id}>
        <button
          type="button"
          className={`layer-lens-row${isParent ? " layer-lens-row-parent" : ""}`}
          style={{ paddingLeft: 12 + depth * 18 } as CSSProperties}
          aria-pressed={state === "on"}
          onClick={() => {
            if (isParent) setLayersEnabled(leafIds, state !== "on");
            else toggleLayerFilter(node.layer);
          }}
        >
          <span
            className="layer-lens-mark"
            data-state={state}
            data-enabled={state === "on" ? "true" : undefined}
            style={{ "--layer-color": colorFor(node.layer, index) } as CSSProperties}
          >
            {state === "on" ? <Check size={12} strokeWidth={3} /> : state === "mixed" ? <Minus size={12} strokeWidth={3} /> : null}
          </span>
          <span className="layer-lens-name">{node.layer.title}</span>
          <span className="layer-lens-count">{count}</span>
        </button>
        {node.children.map((child, childIndex) => renderRow(child, depth + 1, childIndex))}
      </Fragment>
    );
  };

  return (
    <div className="layer-lens-popover" role="dialog" aria-label="Layer Lens">
      <div className="layer-lens-head">
        <h2>Layer Lens</h2>
        <p>Choose which layers are visible</p>
      </div>
      <div className="layer-lens-list">
        {roots.length ? (
          roots.map((node, index) => renderRow(node, 0, index))
        ) : (
          <p className="layer-lens-empty">Open a source to see its layers.</p>
        )}
      </div>
      <div className="layer-lens-visible">Visible note count: {visibleCount}</div>
      <div className="layer-lens-foot">
        <button
          type="button"
          className="layer-lens-reset"
          title="Show all layers"
          onClick={() => void setLayersEnabled(sourceLayers.map((layer) => layer.id), true)}
        >
          <RotateCcw size={14} />
          Reset
        </button>
      </div>
    </div>
  );
}

export function TopBar({ ctx, leftPaneKind, onSelectPane }: TopBarProps) {
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

  const [layerLensOpen, setLayerLensOpen] = useState(false);
  const layerLensRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!layerLensOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (layerLensRef.current && !layerLensRef.current.contains(e.target as Node)) setLayerLensOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [layerLensOpen]);

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

      <div className="topbar-right">
        <div className="topbar-lens" ref={layerLensRef}>
          <button
            type="button"
            className={`topbar-pill${layerLensOpen ? " active" : ""}`}
            aria-pressed={layerLensOpen}
            title="Layers"
            onClick={() => setLayerLensOpen((value) => !value)}
          >
            <Layers size={16} aria-hidden="true" />
            <span>Layers</span>
          </button>
          {layerLensOpen ? <LayerLensPopover ctx={ctx} /> : null}
        </div>
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
