// Workspace layout presets. A preset is a WorkspaceLayout-shaped object whose
// `nodes` the WorkspaceShell renders in order through the ViewRegistry. The built-in
// `threePane` reproduces the original hard-coded three-pane UI — library, source
// viewer, study — but now as data, so adding a pane = adding a node here (and
// registering its view) rather than editing JSX.

import type { WorkspaceLayout } from "../data/entityClient";

// The default three-pane workspace: the same library / reader / study layout the app
// always had, expressed as nodes. Order matters — the shell renders them left→right
// into the `.app-shell` grid in this order, so the rendered DOM matches the original
// (library-panel, then reader-panel, then study-panel).
export const threePane: WorkspaceLayout = {
  id: "three-pane",
  name: "Three Pane",
  mode: "dock",
  layout: "three-pane",
  nodes: [
    { id: "library", kind: "library" },
    { id: "source-viewer", kind: "source.viewer" },
    { id: "study", kind: "study" }
  ]
};

// The app's default layout (P5): the original three panes PLUS the concept/relation
// pane on the right. It is `threePane` extended with one additive node, so the
// library/reader/study DOM is byte-for-byte unchanged (existing e2e selectors hold)
// and the new pane simply renders to the right of them. `threePane` is kept as the
// pristine 3-pane reference (used by the shell guardrail test).
export const studyVaultLayout: WorkspaceLayout = {
  ...threePane,
  id: "study-vault",
  name: "Study Vault",
  nodes: [...threePane.nodes, { id: "concepts", kind: "concept.list" }]
};
