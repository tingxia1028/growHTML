// BottomBar — the THIRD action surface (R6.2): a single horizontal strip that exposes BOTH
// the anchor-scope and source-scope actions at once (the inline toolbar + Anchor Bar are
// scoped; this is the always-reachable "everything" bar). It's a registered view (kind
// "action.bar") so a layout preset COULD dock it at the bottom — but it is intentionally
// NOT placed in any preset yet (R6.3 docks it); registering it just makes the surface exist.
//
// It reads EVERYTHING from the workspace context (IRON LAW — no sibling/state reach-in): the
// merged action lists, runAction, and the `generating` flag. Like the other surfaces it only
// RENDERS + TRIGGERS — the row grid fires runAction, the More menu mirrors the grouped list;
// no result render path lives here (adaptive-note contract).

import { registerView, type WorkspaceContext } from "./viewRegistry";
import { ActionGrid } from "./ActionGrid";
import { ActionMoreMenu } from "./ActionMoreMenu";
import type { ToolbarAction } from "./WorkspaceContext";

// Merge two action lists, keeping the first occurrence of each id (an action can be both
// anchor- and source-scope only by id collision, which we never want to render twice).
function dedupById(actions: ToolbarAction[]): ToolbarAction[] {
  const seen = new Set<string>();
  const out: ToolbarAction[] = [];
  for (const action of actions) {
    if (seen.has(action.id)) continue;
    seen.add(action.id);
    out.push(action);
  }
  return out;
}

function BottomBar({ ctx }: { ctx: WorkspaceContext }) {
  const { selectionActions, sourceActions, runAction, generating } = ctx;
  const items = dedupById([...selectionActions, ...sourceActions]);

  return (
    <div className="action-bottom-bar" role="toolbar" aria-label="Action bar">
      <ActionGrid density="row" items={items} onRun={runAction} disabled={false} busy={generating} />
      <ActionMoreMenu items={items} onRun={runAction} busy={generating} surface="bottom" />
    </div>
  );
}

registerView({ kind: "action.bar", render: (_node, ctx) => <BottomBar ctx={ctx} /> });
