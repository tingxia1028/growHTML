// SourceTabs — the multi-document reader host (F1 / P-A1). ONE dock leaf renders a tab
// strip over the open panes + the focused pane's reader body, mirroring RightSidebarTabs'
// "one host view hosting N sub-panes" precedent (NOT a new `tabs` DockNode variant — that
// is deferred to keep the layout engine untouched, per the build spec's ground truth).
//
// The tab strip renders one `.reader-tab` per OpenPane; clicking a tab focuses its pane
// (focus-follows-pane), the × closes it. It is handed to SourceViewerView as its
// `tabStrip` so it renders in the SAME `.reader-header > .reader-tabs` slot the built-in
// single tab used — a SINGLE open pane therefore produces the SAME
// `.reader-tab`/`.reader-tab-title`/`.reader-tab-close` chrome (the e2e selectors are
// unchanged). In V1 the BODY shows the focused pane only (per-pane split + independent
// bodies land in the later F1 commits). Views talk only through the WorkspaceContext.

import { FileText, X } from "lucide-react";
import { registerView, type WorkspaceContext } from "./viewRegistry";
import { SourceViewerView } from "./views";

function SourceTabs({ ctx }: { ctx: WorkspaceContext }) {
  const { openPanes, focusedPaneId, focusPane, closePane, sourceForPane } = ctx;
  // The pane whose body renders (V1: the focused pane; the split lands in a later commit).
  const bodyPane =
    openPanes.find((p) => p.paneId === focusedPaneId) ?? openPanes[0] ?? null;

  // One tab per open pane (single pane ⇒ exactly the old chrome). No pane open → the same
  // `.reader-tab-empty` placeholder the built-in strip renders.
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
          return (
            <div
              key={pane.paneId}
              className={`reader-tab${isActive ? " active" : ""}`}
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
      </div>
    );

  // The focused pane's reader body, bound to ITS source (P-A2), with the multi-pane strip
  // injected into the header. No open pane → the focused-pane globals (empty state).
  return (
    <SourceViewerView
      ctx={ctx}
      tabStrip={tabStrip}
      pane={bodyPane ? { paneId: bodyPane.paneId, sourceId: bodyPane.sourceId } : undefined}
    />
  );
}

registerView({ kind: "source.tabs", render: (_node, ctx) => <SourceTabs ctx={ctx} /> });

export { SourceTabs };
