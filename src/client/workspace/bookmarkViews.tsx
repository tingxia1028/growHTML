// Bookmarks workspace view (Bookmark V1) — a lightweight "Bookmarks" strip, kept
// DISTINCT from the note-card list. A bookmark IS a note (contentType "bookmark");
// this pane filters the source's visible notes to that type and renders each as a
// jump-target ROW (the bespoke chip from the bookmark NoteType plugin, click-to-jump).
// Bookmarks are filtered OUT of the main note list (views.tsx) so they read as
// markers, not content cards. See docs/design/bookmark-modeling.md.
//
// Like the other panes it is ADDITIVE (its own pane node) and talks only through the
// WorkspaceContext + the note registry. Jumping reuses existing machinery: the row's
// note carries an anchorId, and clicking calls focus.setAnchor on the matching anchor
// from ctx.anchors (which scrolls/selects it and the reader repaints from paintAnchors).

import { Bookmark, Trash2 } from "lucide-react";
import { BOOKMARK_CONTENT_TYPE } from "../../core/notes/contentTypes";
import { getNoteType } from "../notes/noteTypeRegistry";
import { registerView, type WorkspaceContext } from "./viewRegistry";
import { useBookmarks } from "./useBookmarks";

function BookmarksView({ ctx }: { ctx: WorkspaceContext }) {
  const { activeSourceId, dispatch } = ctx;
  // The bookmark data + jump come from the ONE shared hook (R8), so this pane and the
  // hover-reveal BookmarkIndex stay behavior-identical with no parallel data path.
  const { bookmarks, jump, isJumpable } = useBookmarks(ctx);
  const plugin = getNoteType(BOOKMARK_CONTENT_TYPE);

  return (
    <aside className="bookmark-panel">
      <div className="panel-title">
        <Bookmark size={16} />
        Bookmarks
      </div>

      <div className="bookmark-list record-list">
        {bookmarks.map((note) => {
          const anchorId = note.anchorIds[0];
          const jumpable = isJumpable(anchorId);
          return (
            // A bookmark IS a note, so it gets the same delete affordance as any note
            // (dispatch note.delete → confirm → refresh). The jump button KEEPS the
            // `.bookmark-row` class + data-note-id (existing e2e/unit selectors); the
            // delete button is a sibling (a button can't nest a button).
            <div key={note.id} className="bookmark-item">
              <button
                type="button"
                className="bookmark-row"
                data-note-id={note.id}
                disabled={!jumpable}
                title={jumpable ? "Jump to this bookmark" : "This bookmark's passage isn't visible"}
                onClick={() => jump(anchorId)}
              >
                {plugin ? plugin.render({ content: note.content, note }) : null}
              </button>
              <button
                type="button"
                className="link-button bookmark-delete note-delete"
                title="Delete this bookmark"
                aria-label="Delete bookmark"
                onClick={() => void dispatch("note.delete", { noteId: note.id })}
              >
                <Trash2 size={14} />
              </button>
            </div>
          );
        })}
        {bookmarks.length === 0 ? (
          <div className="empty-state">
            {activeSourceId ? "No bookmarks yet." : "Open a source to see its bookmarks."}
          </div>
        ) : null}
      </div>
    </aside>
  );
}

registerView({ kind: "bookmark.list", render: (_node, ctx) => <BookmarksView ctx={ctx} /> });
