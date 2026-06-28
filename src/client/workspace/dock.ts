// Dock layout tree — the data model the WorkspaceShell recursively renders. A layout
// is no longer a flat list of columns; its `layout` field is a DockNode TREE so panes
// can nest (rows inside columns inside rows), which is what a real workspace needs
// (e.g. left nav | center [reader / bottom panel] | right). A `leaf` references a view
// instance by `nodeId` (resolved against `layout.nodes`), so the ViewRegistry and view
// plugins are untouched — this only changes HOW panes are arranged, not what they are.
//
// Pure + dependency-light so the arrangement logic (flex sizing, gutter targeting) is
// unit-testable without a DOM.

import type { WorkspaceLayout, WorkspaceNode } from "../data/entityClient";

export type DockChild = {
  /** Main-axis size: pixels (fixed) or "flex"/unset (absorbs the remaining space). */
  size?: number | "flex";
  node: DockNode;
};

export type DockNode =
  | { type: "split"; direction: "row" | "column"; children: DockChild[] }
  | { type: "leaf"; nodeId: string };

export const DOCK_MIN_PX = 200;
export const DOCK_MAX_PX = 760;
const FALLBACK_PX = 320;

export function leaf(nodeId: string): DockNode {
  return { type: "leaf", nodeId };
}

export function split(direction: "row" | "column", children: DockChild[]): DockNode {
  return { type: "split", direction, children };
}

// A child absorbs the remaining main-axis space when its size is "flex" (or unset).
export function isFlexChild(child: DockChild): boolean {
  return child.size === "flex" || child.size == null;
}

// The child's initial pixel size (before any user resize override).
export function childInitialPx(child: DockChild): number {
  return typeof child.size === "number" ? child.size : FALLBACK_PX;
}

// CSS `flex` shorthand for a child given its resolved pixel size (px ignored for flex).
export function flexFor(child: DockChild, px: number): string {
  return isFlexChild(child) ? "1 1 0" : `0 0 ${px}px`;
}

// Ordered leaf nodeIds (depth-first, left→right) — for validation/tests.
export function dockLeafIds(node: DockNode): string[] {
  if (node.type === "leaf") return [node.nodeId];
  return node.children.flatMap((child) => dockLeafIds(child.node));
}

export function clampDockPx(px: number): number {
  return Math.max(DOCK_MIN_PX, Math.min(DOCK_MAX_PX, px));
}

// Which child a gutter (between children[i] and [i+1]) resizes, and the drag sign (so
// dragging toward a larger main-axis coordinate grows the target). Resize the FIXED
// neighbour so the flex child absorbs the slack; when both are fixed, resize the right
// one (keeps the rightmost pane reachable); when both are flex, there's no handle.
export function gutterTarget(
  children: DockChild[],
  i: number
): { childIndex: number; sign: 1 | -1 } | null {
  const lf = isFlexChild(children[i]);
  const rf = isFlexChild(children[i + 1]);
  if (!lf && rf) return { childIndex: i, sign: 1 }; // drag → grows left
  if (lf && !rf) return { childIndex: i + 1, sign: -1 }; // drag → shrinks right
  if (!lf && !rf) return { childIndex: i + 1, sign: -1 };
  return null; // flex | flex — nothing fixed to resize
}

// leaf nodeId → WorkspaceNode lookup for a layout.
export function dockNodeMap(layout: WorkspaceLayout): Map<string, WorkspaceNode> {
  return new Map(layout.nodes.map((node) => [node.id, node]));
}

// The layout's dock tree (layout.layout is typed `unknown` in the entity client).
export function dockRoot(layout: WorkspaceLayout): DockNode {
  return layout.layout as DockNode;
}

// —— Pane collapse + responsiveness ————————————————————————————————————————————

// Below this viewport width the secondary side panes auto-collapse so the reader stays
// usable without horizontal scroll. 1280 is Playwright's / Desktop-Chrome default width,
// so `< 1280` leaves the standard test viewport (and roomy screens) fully expanded.
export const RESPONSIVE_BREAKPOINT_PX = 1280;

// The side panes that auto-collapse when narrow (the flex reader + the study panel stay).
export const SECONDARY_KINDS = new Set(["library", "concept.list", "layer.switcher"]);

// A pane is collapsible if it's a FIXED-size leaf (the flex reader is never collapsible).
export function isCollapsibleLeaf(child: DockChild, kind: string): boolean {
  return child.node.type === "leaf" && !isFlexChild(child) && kind !== "source.viewer";
}

// Effective collapsed state = the user's explicit toggle OR (on a narrow viewport) a
// secondary side pane auto-collapsing. Pure, so the rule is unit-testable.
export function isPaneCollapsed(kind: string, userCollapsed: boolean, viewportWidth: number): boolean {
  return userCollapsed || (viewportWidth < RESPONSIVE_BREAKPOINT_PX && SECONDARY_KINDS.has(kind));
}

// Stable key for persisting a pane's collapsed state (scoped per layout + node).
export function paneCollapseKey(layoutId: string, nodeId: string): string {
  return `${layoutId}:${nodeId}`;
}

const PANE_LABELS: Record<string, string> = {
  library: "Sources",
  "source.viewer": "Reader",
  study: "Study",
  "concept.list": "Concepts",
  "layer.switcher": "Layers",
  "operation.manager": "Actions",
  practice: "Practice"
};

// Friendly label for a pane (its `params.title`, else a kind→label map, else the kind).
export function paneLabel(node: WorkspaceNode): string {
  const title = node.params?.title;
  if (typeof title === "string" && title) return title;
  return PANE_LABELS[node.kind] ?? node.kind;
}
