// Bookmarks Kit (bookmark-modeling.md — the Bookmark V1 jump strip as a KIT LENS) — a
// register-only ProductKit. It invents NO core entities and registers NO content spec:
// the `bookmark` contentType + its NoteType chip render are CORE built-ins, and the
// `useBookmarks` hook stays a SHARED core hook (it also feeds the reader's hover-reveal
// BookmarkIndex). The kit contributes ONLY the bookmark.list browse LENS — a source-scoped
// jump strip over the active source's bookmark notes.
//
// KIT-vs-core: the ONLY core touches are the register-only `productKits` one-liner
// (clientKits.tsx) + the bookmark.list shell import. The VIEW self-registerViews
// (BookmarkListView.tsx, shell-imported — the report.list / mistake.book precedent; the
// `views` kit sink is a dead phase-3 collector). Its Cmd+K launch is the CORE
// commandEntries.ts NAV entry (`open:bookmark.list`), NOT a kit command. Mirrors
// bookmarksKit's minimal shape after mistakePhotoKit / studyReportKit.

import type { ProductKit } from "../types";

export const bookmarksKit: ProductKit = {
  id: "bookmarks",
  name: "Bookmarks Kit",
  description:
    "书签:把阅读中标记的书签汇成一条可跳转的书签栏(来源内),点一下即回到对应段落。",
  // No contentSpecs (the `bookmark` type is a CORE built-in), no prompts, no members —
  // the bookmark.list VIEW self-registers (shell-imported), so install is a no-op.
  install() {}
};
