// Workspace layout presets. A preset pairs `nodes` (the view instances) with a `layout`
// DOCK TREE the WorkspaceShell renders. The built-in `threePane` reproduces the original
// hard-coded three-pane UI — library | reader (flex) | study — now expressed as a dock
// tree, so changing the arrangement = editing the tree (and listing the node) rather
// than editing JSX. Sizes here are the initial widths (px) or "flex" for the absorber.

import type { WorkspaceLayout } from "../data/entityClient";
import { leaf, split, type DockNode } from "./dock";

// library | source-viewer (flex) | study — a single row, matching the original DOM.
const threePaneDock: DockNode = split("row", [
  { size: 300, node: leaf("library") },
  { size: "flex", node: leaf("source-viewer") },
  { size: 380, node: leaf("study") }
]);

export const threePane: WorkspaceLayout = {
  id: "three-pane",
  name: "Three Pane",
  mode: "dock",
  nodes: [
    { id: "library", kind: "library" },
    { id: "source-viewer", kind: "source.viewer" },
    { id: "study", kind: "study" }
  ],
  layout: threePaneDock
};

// The app default (P5 + V2): the three panes PLUS the concept/relation pane and the
// Study Layer switcher, still a single row so the existing DOM order is unchanged.
const studyVaultDock: DockNode = split("row", [
  { size: 300, node: leaf("library") },
  { size: "flex", node: leaf("source-viewer") },
  { size: 380, node: leaf("study") },
  { size: 240, node: leaf("bookmarks") },
  { size: 340, node: leaf("concepts") },
  { size: 280, node: leaf("layers") },
  { size: 320, node: leaf("operations") }
]);

export const studyVaultLayout: WorkspaceLayout = {
  id: "study-vault",
  name: "Study Vault",
  mode: "dock",
  nodes: [
    ...threePane.nodes,
    // Bookmark V1 jump strip — additive pane, like concepts/layers.
    { id: "bookmarks", kind: "bookmark.list" },
    { id: "concepts", kind: "concept.list" },
    // V2 Study Layer switcher — additive pane, like concepts.
    { id: "layers", kind: "layer.switcher" },
    // operation-as-data builder + manager — additive pane, like concepts/layers.
    { id: "operations", kind: "operation.manager" }
  ],
  layout: studyVaultDock
};

// Textbook Learning layout (user spec §8): a NESTED dock tree — the center column is a
// `column` split so the reader sits above a Practice panel (the bottom-panel case the
// flat row layouts can't express). nav = library, reader = source.viewer (flex), the
// bottom panel = the Textbook practice view, right = study (AI tutor/chat).
const studentDock: DockNode = split("row", [
  { size: 260, node: leaf("library") },
  {
    size: "flex",
    node: split("column", [
      { size: "flex", node: leaf("source-viewer") },
      { size: 240, node: leaf("practice") }
    ])
  },
  { size: 380, node: leaf("study") }
]);

export const studentLearningLayout: WorkspaceLayout = {
  id: "student-learning",
  name: "Textbook Learning",
  mode: "dock",
  nodes: [
    { id: "library", kind: "library" },
    { id: "source-viewer", kind: "source.viewer" },
    { id: "practice", kind: "practice" },
    { id: "study", kind: "study" }
  ],
  layout: studentDock
};

// The switchable presets + the default. The layout switcher (reader header) lists these;
// `activeLayoutId` (persisted in WorkspaceContext) picks one. studyVault stays default so
// the app opens exactly as before.
export const LAYOUT_PRESETS: WorkspaceLayout[] = [studyVaultLayout, threePane, studentLearningLayout];
export const DEFAULT_LAYOUT_ID = studyVaultLayout.id;

export function getLayoutPreset(id: string): WorkspaceLayout {
  return LAYOUT_PRESETS.find((preset) => preset.id === id) ?? studyVaultLayout;
}
