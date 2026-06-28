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

import { Bookmark } from "lucide-react";
import { BOOKMARK_CONTENT_TYPE } from "../../core/notes/contentTypes";
import { getNoteType } from "../notes/noteTypeRegistry";
import { registerView, type WorkspaceContext } from "./viewRegistry";

function BookmarksView({ ctx }: { ctx: WorkspaceContext }) {
  const { visibleNotes, anchors, focus, activeSourceId } = ctx;
  // Filter to bookmark notes only — the same OR-filtered `visibleNotes` the note list
  // uses, so a hidden layer's bookmark doesn't show here either.
  const bookmarks = visibleNotes.filter((note) => (note.contentType ?? "") === BOOKMARK_CONTENT_TYPE);
  const plugin = getNoteType(BOOKMARK_CONTENT_TYPE);

  // Jump to the bookmark's passage by focusing its anchor. setAnchor needs the anchor
  // RECORD (cached for context/painting), so resolve it from ctx.anchors by the note's
  // first anchorId; guard when layer painting filtered the anchor out (no jump).
  const jump = (anchorId: string | undefined) => {
    if (!anchorId) return;
    const anchor = anchors.find((a) => a.id === anchorId);
    if (anchor) focus.setAnchor(anchor);
  };

  return (
    <aside className="bookmark-panel">
      <div className="panel-title">
        <Bookmark size={16} />
        Bookmarks
      </div>

      <div className="bookmark-list record-list">
        {bookmarks.map((note) => {
          const anchorId = note.anchorIds[0];
          const jumpable = !!anchorId && anchors.some((a) => a.id === anchorId);
          return (
            <button
              key={note.id}
              type="button"
              className="bookmark-row"
              data-note-id={note.id}
              disabled={!jumpable}
              title={jumpable ? "Jump to this bookmark" : "This bookmark's passage isn't visible"}
              onClick={() => jump(anchorId)}
            >
              {plugin ? plugin.render({ content: note.content, note }) : null}
            </button>
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
