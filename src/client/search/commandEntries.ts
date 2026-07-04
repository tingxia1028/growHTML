// The COMMANDS family of the global-search palette (SEARCH-1; design §1 "命令/视图") —
// the SC-0 adapter idiom: a thin seam that DERIVES palette entries from what is
// registered, injected into the pure engine (the engine never imports a registry).
//
// V1 scope (design §1): navigation commands only — 打开复习/画像/设置… Every entry is
// safely runnable with NO required args because each one is a `navigateShell` target
// (the SHELL-1/2 nav bus): a registered view-kind into the switchable left slot, or
// the onboarding checklist. The command REGISTRY's action commands (anchor.add-note,
// note.delete, …) all require payload/focus context, so they are deliberately NOT
// enumerated here; "/" as the slash-composer passthrough rides SC-1's composer mount.

import { navigateShell, type ShellNavTarget } from "../workspace/shellNav";
import type { Message } from "../i18n";
import { searchMessages } from "./searchMessages";

export type SearchCommandEntry = {
  /** Stable pick id, e.g. "open:review.panel". */
  id: string;
  /** Bilingual display title (resolved with t() at render/match time). */
  title: Message;
  /** Extra match keys beyond the two title locales (en shorthands + zh synonyms). */
  aliases: string[];
  /** The nav target `run` fires. Exposed for tests; run() is the palette's contract. */
  target: ShellNavTarget;
  /** Execute the command (fire-and-forget; false = no shell listening, e.g. tests). */
  run(): boolean;
};

// kind → (title, aliases). Kinds mirror the registered view kinds the IconRail /
// user menu already navigate to (RAIL_ENTRIES + settings.hub + the two views that
// left the rail but stay registered: layer.switcher / bookmark.list).
const NAV_COMMANDS: { kind: string; title: Message; aliases: string[]; modal?: boolean }[] = [
  { kind: "library", title: searchMessages.cmdLibrary, aliases: ["library", "资料库", "文库"] },
  { kind: "concept.list", title: searchMessages.cmdConcepts, aliases: ["concepts", "概念", "知元"] },
  { kind: "operation.manager", title: searchMessages.cmdOperations, aliases: ["operations", "操作", "动作"], modal: true },
  { kind: "plugin.manager", title: searchMessages.cmdPlugins, aliases: ["plugins", "kits", "插件"], modal: true },
  { kind: "review.panel", title: searchMessages.cmdReview, aliases: ["review", "复习"] },
  { kind: "profile.panel", title: searchMessages.cmdProfile, aliases: ["profile", "画像", "记忆"] },
  { kind: "settings.hub", title: searchMessages.cmdSettings, aliases: ["settings", "设置"], modal: true },
  { kind: "layer.switcher", title: searchMessages.cmdLayers, aliases: ["layers", "分层", "层"], modal: true },
  { kind: "bookmark.list", title: searchMessages.cmdBookmarks, aliases: ["bookmarks", "书签"] }
];

/**
 * Enumerate the palette's command entries. A plain function (not a hook): the list
 * is static in V1, but the seam matches slashEntriesFromNoteTypes so a registry-driven
 * derivation (kit-contributed commands, SEARCH-2) can slot in without palette changes.
 */
export function searchCommandEntries(): SearchCommandEntry[] {
  const panes = NAV_COMMANDS.map(({ kind, title, aliases, modal }) => {
    const target: ShellNavTarget = modal ? { type: "modal", kind } : { type: "pane", kind };
    return { id: `open:${kind}`, title, aliases, target, run: () => navigateShell(target) };
  });
  const onboarding: ShellNavTarget = { type: "modal", kind: "onboarding.checklist" };
  return [
    ...panes,
    {
      id: "open:onboarding",
      title: searchMessages.cmdOnboarding,
      aliases: ["onboarding", "help", "引导", "帮助"],
      target: onboarding,
      run: () => navigateShell(onboarding)
    }
  ];
}
