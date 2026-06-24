// InspectorRegistry — the plugin seam that maps a FocusTarget's `type` to a React
// renderer for "what is currently focused". It mirrors the ViewRegistry pattern
// (redesign §8 / P5.1): an inspector for a focus kind is registered once, and any
// surface that wants to show details for the current focus resolves it through
// `renderInspector(focus, ctx)` instead of switching on `focus.type` inline.
//
// Iron law (same as views): an inspector reads/writes only through the shared
// WorkspaceContext (Focus / Command / EntityClient-backed) + the focus it is handed.
// It never reaches into a sibling view.

import type { ReactNode } from "react";
import type { FocusTarget } from "../focus/FocusContext";
import type { WorkspaceContextValue } from "../workspace/WorkspaceContext";

export type InspectorContext = WorkspaceContextValue;

export type InspectorPlugin = {
  /** The FocusTarget.type this inspector renders (e.g. "concept", "relation"). */
  targetType: FocusTarget["type"];
  /** Render the focused target against the shared workspace context. */
  render(focus: FocusTarget, ctx: InspectorContext): ReactNode;
};

const registry = new Map<string, InspectorPlugin>();

export function registerInspector(plugin: InspectorPlugin): void {
  registry.set(plugin.targetType, plugin);
}

export function getInspector(targetType: string): InspectorPlugin | undefined {
  return registry.get(targetType);
}

export function listInspectors(): readonly InspectorPlugin[] {
  return Array.from(registry.values());
}

// Resolve + render the inspector for the current focus. No focus, or a focus with no
// registered inspector, renders nothing (the host decides the empty state) — never
// throws, so an un-inspectable focus can't crash the surface.
export function renderInspector(focus: FocusTarget | null, ctx: InspectorContext): ReactNode {
  if (!focus) return null;
  return registry.get(focus.type)?.render(focus, ctx) ?? null;
}
