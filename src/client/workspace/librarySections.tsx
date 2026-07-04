// Library contribution points (LIB-2 §3) — the two small registries the redesigned
// Library pane renders from:
//
//   LibrarySection   — a BODY section of the pane (最近/文档/文件夹 today; kit sections
//                      later). A section is a VIEW over the shared sources, never a
//                      container: uninstalling its contributor removes the section, the
//                      documents remain in 文档 (same law as "Layer 不改变 Source").
//   LibraryAddAction — an entry in the ONE unified `+` menu, grouped 导入/新建. Kits
//                      append creators to 新建 (e.g. 新建课程包) through the same seam.
//
// Core seeds its built-ins through these SAME registries (libraryBuiltins.tsx side-effect
// import — the shell-primitive rule: core-registered, not uninstallable, no bypass), the
// exact idiom builtinNoteTypes uses for the NoteType registry. Registration is idempotent
// by id (a re-imported module overwrites itself); `register*` returns a disposer so a
// fixture/kit can unregister cleanly.

import type { ReactNode } from "react";
import type { LocalizedText } from "../i18n";
import type { WorkspaceContext } from "./viewRegistry";

/** What a section renders against: the shared workspace context + the header search. */
export type LibrarySectionContext = {
  workspace: WorkspaceContext;
  /** The Library header search query, trimmed + lower-cased (empty = no filter). The
      section filters its ITEM TITLES against it (SEARCH-1 will feed this same seam). */
  query: string;
  /** Source rows closed from the Library document list in this panel session. This is
      non-destructive UI state: it does not delete the source from the vault. */
  dismissedSourceIds?: readonly string[];
  dismissSourceId?(sourceId: string): void;
};

export type LibrarySection = {
  id: string;
  title: LocalizedText;
  /** Sort key — built-ins are 10/20/30 so kits can slot between/after. */
  order: number;
  /** Item count for the header badge, AFTER the query filter (drives the empty state). */
  count(ctx: LibrarySectionContext): number;
  /** One guidance line shown when count() === 0 and no search is active. */
  emptyText?: LocalizedText;
  render(ctx: LibrarySectionContext): ReactNode;
};

export type LibraryAddGroup = "import" | "create";

export type LibraryAddAction = {
  id: string;
  group: LibraryAddGroup;
  title: LocalizedText;
  icon?: ReactNode;
  /** Sort key within the group (built-ins 10/20/30). */
  order?: number;
  /** Grey the item out (e.g. desktop-only on web) — shown with `disabledHint`. */
  disabled?(ctx: WorkspaceContext): boolean;
  disabledHint?: LocalizedText;
} & (
  | {
      /** One-shot action. Owns its error handling (the menu fire-and-forgets). */
      run(ctx: WorkspaceContext): void | Promise<void>;
      render?: undefined;
    }
  | {
      /** Inline body instead of a plain button (e.g. the 网页 URL input + fetch/live). */
      render(ctx: WorkspaceContext): ReactNode;
      run?: undefined;
    }
);

const sections = new Map<string, LibrarySection>();
const addActions = new Map<string, LibraryAddAction>();

export function registerLibrarySection(section: LibrarySection): () => void {
  sections.set(section.id, section);
  return () => {
    if (sections.get(section.id) === section) sections.delete(section.id);
  };
}

export function listLibrarySections(): LibrarySection[] {
  return [...sections.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

export function registerLibraryAddAction(action: LibraryAddAction): () => void {
  addActions.set(action.id, action);
  return () => {
    if (addActions.get(action.id) === action) addActions.delete(action.id);
  };
}

export function listLibraryAddActions(): LibraryAddAction[] {
  return [...addActions.values()].sort(
    (a, b) => (a.order ?? 100) - (b.order ?? 100) || a.id.localeCompare(b.id)
  );
}
