// Textbook Kit surface contributions — the selection toolbar (user spec §6). When a
// passage is in focus, these turn the generic "select → ask/save" surface into the
// textbook learning loop: Explain / Practice / Mistake. Each points at a registered
// command; the host SelectionToolbar renders them and dispatches on click.

import type { KitSurfaceItem } from "../types";

export const textbookSelectionToolbar: KitSurfaceItem[] = [
  {
    commandId: "textbook.explain-concept",
    title: "Explain",
    icon: "sparkles",
    group: "AI Actions",
    priority: 100,
    description: "Explain the focused passage as a study block"
  },
  {
    commandId: "textbook.generate-practice",
    title: "Practice",
    icon: "list-checks",
    group: "Study Actions",
    priority: 90,
    description: "Generate practice questions from this passage"
  },
  {
    commandId: "textbook.mark-as-mistake",
    title: "Mistake",
    icon: "triangle-alert",
    group: "Study Actions",
    priority: 70,
    description: "Log this passage as a mistake for review"
  }
];

// Source-level actions (no passage needed) — the "source-actions" slot, rendered by
// the host SourceActionsToolbar at the top of the study panel. Review Pack belongs
// here, not in the selection toolbar (user spec §16 step 4 is chapter-level).
export const textbookSourceActions: KitSurfaceItem[] = [
  {
    commandId: "textbook.generate-review-pack",
    title: "Review Pack",
    icon: "star",
    group: "Study Actions",
    priority: 100,
    description: "Build a chapter-level review pack for this source"
  }
];
