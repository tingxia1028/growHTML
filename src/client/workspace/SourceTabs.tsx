// SourceTabs: the multi-document reader host. One dock leaf renders VS-Code-like
// editor groups: an unsplit tab strip, or left/right tab groups with draggable tabs.
// The global dock model stays unchanged; split view is local to this source.tabs view.

import { Columns2, FileText, X } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import { registerView, type WorkspaceContext } from "./viewRegistry";
import type { OpenPane } from "./panes";
import { SourceViewerView } from "./views";
import {
  canSplitConcurrently,
  clampSplitRatio,
  isSourceSplitActive,
  loadSourceSplit,
  movePaneToSourceGroup,
  normalizeSourceSplit,
  paneIdsForSourceGroup,
  reconcileSourceSplitPaneIds,
  saveSourceSplit,
  sourceGroupOfPane,
  type SourceGroup,
  type SourceSplitState
} from "./sourceSplit";

const SOURCE_PANE_DRAG_TYPE = "text/sv-source-pane";

function sameSplit(a: SourceSplitState, b: SourceSplitState): boolean {
  return a.ratio === b.ratio && a.rightPaneIds.join("\u0001") === b.rightPaneIds.join("\u0001");
}

function panesForIds(openPanes: readonly OpenPane[], ids: readonly string[]): OpenPane[] {
  const byId = new Map(openPanes.map((pane) => [pane.paneId, pane]));
  return ids.map((id) => byId.get(id)).filter((pane): pane is OpenPane => !!pane);
}

function activePaneInGroup(panes: readonly OpenPane[], focusedPaneId: string): OpenPane | null {
  return panes.find((pane) => pane.paneId === focusedPaneId) ?? panes[0] ?? null;
}

function dragHasSourcePane(event: ReactDragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes(SOURCE_PANE_DRAG_TYPE);
}

function SourceTabs({ ctx }: { ctx: WorkspaceContext }) {
  const { openPanes, focusedPaneId, focusPane, closePane, sourceForPane, activeLayoutId } = ctx;

  const focusedPane = openPanes.find((p) => p.paneId === focusedPaneId) ?? openPanes[0] ?? null;
  const paneIds = openPanes.map((p) => p.paneId);
  const paneIdsKey = paneIds.join("\u0001");
  const previousPaneIdsRef = useRef<string[]>(paneIds);
  const activeGroupRef = useRef<SourceGroup>("left");
  const [dragOverGroup, setDragOverGroup] = useState<SourceGroup | null>(null);
  const [split, setSplit] = useState<SourceSplitState>(() => loadSourceSplit(activeLayoutId, paneIds));
  const splitRef = useRef<HTMLDivElement | null>(null);
  const ratioRef = useRef(split.ratio);

  useLayoutEffect(() => {
    const restored = loadSourceSplit(activeLayoutId, paneIds);
    setSplit(restored);
    previousPaneIdsRef.current = paneIds;
    activeGroupRef.current = "left";
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restore split state per layout
  }, [activeLayoutId]);

  useLayoutEffect(() => {
    const previousPaneIds = previousPaneIdsRef.current;
    previousPaneIdsRef.current = paneIds;
    setSplit((prev) => {
      const next = reconcileSourceSplitPaneIds(prev, previousPaneIds, paneIds, activeGroupRef.current);
      if (sameSplit(prev, next)) return prev;
      saveSourceSplit(activeLayoutId, next);
      return next;
    });
  }, [activeLayoutId, paneIdsKey]);

  const normalizedSplit = normalizeSourceSplit(split, paneIds);
  const leftPaneIds = paneIdsForSourceGroup(paneIds, normalizedSplit, "left");
  const rightPaneIds = paneIdsForSourceGroup(paneIds, normalizedSplit, "right");
  const isSplit = isSourceSplitActive(normalizedSplit, paneIds);
  const leftPanes = panesForIds(openPanes, leftPaneIds);
  const rightPanes = panesForIds(openPanes, rightPaneIds);
  const leftActivePane = activePaneInGroup(leftPanes, focusedPaneId);
  const rightActivePane = activePaneInGroup(rightPanes, focusedPaneId);
  const rightPaneIdsKey = rightPaneIds.join("\u0001");
  ratioRef.current = normalizedSplit.ratio;

  useEffect(() => {
    if (!isSplit) {
      activeGroupRef.current = "left";
      return;
    }
    if (focusedPaneId) activeGroupRef.current = sourceGroupOfPane(normalizedSplit, focusedPaneId);
  }, [focusedPaneId, isSplit, rightPaneIdsKey]);

  function commitSplit(next: SourceSplitState) {
    const normalized = normalizeSourceSplit(next, paneIds);
    setSplit((prev) => (sameSplit(prev, normalized) ? prev : normalized));
    saveSourceSplit(activeLayoutId, normalized);
  }

  function focusPaneInGroup(paneId: string, group: SourceGroup) {
    activeGroupRef.current = group;
    focusPane(paneId);
  }

  function focusGroup(group: SourceGroup) {
    const pane = group === "right" ? rightActivePane : leftActivePane;
    if (pane) focusPaneInGroup(pane.paneId, group);
  }

  function focusPaneFromReader(paneId: string) {
    activeGroupRef.current = sourceGroupOfPane(normalizedSplit, paneId);
    focusPane(paneId);
  }

  const groupedCtx: WorkspaceContext = {
    ...ctx,
    focusPane: focusPaneFromReader
  };

  const splitCandidate = openPanes.find((p) => p.paneId !== focusedPane?.paneId) ?? null;
  const focusedSourceType = focusedPane ? sourceForPane(focusedPane.paneId)?.sourceType : undefined;
  const candidateSourceType = splitCandidate ? sourceForPane(splitCandidate.paneId)?.sourceType : undefined;
  const splitAllowed =
    !isSplit && !!splitCandidate && canSplitConcurrently(focusedSourceType, candidateSourceType);

  function onSplit() {
    if (!splitAllowed || !splitCandidate) return;
    const next = movePaneToSourceGroup(normalizedSplit, splitCandidate.paneId, "right", paneIds);
    activeGroupRef.current = "right";
    commitSplit(next);
    focusPane(splitCandidate.paneId);
  }

  function onTabDragStart(event: ReactDragEvent, paneId: string, group: SourceGroup) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(SOURCE_PANE_DRAG_TYPE, paneId);
    activeGroupRef.current = group;
    focusPane(paneId);
  }

  function onTabDragEnd() {
    setDragOverGroup(null);
  }

  function onGroupDragOver(event: ReactDragEvent, group: SourceGroup) {
    if (!dragHasSourcePane(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (dragOverGroup !== group) setDragOverGroup(group);
  }

  function onGroupDrop(event: ReactDragEvent, group: SourceGroup) {
    const paneId = event.dataTransfer.getData(SOURCE_PANE_DRAG_TYPE);
    setDragOverGroup(null);
    if (!paneId || !paneIds.includes(paneId)) return;
    event.preventDefault();
    const next = movePaneToSourceGroup(normalizedSplit, paneId, group, paneIds);
    activeGroupRef.current = group;
    commitSplit(next);
    focusPane(paneId);
  }

  function onDividerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    const el = splitRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const rightAtDragStart = normalizedSplit.rightPaneIds;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const onMove = (e: PointerEvent) => {
      const raw = rect.width > 0 ? (e.clientX - rect.left) / rect.width : ratioRef.current;
      const ratio = clampSplitRatio(raw);
      ratioRef.current = ratio;
      setSplit((prev) => normalizeSourceSplit({ ...prev, rightPaneIds: rightAtDragStart, ratio }, paneIds));
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      commitSplit({ rightPaneIds: rightAtDragStart, ratio: ratioRef.current });
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  }

  function renderTabStrip(group: SourceGroup, panes: readonly OpenPane[], showSplitButton = false) {
    if (panes.length === 0) {
      return (
        <div className="reader-tabs" role="tablist">
          <div className="reader-tab reader-tab-empty">
            <span className="reader-tab-title">Open or import a source</span>
          </div>
        </div>
      );
    }

    return (
      <div
        className={`reader-tabs source-tabs-group source-tabs-group-${group}${dragOverGroup === group ? " drag-over" : ""}`}
        role="tablist"
        aria-label={group === "right" ? "Right editor group" : "Left editor group"}
        onDragOver={(event) => onGroupDragOver(event, group)}
        onDragLeave={() => setDragOverGroup((value) => (value === group ? null : value))}
        onDrop={(event) => onGroupDrop(event, group)}
      >
        {panes.map((pane) => {
          const source = sourceForPane(pane.paneId);
          const title = source?.title ?? "-";
          const isActive =
            pane.paneId === focusedPaneId ||
            (focusedPaneId === "" && openPanes[0]?.paneId === pane.paneId);
          return (
            <div
              key={pane.paneId}
              className={`reader-tab${isActive ? " active" : ""}`}
              role="tab"
              draggable
              aria-selected={isActive}
              data-pane-id={pane.paneId}
              onMouseDown={(event) => {
                if (event.button !== 0) return;
                focusPaneInGroup(pane.paneId, group);
              }}
              onDragStart={(event) => onTabDragStart(event, pane.paneId, group)}
              onDragEnd={onTabDragEnd}
            >
              <FileText size={14} className="reader-tab-icon" />
              <span className="reader-tab-title" title={title}>
                {title}
              </span>
              <button
                className="reader-tab-close"
                type="button"
                aria-label="Close document"
                title="Close document"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  closePane(pane.paneId);
                }}
              >
                <X size={13} />
              </button>
            </div>
          );
        })}
        {showSplitButton && openPanes.length > 1 ? (
          <button
            type="button"
            className="reader-split-btn"
            aria-label="Split view"
            title="Split view"
            disabled={!splitAllowed}
            onClick={onSplit}
          >
            <Columns2 size={14} />
          </button>
        ) : null}
      </div>
    );
  }

  if (!isSplit || !leftActivePane || !rightActivePane) {
    return (
      <SourceViewerView
        ctx={groupedCtx}
        tabStrip={renderTabStrip("left", openPanes, true)}
        pane={focusedPane ? { paneId: focusedPane.paneId, sourceId: focusedPane.sourceId } : undefined}
      />
    );
  }

  const leftPct = clampSplitRatio(normalizedSplit.ratio) * 100;
  const splitStyle = {
    "--source-split-left": `calc(${leftPct}% - 3px)`,
    "--source-split-right": `calc(${100 - leftPct}% - 3px)`
  } as CSSProperties;

  return (
    <div className="source-split" ref={splitRef} style={splitStyle}>
      <div
        className="source-split-pane source-split-left"
        onMouseDownCapture={() => focusGroup("left")}
        onFocusCapture={() => focusGroup("left")}
      >
        <SourceViewerView
          ctx={groupedCtx}
          tabStrip={renderTabStrip("left", leftPanes)}
          pane={{ paneId: leftActivePane.paneId, sourceId: leftActivePane.sourceId }}
        />
      </div>
      <div
        className="source-split-divider"
        role="separator"
        aria-orientation="vertical"
        onPointerDown={onDividerDown}
      />
      <div
        className="source-split-pane source-split-right"
        onMouseDownCapture={() => focusGroup("right")}
        onFocusCapture={() => focusGroup("right")}
      >
        <SourceViewerView
          ctx={groupedCtx}
          tabStrip={renderTabStrip("right", rightPanes)}
          pane={{ paneId: rightActivePane.paneId, sourceId: rightActivePane.sourceId }}
        />
      </div>
    </div>
  );
}

registerView({ kind: "source.tabs", render: (_node, ctx) => <SourceTabs ctx={ctx} /> });

export { SourceTabs };
