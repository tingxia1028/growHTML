// actionIcon — the ONE place a ToolbarAction is mapped to its lucide glyph, so every
// action surface (the Anchor Action Bar, the selection/source toolbars) shows the same
// icon for the same action. It merges the per-slot icon dictionaries that used to be
// inlined in SelectionToolbar/SourceActionsToolbar (built-in kit icon NAMES like
// sparkles / list-checks / triangle-alert / bookmark / star) into a single map.
//
// Custom Operations carry no icon name; they DO carry an `outputType` (the note
// contentType they produce), so we reuse the central note-type glyph map for a
// meaningful icon. Anything still unresolved falls back to the generic wand.

import { Bookmark, ListChecks, Sparkles, Star, TriangleAlert, Wand2, type LucideIcon } from "lucide-react";
import { noteTypeIcon } from "../notes/noteTypeIcon";
import type { ToolbarAction } from "./WorkspaceContext";

// Built-in kit icon NAMES (the `icon` presentation hint a KitSurfaceItem carries) →
// concrete lucide icons. The union of the SelectionToolbar + SourceActionsToolbar maps.
const ICON_NAMES: Record<string, LucideIcon> = {
  sparkles: Sparkles,
  "list-checks": ListChecks,
  "triangle-alert": TriangleAlert,
  bookmark: Bookmark,
  star: Star
};

/** The lucide icon for a merged action: a built-in's named icon, a custom op's
    note-type glyph (by outputType), else the generic wand. */
export function actionIcon(action: ToolbarAction): LucideIcon {
  if (action.kind === "operation") {
    return action.outputType ? noteTypeIcon(action.outputType) : Wand2;
  }
  return (action.icon && ICON_NAMES[action.icon]) || Wand2;
}
