// WorkspaceShell — renders a WorkspaceLayout's nodes through the ViewRegistry into
// the existing `.app-shell` grid, in order. This replaces the hand-written three-pane
// JSX that used to be App's `Workspace` return value: the shell is layout-agnostic
// (it just maps `layout.nodes` → `renderNode`), and the `threePane` preset supplies
// the same library / reader / study nodes. So the rendered DOM is identical, but the
// panes are now data + registered views.
//
// Importing this module also registers the built-in views (via `./views`), so a
// consumer only has to render <WorkspaceShell layout={threePane} /> inside a
// WorkspaceProvider.

import { Fragment } from "react";
import type { WorkspaceLayout } from "../data/entityClient";
import { renderNode } from "./viewRegistry";
import { useWorkspace } from "./WorkspaceContext";
// Side-effect imports: register the built-in view plugins.
//   ./views        → library / source.viewer / study (the original three panes)
//   ./conceptViews → concept.list (the P5 concept/relation pane)
import "./views";
import "./conceptViews";

export function WorkspaceShell({ layout }: { layout: WorkspaceLayout }) {
  const ctx = useWorkspace();
  return (
    <div className="app-shell">
      {layout.nodes.map((node) => (
        <Fragment key={node.id}>{renderNode(node, ctx)}</Fragment>
      ))}
    </div>
  );
}
