// WorkspaceShell — recursively renders a WorkspaceLayout's DOCK TREE (layout.layout)
// through the ViewRegistry. A `split` node becomes a row/column flex container; a `leaf`
// resolves its `nodeId` to a WorkspaceNode and renders it via `renderNode`. The root
// split IS the `.app-shell` flex container, so a single-row layout stays flat; nested
// splits (e.g. a reader with a bottom panel) add `.dock-split` containers.
//
// Panes are DRAG-RESIZABLE in both axes: a thin gutter sits between adjacent children;
// dragging it resizes the neighbouring FIXED pane (col-resize in a row, row-resize in a
// column) while the flexible child (size:"flex", e.g. the reader) absorbs the slack.
// Sizes persist to localStorage so the layout you set sticks across reloads.
//
// Importing this module also registers the built-in views (via ./views etc.), so a
// consumer only has to render <WorkspaceShell layout={…} /> inside a WorkspaceProvider.

import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import type { WorkspaceLayout, WorkspaceNode } from "../data/entityClient";
import { renderNode } from "./viewRegistry";
import { useWorkspace } from "./WorkspaceContext";
import {
  childInitialPx,
  clampDockPx,
  dockNodeMap,
  dockRoot,
  flexFor,
  gutterTarget,
  isCollapsibleLeaf,
  isPaneCollapsed,
  paneCollapseKey,
  paneLabel,
  type DockChild,
  type DockNode
} from "./dock";
// Side-effect imports: register the built-in view plugins.
//   ./views          → library / source.viewer / study (the original three panes)
//   ./conceptViews   → concept.list (the P5 concept/relation pane)
//   ./layerViews     → layer.switcher (the V2 Study Layer pane)
//   ./practiceViews  → practice (the Textbook Learning layout's bottom panel)
import "./views";
import "./conceptViews";
import "./layerViews";
//   ./bookmarkViews  → bookmark.list (the Bookmark V1 jump strip)
import "./bookmarkViews";
import "./practiceViews";
//   ./operationViews → operation.manager (the operation-as-data builder + manager)
import "./operationViews";
//   ./anchorViews    → anchor.excerpt (the right column's Anchor section, R1)
import "./anchorViews";
import { TopBar } from "./TopBar";
import { IconRail } from "./IconRail";

// px size overrides keyed by dock child key (leaf nodeId, else its tree path).
const SIZES_KEY = "sv-panel-widths";
// Per-pane collapsed flags, keyed by `${layoutId}:${nodeId}`.
const COLLAPSED_KEY = "sv-pane-collapsed";
// Width of a collapsed pane's rail (just enough for the rotated label + expand hit area).
const RAIL_PX = 34;

// The dock leaf nodeId that the IconRail / TopBar buttons SWAP: selecting a rail entry
// renders that view-kind in this slot instead of the static "library" view. Keeps the
// previously always-on side panes (bookmarks/concepts/layers/operations) reachable without
// always-on columns. Default selection = library.
const LEFT_SLOT_NODE_ID = "library";
const DEFAULT_LEFT_KIND = "library";

function loadSizes(): Record<string, number> {
  try {
    const raw = globalThis.localStorage?.getItem(SIZES_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function loadCollapsed(): Record<string, boolean> {
  try {
    const raw = globalThis.localStorage?.getItem(COLLAPSED_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function currentWidth(): number {
  return typeof window !== "undefined" ? window.innerWidth : 9999;
}

// Stable storage/identity key for a resizable child: its leaf nodeId (meaningful +
// preserves saved widths) or, for a nested split, its position path.
function childKey(child: DockChild, path: string): string {
  return child.node.type === "leaf" ? child.node.nodeId : path;
}

export function WorkspaceShell({ layout }: { layout: WorkspaceLayout }) {
  const ctx = useWorkspace();
  const nodes = useMemo(() => dockNodeMap(layout), [layout]);
  const root = dockRoot(layout);

  const [sizes, setSizes] = useState<Record<string, number>>(loadSizes);
  const sizesRef = useRef(sizes);
  sizesRef.current = sizes;

  // Which view-kind the switchable LEFT_SLOT renders (IconRail / TopBar buttons set it).
  const [leftPaneKind, setLeftPaneKind] = useState<string>(DEFAULT_LEFT_KIND);

  // User collapse flags (explicit toggles) + the live viewport width (drives responsive
  // auto-collapse of secondary panes). Both feed `isPaneCollapsed`.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(loadCollapsed);
  const [viewportWidth, setViewportWidth] = useState<number>(currentWidth);
  useEffect(() => {
    const onResize = () => setViewportWidth(currentWidth());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  function toggleCollapsed(collapseKey: string, next: boolean) {
    setCollapsed((prev) => {
      const updated = { ...prev, [collapseKey]: next };
      try {
        globalThis.localStorage?.setItem(COLLAPSED_KEY, JSON.stringify(updated));
      } catch {
        // storage unavailable — keep the in-memory flags
      }
      return updated;
    });
  }

  function pxFor(key: string, fallback: number): number {
    return sizes[key] ?? fallback;
  }

  function startDrag(event: ReactMouseEvent, key: string, sign: 1 | -1, axis: "x" | "y", fallback: number) {
    event.preventDefault();
    const start = axis === "x" ? event.clientX : event.clientY;
    const startPx = sizesRef.current[key] ?? fallback;
    const onMove = (e: MouseEvent) => {
      const cur = axis === "x" ? e.clientX : e.clientY;
      setSizes((prev) => ({ ...prev, [key]: clampDockPx(startPx + sign * (cur - start)) }));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      setSizes((prev) => {
        try {
          globalThis.localStorage?.setItem(SIZES_KEY, JSON.stringify(prev));
        } catch {
          // storage unavailable — keep the in-memory sizes
        }
        return prev;
      });
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  // The children of a split: panes interleaved with resize gutters. Used for the root
  // split (rendered straight into .app-shell) and for nested .dock-split containers.
  function renderChildren(node: Extract<DockNode, { type: "split" }>, path: string): ReactNode[] {
    const axis: "x" | "y" = node.direction === "row" ? "x" : "y";

    // Resolve each child once: its size key, the WorkspaceNode (for leaves), whether it
    // can collapse, and its effective collapsed state (explicit toggle OR responsive).
    const meta = node.children.map((child, i) => {
      const key = childKey(child, `${path}/${i}`);
      const wsNode = child.node.type === "leaf" ? nodes.get(child.node.nodeId) : undefined;
      const kind = wsNode?.kind ?? "";
      const collapsible = !!wsNode && isCollapsibleLeaf(child, kind);
      const collapseKey = wsNode ? paneCollapseKey(layout.id, wsNode.id) : key;
      const isCollapsed = collapsible && isPaneCollapsed(kind, collapsed[collapseKey] ?? false, viewportWidth);
      return { child, key, wsNode, collapsible, collapseKey, isCollapsed };
    });

    const out: ReactNode[] = [];
    meta.forEach((m, i) => {
      const paneFlex = m.isCollapsed
        ? `0 0 ${RAIL_PX}px`
        : flexFor(m.child, pxFor(m.key, childInitialPx(m.child)));
      out.push(
        <div
          className="dock-pane"
          data-collapsed={m.isCollapsed ? "true" : undefined}
          key={`pane-${m.key}`}
          style={{ flex: paneFlex }}
        >
          {m.collapsible && m.isCollapsed ? (
            <button
              type="button"
              className="dock-rail"
              aria-label={`Expand ${paneLabel(m.wsNode!)}`}
              title={`Expand ${paneLabel(m.wsNode!)}`}
              onClick={() => toggleCollapsed(m.collapseKey, false)}
            >
              <span className="dock-rail-label">{paneLabel(m.wsNode!)}</span>
            </button>
          ) : (
            <>
              {m.collapsible ? (
                <button
                  type="button"
                  className="dock-collapse-btn"
                  aria-label={`Collapse ${paneLabel(m.wsNode!)}`}
                  title={`Collapse ${paneLabel(m.wsNode!)}`}
                  onClick={() => toggleCollapsed(m.collapseKey, true)}
                >
                  ‹
                </button>
              ) : null}
              {renderDock(m.child.node, m.key)}
            </>
          )}
        </div>
      );

      if (i < meta.length - 1) {
        const target = gutterTarget(node.children, i);
        // No live resize at a collapsed boundary (a collapsed pane is a fixed rail).
        const boundaryCollapsed =
          m.isCollapsed || meta[i + 1].isCollapsed || (target ? meta[target.childIndex].isCollapsed : false);
        if (target && !boundaryCollapsed) {
          const tChild = node.children[target.childIndex];
          const tKey = childKey(tChild, `${path}/${target.childIndex}`);
          out.push(
            <div
              key={`gutter-${i}`}
              className={axis === "x" ? "dock-resize dock-resize-x" : "dock-resize dock-resize-y"}
              role="separator"
              aria-orientation={axis === "x" ? "vertical" : "horizontal"}
              onMouseDown={(e) => startDrag(e, tKey, target.sign, axis, childInitialPx(tChild))}
            />
          );
        } else {
          out.push(<div key={`gutter-${i}`} className="dock-gap" />);
        }
      }
    });
    return out;
  }

  function renderDock(node: DockNode, path: string): ReactNode {
    if (node.type === "leaf") {
      const wsNode = nodes.get(node.nodeId);
      if (!wsNode) {
        return (
          <div className="workspace-node-missing" data-kind={node.nodeId}>
            Unknown node: {node.nodeId}
          </div>
        );
      }
      // The switchable left slot renders the IconRail-selected kind, not its static one,
      // so the panes that used to be always-on columns are reached here on demand.
      if (wsNode.id === LEFT_SLOT_NODE_ID && leftPaneKind !== wsNode.kind) {
        const swapped: WorkspaceNode = { ...wsNode, kind: leftPaneKind };
        return renderNode(swapped, ctx);
      }
      return renderNode(wsNode, ctx);
    }
    return <div className={`dock-split dock-${node.direction}`}>{renderChildren(node, path)}</div>;
  }

  // R1 shell chrome: TopBar across the top, then a body row of IconRail (fixed strip) +
  // the resizable dock tree (.app-shell). The dock's root split IS the .app-shell flex
  // container (keeps the dock DOM flat); a degenerate single-leaf root is wrapped so
  // .app-shell always exists.
  const dock =
    root.type !== "split" ? (
      <div className="app-shell dock-row">{renderDock(root, "root")}</div>
    ) : (
      <div className={`app-shell dock-${root.direction}`}>{renderChildren(root, "root")}</div>
    );

  return (
    <div className="app-frame">
      <TopBar ctx={ctx} leftPaneKind={leftPaneKind} onSelectPane={setLeftPaneKind} />
      <div className="app-body">
        <IconRail selected={leftPaneKind} onSelect={setLeftPaneKind} />
        {dock}
      </div>
    </div>
  );
}
