// useBookmarks (R8) — the ONE shared seam for bookmark data + jump, consumed by BOTH
// the `bookmark.list` pane (bookmarkViews.tsx) and the hover-reveal BookmarkIndex. It
// is NOT a parallel data path: it reads only the WorkspaceContext (IRON LAW) and reuses
// the exact filter + jump the Bookmarks pane already used —
//   • bookmarks  = visibleNotes filtered to contentType "bookmark" (same OR-filtered set,
//                  so a hidden layer's bookmark is excluded here too);
//   • jump       = focus.setAnchor(the anchor matching the note's first anchorId);
//   • isJumpable = that anchor is present in ctx.anchors (layer painting may filter it out);
//   • currentAnchorId = the focused anchor's id, for highlighting the active row.
//
// It takes the ctx explicitly so the pane (handed a ctx) and the BookmarkIndex (which
// calls useWorkspace()) share identical behavior with no second source of truth.

import { useCallback, useEffect, useMemo } from "react";
import { BOOKMARK_CONTENT_TYPE } from "../../core/notes/contentTypes";
import type { NoteRecord } from "../data/entityClient";
import { setRecentCategories } from "../notes/recentCategories";
import { distinctCategories } from "./groupBookmarks";
import type { WorkspaceContextValue } from "./WorkspaceContext";

export type UseBookmarks = {
  /** The visible bookmark notes (OR-filtered, same as the Bookmarks pane). */
  bookmarks: NoteRecord[];
  /** Jump to a bookmark's passage by focusing its anchor (no-op if absent/unknown). */
  jump(anchorId: string | undefined): void;
  /** Whether an anchor id is present in ctx.anchors (so the jump can land). */
  isJumpable(anchorId: string | undefined): boolean;
  /** The currently focused anchor id (for highlighting the active row), or undefined. */
  currentAnchorId: string | undefined;
};

export function useBookmarks(ctx: WorkspaceContextValue): UseBookmarks {
  const { visibleNotes, anchors, focus } = ctx;

  const bookmarks = useMemo(
    () => visibleNotes.filter((note) => (note.contentType ?? "") === BOOKMARK_CONTENT_TYPE),
    [visibleNotes]
  );

  // Publish the distinct categories so the bookmark editor's <datalist> can offer
  // recently-used categories (the editor plugin has no ctx access — see recentCategories).
  useEffect(() => {
    setRecentCategories(distinctCategories(bookmarks));
  }, [bookmarks]);

  const isJumpable = useCallback(
    (anchorId: string | undefined) => !!anchorId && anchors.some((a) => a.id === anchorId),
    [anchors]
  );

  const jump = useCallback(
    (anchorId: string | undefined) => {
      if (!anchorId) return;
      const anchor = anchors.find((a) => a.id === anchorId);
      if (anchor) focus.setAnchor(anchor);
    },
    [anchors, focus]
  );

  return { bookmarks, jump, isJumpable, currentAnchorId: focus.anchor?.id };
}
