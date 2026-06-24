// ViewRegistry — the client plugin seam that maps a WorkspaceNode `kind` to a
// React renderer. The WorkspaceShell walks a layout's nodes and renders each one
// through `getView(node.kind).render(node, ctx)`, so the main UI is no longer
// written as fixed JSX: a panel is a registered view, and adding a new panel means
// registering a plugin + listing its node in a preset — zero edits to App/Shell.
//
// IRON LAW (from the redesign doc): views never talk to each other directly. A view
// reads/writes only through the shared WorkspaceContext (which itself only exposes
// Focus / Command / EntityClient-backed state + actions). The registry hands each
// render the node (its id/kind/params) and that context — nothing else.

import type { ReactNode } from "react";
import type { WorkspaceNode } from "../data/entityClient";
import type { WorkspaceContextValue } from "./WorkspaceContext";

// The context a view renders against. Aliased here so plugins import the view-facing
// name; it is exactly the value `useWorkspace()` returns.
export type WorkspaceContext = WorkspaceContextValue;

export type WorkspaceViewPlugin = {
  /** The node kind this plugin renders (e.g. "library", "source.viewer", "study"). */
  kind: string;
  /** Render the node against the shared workspace context. */
  render(node: WorkspaceNode, ctx: WorkspaceContext): ReactNode;
};

const registry = new Map<string, WorkspaceViewPlugin>();

export function registerView(plugin: WorkspaceViewPlugin): void {
  registry.set(plugin.kind, plugin);
}

export function getView(kind: string): WorkspaceViewPlugin | undefined {
  return registry.get(kind);
}

export function listViews(): readonly WorkspaceViewPlugin[] {
  return Array.from(registry.values());
}

// Render a node through its registered view. An unknown kind is handled gracefully
// (a small inert placeholder) instead of throwing, so a stale/typo'd preset can't
// crash the whole shell.
export function renderNode(node: WorkspaceNode, ctx: WorkspaceContext): ReactNode {
  const plugin = registry.get(node.kind);
  if (!plugin) {
    return (
      <div className="workspace-node-missing" data-kind={node.kind}>
        Unknown view: {node.kind}
      </div>
    );
  }
  return plugin.render(node, ctx);
}
