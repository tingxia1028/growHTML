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

// The app default (R1 "Growte" shell): three regions left→right —
//   library (switchable left slot, ~280) | reader (flex) | RIGHT column (~360).
// The IconRail is CHROME (rendered by WorkspaceShell outside this tree), not a dock leaf.
// The RIGHT column is a nested column split: Anchor excerpt (top) over the Study/AI-Chat
// pane (bottom) — the spec's Anchor / Anchor-Tools / AI-Chat stack, with Anchor-Tools
// folded into the study pane for R1 (the clean three-way split is deferred to R4).
// The previously always-on bookmarks/concepts/layers/operations COLUMNS are gone — they
// are now reached via the IconRail (which swaps the left "library" slot's kind). Their
// nodes stay LISTED so the rail's kind-swap resolves them and they remain reachable.
const studyVaultDock: DockNode = split("row", [
  { size: 250, node: leaf("library") },
  { size: "flex", node: leaf("source-viewer") },
  {
    size: 340,
    node: split("column", [
      { size: 372, node: leaf("anchor") },
      { size: "flex", node: leaf("study") }
    ])
  }
]);

export const studyVaultLayout: WorkspaceLayout = {
  id: "study-vault",
  name: "Study Vault",
  mode: "dock",
  nodes: [
    ...threePane.nodes,
    // The Anchor excerpt section (top of the right column).
    { id: "anchor", kind: "anchor.excerpt" },
    // Bookmark V1 jump strip — now reached via the IconRail, not an always-on column.
    { id: "bookmarks", kind: "bookmark.list" },
    { id: "concepts", kind: "concept.list" },
    // V2 Study Layer switcher — reached via the IconRail.
    { id: "layers", kind: "layer.switcher" },
    // operation-as-data builder + manager — reached via the IconRail.
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
