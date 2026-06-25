// Textbook Kit surface contributions — the selection toolbar (user spec §6). When a
// passage is in focus, these turn the generic "select → ask/save" surface into the
// textbook learning loop: Explain / Practice / Mistake. Each points at a registered
// command; the host SelectionToolbar renders them and dispatches on click.

import type { KitSurfaceItem } from "../types";

export const textbookSelectionToolbar: KitSurfaceItem[] = [
  { commandId: "textbook.explain-concept", title: "Explain", icon: "sparkles", group: "AI Tutor", priority: 100 },
  { commandId: "textbook.generate-practice", title: "Practice", icon: "list-checks", group: "Learning", priority: 90 },
  { commandId: "textbook.mark-as-mistake", title: "Mistake", icon: "triangle-alert", group: "Review", priority: 70 }
];

// Source-level actions (no passage needed) — the "source-actions" slot, rendered by
// the host SourceActionsToolbar at the top of the study panel. Review Pack belongs
// here, not in the selection toolbar (user spec §16 step 4 is chapter-level).
export const textbookSourceActions: KitSurfaceItem[] = [
  { commandId: "textbook.generate-review-pack", title: "Review Pack", icon: "star", group: "Review", priority: 100 }
];
