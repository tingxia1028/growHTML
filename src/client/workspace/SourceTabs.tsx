// SourceTabs — the multi-document reader host (F1 / P-A1 + P-A2). ONE dock leaf renders a
// tab strip over the open panes + the focused pane's reader body, mirroring
// RightSidebarTabs' "one host view hosting N sub-panes" precedent (NOT a new `tabs`
// DockNode variant — deferred to keep the layout engine untouched, per the build spec).
//
// The tab strip renders one `.reader-tab` per OpenPane; clicking a tab focuses its pane
// (focus-follows-pane), the × closes it. It is handed to SourceViewerView as its
// `tabStrip` so it renders in the SAME `.reader-header > .reader-tabs` slot the built-in
// single tab used — a SINGLE open pane therefore produces the SAME
// `.reader-tab`/`.reader-tab-title`/`.reader-tab-close` chrome (e2e selectors unchanged).
//
// 分屏 (P-A2): a split button pops a SECOND pane to the side (a self-contained row split
// with a resize divider, mirroring rightSplit.ts — the global dock engine is untouched).
// Both bodies are SourceViewerViews bound to their own pane's source (per-pane paint). The
// HOST-REALM GATE (delta 3) forbids two host-realm bodies (pdfjs/image) side by side.

import { Columns2, FileText, X } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { registerView, type WorkspaceContext } from "./viewRegistry";
import { SourceViewerView } from "./views";
import {
  canSplitConcurrently,
  clampSplitRatio,
  loadSourceSplit,
  saveSourceSplit,
  type SourceSplitState
} from "./sourceSplit";
import { isHostRealmSource } from "../viewers";

function SourceTabs({ ctx }: { ctx: WorkspaceContext }) {
  const { openPanes, focusedPaneId, focusPane, closePane, sourceForPane, activeLayoutId } = ctx;

  // The pane whose body renders as the FOCUSED (left) body.
  const focusedBodyPane = openPanes.find((p) => p.paneId === focusedPaneId) ?? openPanes[0] ?? null;

  // Split state ({ sidePaneId, ratio }) — restored per layout from localStorage on mount.
  const paneIds = openPanes.map((p) => p.paneId);
  const [split, setSplit] = useState<SourceSplitState>(() => loadSourceSplit(activeLayoutId, paneIds));
  useEffect(() => {
    setSplit(loadSourceSplit(activeLayoutId, paneIds));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-restore per layout
  }, [activeLayoutId]);

  function commitSplit(next: SourceSplitState) {
    setSplit(next);
    saveSourceSplit(activeLayoutId, next);
  }

  // The side pane must still be open AND must not be the focused pane (they'd be the same
  // body). Drop a stale/degenerate split so the divider never strands an empty pane.
  const sidePane =
    split.sidePaneId && split.sidePaneId !== focusedBodyPane?.paneId
      ? openPanes.find((p) => p.paneId === split.sidePaneId) ?? null
      : null;
  const isSplit = !!sidePane;

  // The candidate pane the 分屏 button would pop to the side: the first open pane that
  // isn't the focused one. Enabling is gated on the host-realm rule (delta 3): the split
  // is refused when both the focused body and the candidate are host-realm surfaces.
  const splitCandidate = openPanes.find((p) => p.paneId !== focusedBodyPane?.paneId) ?? null;
  const focusedSourceType = focusedBodyPane ? sourceForPane(focusedBodyPane.paneId)?.sourceType : undefined;
  const candidateSourceType = splitCandidate ? sourceForPane(splitCandidate.paneId)?.sourceType : undefined;
  const splitAllowed =
    !isSplit && !!splitCandidate && canSplitConcurrently(focusedSourceType, candidateSourceType);
  const hostRealmBlocked =
    !isSplit && !!splitCandidate && !canSplitConcurrently(focusedSourceType, candidateSourceType);
  const splitTitle = hostRealmBlocked
    ? "PDF/图片文档只能单开一个分屏(用网页/HTML 文档分屏)"
    : "分屏并排(打开第二个文档)";

  function onSplit() {
    if (!splitAllowed || !splitCandidate) return;
    commitSplit({ sidePaneId: splitCandidate.paneId, ratio: split.ratio });
  }
  function mergeBack() {
    commitSplit({ sidePaneId: null, ratio: split.ratio });
  }

  // —— divider resize (pointer based, mirrors RightSidebarTabs.onDividerDown) ——
  const splitRef = useRef<HTMLDivElement | null>(null);
  const ratioRef = useRef(split.ratio);
  ratioRef.current = split.ratio;
  function onDividerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    const el = splitRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const onMove = (e: PointerEvent) => {
      const raw = rect.width > 0 ? (e.clientX - rect.left) / rect.width : ratioRef.current;
      setSplit((prev) => ({ ...prev, ratio: clampSplitRatio(raw) }));
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      setSplit((prev) => {
        saveSourceSplit(activeLayoutId, prev);
        return prev;
      });
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  }

  // One tab per open pane (single pane ⇒ exactly the old chrome). No pane → the same
  // `.reader-tab-empty` placeholder the built-in strip renders. The 分屏 button trails the
  // tabs when a split is available (≥2 panes) — hidden while already split.
  const tabStrip =
    openPanes.length === 0 ? (
      <div className="reader-tabs" role="tablist">
        <div className="reader-tab reader-tab-empty">
          <span className="reader-tab-title">Open or import a source</span>
        </div>
      </div>
    ) : (
      <div className="reader-tabs" role="tablist">
        {openPanes.map((pane) => {
          const source = sourceForPane(pane.paneId);
          const title = source?.title ?? "…";
          const isActive =
            pane.paneId === focusedPaneId ||
            (focusedPaneId === "" && openPanes[0]?.paneId === pane.paneId);
          const isSide = sidePane?.paneId === pane.paneId;
          return (
            <div
              key={pane.paneId}
              className={`reader-tab${isActive ? " active" : ""}${isSide ? " reader-tab-side" : ""}`}
              role="tab"
              aria-selected={isActive}
              onMouseDown={() => focusPane(pane.paneId)}
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
        {!isSplit && openPanes.length > 1 ? (
          <button
            type="button"
            className="reader-split-btn"
            aria-label="Split view"
            title={splitTitle}
            disabled={!splitAllowed}
            data-host-realm-blocked={hostRealmBlocked ? "true" : undefined}
            onClick={onSplit}
          >
            <Columns2 size={14} />
          </button>
        ) : null}
      </div>
    );

  // No split → the single focused-pane body (the pre-split path), strip in its header.
  if (!isSplit || !focusedBodyPane) {
    return (
      <SourceViewerView
        ctx={ctx}
        tabStrip={tabStrip}
        pane={
          focusedBodyPane ? { paneId: focusedBodyPane.paneId, sourceId: focusedBodyPane.sourceId } : undefined
        }
      />
    );
  }

  // Split → two bodies side by side, each bound to its OWN pane's source (per-pane paint).
  // The left (focused) body carries the tab strip; the right (side) body carries a small
  // "merge back" affordance. `ratio` is the LEFT pane's width fraction.
  const leftPct = clampSplitRatio(split.ratio) * 100;
  const splitStyle = {
    "--source-split-left": `calc(${leftPct}% - 3px)`,
    "--source-split-right": `calc(${100 - leftPct}% - 3px)`
  } as CSSProperties;
  const mergeStrip = (
    <div className="reader-tabs" role="tablist">
      <div className="reader-tab active reader-tab-side" role="tab" aria-selected="true">
        <FileText size={14} className="reader-tab-icon" />
        <span className="reader-tab-title" title={sourceForPane(sidePane.paneId)?.title ?? "…"}>
          {sourceForPane(sidePane.paneId)?.title ?? "…"}
        </span>
        <button
          type="button"
          className="reader-tab-close reader-split-merge"
          aria-label="Merge split"
          title="合并分屏"
          onClick={mergeBack}
        >
          <X size={13} />
        </button>
      </div>
    </div>
  );

  return (
    <div className="source-split" ref={splitRef} style={splitStyle}>
      <div className="source-split-pane source-split-left" onMouseDown={() => focusPane(focusedBodyPane.paneId)}>
        <SourceViewerView
          ctx={ctx}
          tabStrip={tabStrip}
          pane={{ paneId: focusedBodyPane.paneId, sourceId: focusedBodyPane.sourceId }}
        />
      </div>
      <div
        className="source-split-divider"
        role="separator"
        aria-orientation="vertical"
        onPointerDown={onDividerDown}
      />
      <div className="source-split-pane source-split-right" onMouseDown={() => focusPane(sidePane.paneId)}>
        <SourceViewerView ctx={ctx} tabStrip={mergeStrip} pane={{ paneId: sidePane.paneId, sourceId: sidePane.sourceId }} />
      </div>
    </div>
  );
}

registerView({ kind: "source.tabs", render: (_node, ctx) => <SourceTabs ctx={ctx} /> });

export { SourceTabs };
// Re-export for tests that assert the gate at the SourceTabs boundary.
export { isHostRealmSource };
