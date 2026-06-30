// NoteListPanel — the right-sidebar "Notes" sub-tab (a collapsed-by-default fold, the
// user's "折叠的子页签"). The Growte IA rebuild removed the source-side note list; this
// restores it inside the right column's Anchor pane as a COLLAPSIBLE section so it costs
// only a header line until opened. It lists the active source's VISIBLE notes (the layer
// filter applies) as the §10 shared PreviewCards — click a card → CenterView; the row's
// crosshair reveals the note's passage in the reader; the trash deletes it. Bookmarks are
// excluded (they surface as chips in the Bookmarks pane, not as content cards). ONE
// render path: every card is an ArtifactCard (getNoteType().render, mode:"card").
//
// It collaborates only through `useWorkspace()` — like every other workspace view — so it
// can be dropped into any pane without prop threading.

import { useState } from "react";
import { ChevronDown, ChevronRight, Crosshair, StickyNote, Trash2 } from "lucide-react";
import { useWorkspace } from "./WorkspaceContext";
import { ArtifactCard } from "./ArtifactCard";
import { BOOKMARK_CONTENT_TYPE } from "../../core/notes/contentTypes";

export function NoteListPanel({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const { visibleNotes, anchors, focus, dispatch } = useWorkspace();
  const [open, setOpen] = useState(defaultOpen);

  // Content notes only (bookmarks render as chips elsewhere). Newest first so a
  // just-added chat reply / note lands at the top where the user is looking.
  const listed = visibleNotes
    .filter((note) => (note.contentType ?? "markdown") !== BOOKMARK_CONTENT_TYPE)
    .slice()
    .reverse();

  return (
    <section className="note-list-panel">
      <button
        type="button"
        className="note-list-head"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        <StickyNote size={15} />
        <span className="note-list-head-label">Notes</span>
        <span className="note-list-count">{listed.length}</span>
      </button>

      {open ? (
        listed.length ? (
          <div className="note-list-body">
            {listed.map((note) => {
              const anchorId = note.anchorIds[0];
              const anchor = anchorId ? anchors.find((item) => item.id === anchorId) : undefined;
              const page = anchor && "page" in anchor ? (anchor as { page?: number }).page : undefined;
              return (
                <div key={note.id} className="note-list-row">
                  <ArtifactCard
                    block={{
                      contentType: note.contentType ?? "markdown",
                      content: note.content,
                      note,
                      page: page ?? undefined,
                      onJumpToAnchor: anchor ? () => focus.setAnchor(anchor) : undefined
                    }}
                  />
                  <div className="note-list-row-actions">
                    {anchor ? (
                      <button
                        type="button"
                        className="note-list-row-jump"
                        title="Reveal this note's passage in the reader"
                        aria-label="Reveal in reader"
                        onClick={() => focus.setAnchor(anchor)}
                      >
                        <Crosshair size={14} />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="note-list-row-delete"
                      title="Delete this note"
                      aria-label="Delete note"
                      onClick={() => void dispatch("note.delete", { noteId: note.id })}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="note-list-empty">No notes yet. Ask the AI or select a passage to add one.</p>
        )
      ) : null}
    </section>
  );
}
