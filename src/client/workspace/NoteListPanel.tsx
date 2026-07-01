// NoteListPanel — the right-sidebar "Notes" sub-tab (a collapsed-by-default fold, the
// user's "折叠的子页签"). The Growte IA rebuild removed the source-side note list; this
// restores it inside the right column's Anchor pane as a COLLAPSIBLE section so it costs
// only a header line until opened. It lists the active source's VISIBLE notes (the layer
// filter applies) as the §10 shared PreviewCards — click a card → CenterView; the row's
// crosshair reveals the note's passage in the reader; pencil edits it in place; the trash
// deletes it. Bookmarks are excluded (they surface as chips in the Bookmarks pane, not as
// content cards). ONE render path: every card is an ArtifactCard (getNoteType().render,
// mode:"card"); editing reuses the SAME registry editor the composer used
// (getNoteType().edit) so card · overlay · editor all flow through the registry.
//
// It collaborates only through `useWorkspace()` — like every other workspace view — so it
// can be dropped into any pane without prop threading.

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Crosshair, Pencil, StickyNote, Trash2 } from "lucide-react";
import { useWorkspace } from "./WorkspaceContext";
import { ArtifactCard } from "./ArtifactCard";
import { getNoteType } from "../notes/noteTypeRegistry";
import { BOOKMARK_CONTENT_TYPE } from "../../core/notes/contentTypes";

export function NoteListPanel({
  defaultOpen = false,
  collapsible = true
}: {
  defaultOpen?: boolean;
  /** When false, the list is a FULL panel (always open, static header) — used as the
      right-sidebar "Page Anchors" tab. When true (default), it's a collapsible fold. */
  collapsible?: boolean;
}) {
  const { visibleNotes, anchors, focus, dispatch, sourceLayers } = useWorkspace();
  const [open, setOpen] = useState(collapsible ? defaultOpen : true);
  const expanded = collapsible ? open : true;
  const focusedNoteId = focus.focus?.type === "note" ? focus.focus.noteId : "";
  const focusedRowRef = useRef<HTMLDivElement | null>(null);
  // Edit-in-place: the id of the note being edited + a working copy of its content
  // (seeded from the note, discarded on Cancel). null = not editing any row.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<unknown>(undefined);

  // Content notes only (bookmarks render as chips elsewhere). Newest first so a
  // just-added chat reply / note lands at the top where the user is looking.
  const listed = visibleNotes
    .filter((note) => (note.contentType ?? "markdown") !== BOOKMARK_CONTENT_TYPE)
    .slice()
    .reverse();

  const startEdit = (noteId: string, content: unknown) => {
    setEditingId(noteId);
    setDraft(content);
  };
  const cancelEdit = () => {
    setEditingId(null);
    setDraft(undefined);
  };
  const saveEdit = (noteId: string) => {
    void dispatch("note.edit", { noteId, content: draft });
    cancelEdit();
  };

  useEffect(() => {
    if (focusedNoteId && collapsible) setOpen(true);
  }, [focusedNoteId, collapsible]);

  useEffect(() => {
    if (!focusedNoteId || !expanded) return;
    focusedRowRef.current?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [focusedNoteId, expanded, listed.length]);

  return (
    <section className={`note-list-panel${collapsible ? "" : " note-list-panel-tab"}`}>
      {collapsible ? (
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
      ) : (
        // Full-panel form: the SAME shared panel header the Anchor/Layers panes use
        // (.panel-title with an icon + title), so the Notes sub-page reads consistently.
        <div className="panel-title note-list-panel-title">
          <StickyNote size={16} />
          Notes
          <span className="note-list-count">{listed.length}</span>
        </div>
      )}

      {expanded ? (
        listed.length ? (
          <div className="note-list-body">
            {listed.map((note) => {
              const contentType = note.contentType ?? "markdown";
              const anchorId = note.anchorIds[0];
              const anchor = anchorId ? anchors.find((item) => item.id === anchorId) : undefined;
              const page = anchor && "page" in anchor ? (anchor as { page?: number }).page : undefined;
              const layer = note.layerIds[0]
                ? sourceLayers.find((item) => item.id === note.layerIds[0])?.title
                : "My Notes";
              const plugin = getNoteType(contentType);
              const editing = editingId === note.id;

              // Edit-in-place via the SAME registry editor the composer used (contract
              // law §0.5 / contract guard) — only when the type has an editor registered.
              if (editing && plugin) {
                return (
                  <div
                    key={note.id}
                    ref={note.id === focusedNoteId ? focusedRowRef : undefined}
                    className={`note-list-row note-list-row-editing${note.id === focusedNoteId ? " active" : ""}`}
                    data-note-id={note.id}
                  >
                    <div className="note-edit-inline">
                      {plugin.edit({ content: draft, onChange: setDraft })}
                      <div className="note-list-row-actions note-list-edit-actions">
                        <button
                          type="button"
                          className="note-edit-save"
                          title="Save changes"
                          onClick={() => saveEdit(note.id)}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          className="note-edit-cancel"
                          title="Discard changes"
                          onClick={cancelEdit}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={note.id}
                  ref={note.id === focusedNoteId ? focusedRowRef : undefined}
                  className={`note-list-row${note.id === focusedNoteId ? " active" : ""}`}
                  data-note-id={note.id}
                >
                  <ArtifactCard
                    block={{
                      contentType,
                      content: note.content,
                      note,
                      page: page ?? undefined,
                      layer,
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
                    {plugin ? (
                      <button
                        type="button"
                        className="note-list-row-edit note-edit-start"
                        title="Edit this note"
                        aria-label="Edit note"
                        onClick={() => startEdit(note.id, note.content)}
                      >
                        <Pencil size={14} />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="note-list-row-delete note-delete"
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
