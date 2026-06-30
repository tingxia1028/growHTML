// groupBookmarksByCategory (R8) — a PURE grouping of bookmark notes into category
// sections for the hover-reveal BookmarkIndex (§9.2). Kept free of React/ctx so it is
// unit-testable in isolation.
//
// Rules:
//   • group by `note.content.category` (the optional R8 field on bookmarkSchema);
//   • a missing / blank category lands in a trailing "Ungrouped" section;
//   • named groups come first, ordered ALPHABETICALLY (locale-aware), ungrouped last;
//   • within a group, rows sort by `order` (ascending; absent = +∞) then `label`;
//   • empty groups are omitted (we only ever build a group from a present bookmark).

import type { NoteRecord } from "../data/entityClient";

/** Sentinel category key for bookmarks with no `category`. */
export const UNGROUPED_CATEGORY = "__ungrouped__";

export type BookmarkGroup = {
  /** The category key (UNGROUPED_CATEGORY for the trailing ungrouped section). */
  category: string;
  /** Whether this is the trailing ungrouped section (for the heading label). */
  ungrouped: boolean;
  /** The bookmarks in this section, sorted by order then label. */
  bookmarks: NoteRecord[];
};

function bookmarkContent(note: NoteRecord): { category?: string; order?: number; label?: string } {
  const content = note.content;
  return content && typeof content === "object" ? (content as Record<string, unknown>) : {};
}

function categoryOf(note: NoteRecord): string {
  const raw = bookmarkContent(note).category;
  return typeof raw === "string" && raw.trim() ? raw.trim() : UNGROUPED_CATEGORY;
}

function labelOf(note: NoteRecord): string {
  const raw = bookmarkContent(note).label;
  return typeof raw === "string" ? raw : "";
}

function orderOf(note: NoteRecord): number {
  const raw = bookmarkContent(note).order;
  return typeof raw === "number" ? raw : Number.POSITIVE_INFINITY;
}

export function groupBookmarksByCategory(bookmarks: NoteRecord[]): BookmarkGroup[] {
  const byCategory = new Map<string, NoteRecord[]>();
  for (const note of bookmarks) {
    const key = categoryOf(note);
    const bucket = byCategory.get(key);
    if (bucket) bucket.push(note);
    else byCategory.set(key, [note]);
  }

  const named = Array.from(byCategory.keys())
    .filter((key) => key !== UNGROUPED_CATEGORY)
    .sort((a, b) => a.localeCompare(b));

  const order = [...named];
  if (byCategory.has(UNGROUPED_CATEGORY)) order.push(UNGROUPED_CATEGORY);

  return order.map((category) => ({
    category,
    ungrouped: category === UNGROUPED_CATEGORY,
    bookmarks: (byCategory.get(category) ?? [])
      .slice()
      .sort((a, b) => orderOf(a) - orderOf(b) || labelOf(a).localeCompare(labelOf(b)))
  }));
}

/** The distinct, present categories across a bookmark set (for the editor's datalist). */
export function distinctCategories(bookmarks: NoteRecord[]): string[] {
  const set = new Set<string>();
  for (const note of bookmarks) {
    const key = categoryOf(note);
    if (key !== UNGROUPED_CATEGORY) set.add(key);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}
