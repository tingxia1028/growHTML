// RightSidebarTabs — the right sidebar as a TABBED panel (user request: the right
// column is sub-pages, not a stacked Anchor + AI-Chat with Notes folded under Anchor).
// One dock leaf renders a tab bar over four sub-pages, each an already-registered view:
//   • Anchor        → anchor.excerpt  (the focused-anchor detail)
//   • Page Anchors  → note.list       (this source's notes, each tied to its anchor)
//   • Layers        → layer.switcher  (the per-source layer filter + manager)
//   • AI Chat       → study           (the chat pane)
// Sub-pages render through the SAME registry the dock uses (getView(kind).render), so a
// tab is just a kind — no logic duplicated, IRON LAW intact (views talk only via ctx).

import { useState } from "react";
import type { WorkspaceNode } from "../data/entityClient";
import { getView, registerView, renderNode, type WorkspaceContext } from "./viewRegistry";
import { NoteListPanel } from "./NoteListPanel";

const TABS: ReadonlyArray<{ kind: string; label: string }> = [
  { kind: "anchor.excerpt", label: "Anchor" },
  { kind: "note.list", label: "Page Anchors" },
  { kind: "layer.switcher", label: "Layers" },
  { kind: "study", label: "AI Chat" }
];

function RightSidebarTabs({ node, ctx }: { node: WorkspaceNode; ctx: WorkspaceContext }) {
  const [active, setActive] = useState(TABS[0].kind);
  // A synthetic child node per sub-view (stable id derived from this leaf + the kind),
  // rendered through the registry so each sub-page is exactly the view the dock would
  // mount. Unknown kinds fall back to renderNode's inert placeholder.
  const childNode: WorkspaceNode = { ...node, id: `${node.id}:${active}`, kind: active };
  const plugin = getView(active);

  return (
    <div className="right-tabs">
      <div className="right-tabs-bar" role="tablist" aria-label="Right sidebar">
        {TABS.map((tab) => (
          <button
            key={tab.kind}
            type="button"
            role="tab"
            aria-selected={active === tab.kind}
            className={`right-tabs-tab${active === tab.kind ? " active" : ""}`}
            onClick={() => setActive(tab.kind)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="right-tabs-body" role="tabpanel">
        {plugin ? plugin.render(childNode, ctx) : renderNode(childNode, ctx)}
      </div>
    </div>
  );
}

registerView({ kind: "right.tabs", render: (node, ctx) => <RightSidebarTabs node={node} ctx={ctx} /> });
// The notes list as a FULL sub-page (always-open, static header) — used by the "Page
// Anchors" tab. (The collapsible fold variant is no longer embedded in the Anchor pane.)
registerView({ kind: "note.list", render: () => <NoteListPanel collapsible={false} /> });
