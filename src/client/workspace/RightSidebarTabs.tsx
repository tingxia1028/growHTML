// RightSidebarTabs — the right sidebar as a TABBED panel (user request: the right
// column is sub-pages, not a stacked Anchor + AI-Chat with Notes folded under Anchor).
// One dock leaf renders a tab bar over four sub-pages, each an already-registered view:
//   • Anchor        → anchor.excerpt  (the focused-anchor detail)
//   • Page Anchors  → note.list       (this source's notes, each tied to its anchor)
//   • Layers        → layer.switcher  (the per-source layer filter + manager)
//   • AI Chat       → study           (the chat pane)
// Sub-pages render through the SAME registry the dock uses (getView(kind).render), so a
// tab is just a kind — no logic duplicated, IRON LAW intact (views talk only via ctx).
//
// VS-Code-style vertical split (V1): drag a tab OUT of the tab bar onto the body's TOP or
// BOTTOM drop zone to POP that sub-page into its own pane on that side; the other pane
// keeps the remaining tabs. A row-resize divider sizes the two panes (ratio clamped
// 0.2–0.8); the popped pane has a header with a "merge back" (×) button. Exactly ONE
// popped pane in V1 — dropping another tab replaces it. State persists to localStorage
// (keyed by layout id), restored on mount. Both panes render through the SAME
// getView(kind).render path — no sub-view logic is duplicated. The split is SELF-CONTAINED
// here (its own state + the pure helpers in ./rightSplit); the global dock engine is
// untouched.

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { WorkspaceNode } from "../data/entityClient";
import { getView, registerView, renderNode, type WorkspaceContext } from "./viewRegistry";
import { NoteListPanel } from "./NoteListPanel";
import {
  clampRatio,
  loadRightSplit,
  remainingTabs,
  saveRightSplit,
  type SplitSide
} from "./rightSplit";

const TABS: ReadonlyArray<{ kind: string; label: string }> = [
  { kind: "anchor.excerpt", label: "Anchor" },
  { kind: "note.list", label: "Notes" },
  { kind: "layer.switcher", label: "Layers" },
  { kind: "study", label: "AI Chat" }
];

const TAB_KINDS = TABS.map((t) => t.kind);
const labelFor = (kind: string): string => TABS.find((t) => t.kind === kind)?.label ?? kind;

function RightSidebarTabs({ node, ctx }: { node: WorkspaceNode; ctx: WorkspaceContext }) {
  const layoutId = ctx.activeLayoutId;
  // Split state ({ poppedKind, side, ratio }) — restored from localStorage on mount.
  const [split, setSplit] = useState(() => loadRightSplit(layoutId, TAB_KINDS));
  const [active, setActive] = useState(TABS[0].kind);
  // True while a tab is mid-drag — reveals the TOP/BOTTOM drop zones in the body.
  const [dragging, setDragging] = useState(false);
  // The zone currently under the pointer (for the dragover highlight).
  const [hoverZone, setHoverZone] = useState<SplitSide | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // Re-restore when the layout changes (each layout persists its own split).
  useEffect(() => {
    setSplit(loadRightSplit(layoutId, TAB_KINDS));
  }, [layoutId]);

  // A linked-note click focuses `{type:"note"}`; surface that focus in the Notes
  // viewer instead of leaving the user on the Anchor tab.
  useEffect(() => {
    if (ctx.focus.focus?.type !== "note") return;
    if (split.poppedKind === "note.list") return;
    setActive("note.list");
  }, [ctx.focus.focus, split.poppedKind]);

  // Persist on every committed change.
  function commitSplit(next: ReturnType<typeof loadRightSplit>) {
    setSplit(next);
    saveRightSplit(layoutId, next);
  }

  const groupTabs = remainingTabs(TABS, split.poppedKind);
  // If the active tab was just popped (or otherwise vanished), fall back to the first
  // remaining tab so the tab-group pane always shows something valid.
  const activeInGroup = groupTabs.some((t) => t.kind === active) ? active : (groupTabs[0]?.kind ?? active);
  if (activeInGroup !== active) {
    // Defer the setState out of render.
    queueMicrotask(() => setActive(activeInGroup));
  }

  // Render one sub-view through the SAME registry path the dock uses. The synthetic child
  // id stays stable per (leaf, kind) so React keeps sub-view state across re-renders.
  function renderKind(kind: string) {
    const childNode: WorkspaceNode = { ...node, id: `${node.id}:${kind}`, kind };
    const plugin = getView(kind);
    return plugin ? plugin.render(childNode, ctx) : renderNode(childNode, ctx);
  }

  // —— drag a tab out ——
  function onTabDragStart(event: React.DragEvent, kind: string) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/sv-right-tab", kind);
    setDragging(true);
  }
  function onTabDragEnd() {
    setDragging(false);
    setHoverZone(null);
  }
  function readDragKind(event: React.DragEvent): string | null {
    const kind = event.dataTransfer.getData("text/sv-right-tab");
    return kind && TAB_KINDS.includes(kind) ? kind : null;
  }
  function onZoneDragOver(event: React.DragEvent, zone: SplitSide) {
    // Only react to our own tab drags.
    if (!event.dataTransfer.types.includes("text/sv-right-tab")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (hoverZone !== zone) setHoverZone(zone);
  }
  function onZoneDrop(event: React.DragEvent, zone: SplitSide) {
    const kind = readDragKind(event);
    setDragging(false);
    setHoverZone(null);
    if (!kind) return;
    event.preventDefault();
    // Pop this tab into its own pane on the dropped side; the other pane keeps the rest.
    commitSplit({ poppedKind: kind, side: zone, ratio: split.ratio });
  }

  // —— merge back ——
  function mergeBack() {
    commitSplit({ ...split, poppedKind: null });
  }

  // —— divider resize (pointer based, mirrors WorkspaceShell.startDrag) ——
  const ratioRef = useRef(split.ratio);
  ratioRef.current = split.ratio;
  function onDividerDown(event: ReactMouseEvent) {
    event.preventDefault();
    const body = bodyRef.current;
    if (!body) return;
    const rect = body.getBoundingClientRect();
    const onMove = (e: MouseEvent) => {
      const raw = rect.height > 0 ? (e.clientY - rect.top) / rect.height : ratioRef.current;
      setSplit((prev) => ({ ...prev, ratio: clampRatio(raw) }));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      // Persist the final ratio.
      setSplit((prev) => {
        saveRightSplit(layoutId, prev);
        return prev;
      });
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  const tabBar = (
    <div className="right-tabs-bar" role="tablist" aria-label="Right sidebar">
      {groupTabs.map((tab) => (
        <button
          key={tab.kind}
          type="button"
          role="tab"
          draggable
          aria-selected={activeInGroup === tab.kind}
          className={`right-tabs-tab${activeInGroup === tab.kind ? " active" : ""}`}
          onClick={() => setActive(tab.kind)}
          onDragStart={(e) => onTabDragStart(e, tab.kind)}
          onDragEnd={onTabDragEnd}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );

  // The tab-group pane: the tab bar + the active remaining tab's sub-view, with the
  // drop-zone overlay shown while dragging.
  const groupPane = (
    <div className="right-tabs-group">
      {tabBar}
      <div className="right-tabs-body" role="tabpanel" ref={bodyRef}>
        {renderKind(activeInGroup)}
        {dragging ? (
          <div className="right-tabs-dropzones" aria-hidden="true">
            <div
              className={`right-tabs-dropzone top${hoverZone === "top" ? " over" : ""}`}
              onDragOver={(e) => onZoneDragOver(e, "top")}
              onDragLeave={() => setHoverZone((z) => (z === "top" ? null : z))}
              onDrop={(e) => onZoneDrop(e, "top")}
            >
              <span className="right-tabs-dropzone-label">Split top</span>
            </div>
            <div
              className={`right-tabs-dropzone bottom${hoverZone === "bottom" ? " over" : ""}`}
              onDragOver={(e) => onZoneDragOver(e, "bottom")}
              onDragLeave={() => setHoverZone((z) => (z === "bottom" ? null : z))}
              onDrop={(e) => onZoneDrop(e, "bottom")}
            >
              <span className="right-tabs-dropzone-label">Split bottom</span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );

  // No split → the plain tab group fills the whole sidebar.
  if (!split.poppedKind) {
    return <div className="right-tabs">{groupPane}</div>;
  }

  // The popped pane: a small header (label + merge-back ×) over its single sub-view.
  const poppedPane = (
    <div className="right-tabs-popped">
      <div className="right-tabs-popped-header">
        <span className="right-tabs-popped-label">{labelFor(split.poppedKind)}</span>
        <button
          type="button"
          className="right-tabs-popped-merge"
          aria-label={`Merge ${labelFor(split.poppedKind)} back into tabs`}
          title="Merge back"
          onClick={mergeBack}
        >
          ×
        </button>
      </div>
      <div className="right-tabs-popped-body">{renderKind(split.poppedKind)}</div>
    </div>
  );

  // Stack the two panes: top/bottom order follows `side` (the side the popped tab landed
  // on). `ratio` always describes the TOP pane's fraction.
  const topPct = clampRatio(split.ratio) * 100;
  const topPane = split.side === "top" ? poppedPane : groupPane;
  const bottomPane = split.side === "top" ? groupPane : poppedPane;

  return (
    <div className="right-tabs right-tabs-split">
      <div className="right-tabs-pane right-tabs-pane-top" style={{ flexBasis: `${topPct}%` }}>
        {topPane}
      </div>
      <div
        className="right-tabs-divider"
        role="separator"
        aria-orientation="horizontal"
        onMouseDown={onDividerDown}
      />
      <div className="right-tabs-pane right-tabs-pane-bottom" style={{ flexBasis: `${100 - topPct}%` }}>
        {bottomPane}
      </div>
    </div>
  );
}

registerView({ kind: "right.tabs", render: (node, ctx) => <RightSidebarTabs node={node} ctx={ctx} /> });
// The notes list as a FULL sub-page (always-open, static header) — used by the "Page
// Anchors" tab. (The collapsible fold variant is no longer embedded in the Anchor pane.)
registerView({ kind: "note.list", render: () => <NoteListPanel collapsible={false} /> });
