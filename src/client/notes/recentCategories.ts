// recentCategories — a tiny shared store of the distinct bookmark categories currently
// in the workspace. It exists ONLY to feed the BookmarkEditor's <datalist> of "recently
// used" categories: the editor (a NoteEditInput plugin) has no WorkspaceContext access,
// so the bookmark hook publishes the distinct set here and the editor reads it. This is a
// presentation hint, never a data path — the saved value still flows through note.edit.

let recent: string[] = [];

/** Publish the distinct categories (called by useBookmarks from ctx). */
export function setRecentCategories(categories: string[]): void {
  recent = categories;
}

/** The most recently published distinct categories. */
export function getRecentCategories(): string[] {
  return recent;
}
