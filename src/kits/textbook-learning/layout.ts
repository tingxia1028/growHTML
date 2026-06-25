// Textbook Kit layout preset (user spec §8). A WorkspaceLayout the kit registers via
// KitInstallContext.layouts. The base WorkspaceShell renders nodes as a left→right
// COLUMN strip (no dock nesting / bottom panels yet), so this is the column
// approximation of the §8 student layout: textbook library + reader + AI tutor/notes
// (the study panel) + learning layers. The full dock (left nav, center reader, right
// tutor, BOTTOM practice/mistakes) and a layout switcher to activate this preset are
// deferred — they need a dock layout engine the base shell doesn't have yet.

import type { WorkspaceLayout } from "../../client/data/entityClient";

export const textbookLearningLayout: WorkspaceLayout = {
  id: "textbook.student-learning",
  name: "Textbook Learning",
  mode: "dock",
  layout: "columns",
  nodes: [
    { id: "library", kind: "library" },
    { id: "source-viewer", kind: "source.viewer" },
    { id: "study", kind: "study" },
    { id: "layers", kind: "layer.switcher" }
  ]
};
