// actionIcon — the ONE place a ToolbarAction is mapped to its lucide glyph, so every
// action surface (the Anchor Action Bar, the selection/source toolbars) shows the same
// icon for the same action. It merges the per-slot icon dictionaries that used to be
// inlined in SelectionToolbar/SourceActionsToolbar (built-in kit icon NAMES like
// sparkles / list-checks / triangle-alert / bookmark / star) into a single map.
//
// Custom Operations carry no icon name; they DO carry an `outputType` (the note
// contentType they produce), so we reuse the central note-type glyph map for a
// meaningful icon. Anything still unresolved falls back to the generic wand.
//
// R6 polish — a per-action ICON OVERRIDE: the user can pick any glyph from the curated
// `ICON_CHOICES` set (the icon picker in operationViews). The chosen NAME is parked on
// `action.icon` (the three context memos set `icon: prefs.icons?.[id] ?? <existing>`),
// so it is resolved here FIRST — against ICON_CHOICES (the picker's source set) and the
// legacy kit dictionary — before the operation/outputType + wand fallback. ICON_CHOICES
// is the single set both the picker AND this resolver share.

import {
  BookOpen,
  Bookmark,
  Brain,
  Check,
  FileText,
  Flag,
  Hash,
  Highlighter,
  Layers,
  Lightbulb,
  Link,
  ListChecks,
  MessageSquare,
  Pencil,
  Quote,
  Scissors,
  Sparkles,
  Star,
  TriangleAlert,
  Wand2,
  type LucideIcon
} from "lucide-react";
import { noteTypeIcon } from "../notes/noteTypeIcon";
import type { ToolbarAction } from "./WorkspaceContext";

// The curated, ORDERED icon set the picker offers AND the resolver looks names up against
// (single source of truth). Names match lucide's kebab-case ids so they read the same in
// the prefs file. Includes every legacy kit dictionary name (sparkles / list-checks /
// triangle-alert / bookmark / star) so an override can also pick a built-in's own glyph.
export const ICON_CHOICES: { name: string; Icon: LucideIcon }[] = [
  { name: "sparkles", Icon: Sparkles },
  { name: "wand-2", Icon: Wand2 },
  { name: "list-checks", Icon: ListChecks },
  { name: "check", Icon: Check },
  { name: "triangle-alert", Icon: TriangleAlert },
  { name: "flag", Icon: Flag },
  { name: "bookmark", Icon: Bookmark },
  { name: "star", Icon: Star },
  { name: "highlighter", Icon: Highlighter },
  { name: "pencil", Icon: Pencil },
  { name: "file-text", Icon: FileText },
  { name: "book-open", Icon: BookOpen },
  { name: "message-square", Icon: MessageSquare },
  { name: "quote", Icon: Quote },
  { name: "brain", Icon: Brain },
  { name: "lightbulb", Icon: Lightbulb },
  { name: "scissors", Icon: Scissors },
  { name: "link", Icon: Link },
  { name: "hash", Icon: Hash },
  { name: "layers", Icon: Layers }
];

// Name → icon lookup over the curated set (the override + picker share this).
const ICON_CHOICE_MAP: Record<string, LucideIcon> = Object.fromEntries(
  ICON_CHOICES.map((choice) => [choice.name, choice.Icon])
);

// Built-in kit icon NAMES (the `icon` presentation hint a KitSurfaceItem carries) →
// concrete lucide icons. The union of the SelectionToolbar + SourceActionsToolbar maps.
// Kept for any legacy kit hint not in ICON_CHOICES (ICON_CHOICES is checked first).
const ICON_NAMES: Record<string, LucideIcon> = {
  sparkles: Sparkles,
  "list-checks": ListChecks,
  "triangle-alert": TriangleAlert,
  bookmark: Bookmark,
  star: Star
};

/** The lucide icon for a merged action. An icon NAME on the action (a user OVERRIDE from
    the picker, or a built-in's kit hint) wins — resolved against the curated ICON_CHOICES
    set first, then the legacy kit dictionary. Otherwise a custom op's note-type glyph (by
    outputType), else the generic wand. */
export function actionIcon(action: ToolbarAction): LucideIcon {
  if (action.icon) {
    const named = ICON_CHOICE_MAP[action.icon] ?? ICON_NAMES[action.icon];
    if (named) return named;
  }
  if (action.kind === "operation") {
    return action.outputType ? noteTypeIcon(action.outputType) : Wand2;
  }
  return Wand2;
}
