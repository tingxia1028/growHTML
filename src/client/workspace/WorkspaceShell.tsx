// WorkspaceShell — renders a WorkspaceLayout's nodes through the ViewRegistry into
// the existing `.app-shell` grid, in order. This replaces the hand-written three-pane
// JSX that used to be App's `Workspace` return value: the shell is layout-agnostic
// (it just maps `layout.nodes` → `renderNode`), and the `threePane` preset supplies
// the same library / reader / study nodes. So the rendered DOM is identical, but the
// panes are now data + registered views.
//
// On top of that it makes the fixed-width panes DRAG-RESIZABLE: a thin gutter sits
// between adjacent panels; dragging it changes the neighbouring fixed pane's width
// while the flexible reader (`source.viewer`) absorbs the difference. Widths persist
// to localStorage so the layout you set sticks across reloads.
//
// Importing this module also registers the built-in views (via `./views`), so a
// consumer only has to render <WorkspaceShell layout={threePane} /> inside a
// WorkspaceProvider.

import { Fragment, useRef, useState, type ReactNode } from "react";
import type { WorkspaceLayout } from "../data/entityClient";
import { renderNode } from "./viewRegistry";
import { useWorkspace } from "./WorkspaceContext";
// Side-effect imports: register the built-in view plugins.
//   ./views        → library / source.viewer / study (the original three panes)
//   ./conceptViews → concept.list (the P5 concept/relation pane)
import "./views";
import "./conceptViews";
import "./layerViews";

type Node = WorkspaceLayout["nodes"][number];

// The reader pane flexes (1fr) and absorbs every resize; all other panes are fixed.
const FLEX_KIND = "source.viewer";
const DEFAULT_WIDTH: Record<string, number> = {
  library: 300,
  study: 380,
  "concept.list": 340,
  "layer.switcher": 280
};
const MIN_WIDTH = 200;
const MAX_WIDTH = 760;
const WIDTHS_KEY = "sv-panel-widths";

const isFlex = (node: Node) => node.kind === FLEX_KIND;

function loadWidths(): Record<string, number> {
  try {
    const raw = globalThis.localStorage?.getItem(WIDTHS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

// Which pane a gutter resizes, and in which direction dragging right grows it.
// Resize the fixed neighbour; the flexible reader absorbs the change. When both
// neighbours are fixed (e.g. study|concept), resize the right one so the rightmost
// pane stays reachable.
function gutterTarget(left: Node, right: Node): { id: string; sign: 1 | -1 } | null {
  const lf = isFlex(left);
  const rf = isFlex(right);
  if (!lf && rf) return { id: left.id, sign: 1 }; // drag right → left pane grows
  if (lf && !rf) return { id: right.id, sign: -1 }; // drag right → right pane shrinks
  if (!lf && !rf) return { id: right.id, sign: -1 };
  return null; // flex|flex — nothing fixed to resize
}

export function WorkspaceShell({ layout }: { layout: WorkspaceLayout }) {
  const ctx = useWorkspace();
  const [widths, setWidths] = useState<Record<string, number>>(loadWidths);
  const nodes = layout.nodes;
  const kindById = new Map(nodes.map((node) => [node.id, node.kind]));

  const widthOf = (id: string) => widths[id] ?? DEFAULT_WIDTH[kindById.get(id) ?? ""] ?? 320;
  const widthOfRef = useRef(widthOf);
  widthOfRef.current = widthOf;

  function startDrag(event: React.MouseEvent, id: string, sign: 1 | -1) {
    event.preventDefault();
    const startX = event.clientX;
    const startW = widthOfRef.current(id);
    const onMove = (e: MouseEvent) => {
      const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startW + sign * (e.clientX - startX)));
      setWidths((prev) => ({ ...prev, [id]: next }));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      setWidths((prev) => {
        try {
          globalThis.localStorage?.setItem(WIDTHS_KEY, JSON.stringify(prev));
        } catch {
          // storage unavailable — keep the in-memory widths
        }
        return prev;
      });
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  const columns: string[] = [];
  const items: ReactNode[] = [];
  nodes.forEach((node, i) => {
    columns.push(isFlex(node) ? "minmax(0, 1fr)" : `${widthOf(node.id)}px`);
    items.push(<Fragment key={node.id}>{renderNode(node, ctx)}</Fragment>);
    if (i < nodes.length - 1) {
      const target = gutterTarget(node, nodes[i + 1]);
      columns.push("6px");
      items.push(
        target ? (
          <div
            key={`gutter-${i}`}
            className="col-resize-handle"
            role="separator"
            aria-orientation="vertical"
            onMouseDown={(e) => startDrag(e, target.id, target.sign)}
          />
        ) : (
          <div key={`gutter-${i}`} className="col-resize-gap" />
        )
      );
    }
  });

  return (
    <div className="app-shell" style={{ gridTemplateColumns: columns.join(" ") }}>
      {items}
    </div>
  );
}
