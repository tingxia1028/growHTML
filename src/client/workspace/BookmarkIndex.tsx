// BookmarkIndex: the click-open table of contents in the Source Viewer header.
// The header icon opens the panel; clicking outside closes it.

import { useEffect, useRef, useState } from "react";
import { Check, FolderOpen, List, Pencil, Trash2, X } from "lucide-react";
import type { NoteRecord } from "../data/entityClient";
import { useWorkspace } from "./WorkspaceContext";
import { useBookmarks } from "./useBookmarks";
import { groupBookmarksByCategory } from "./groupBookmarks";

type BookmarkContent = {
  label: string;
  color?: string;
  order?: number;
  category?: string;
};

type EditingBookmark = {
  noteId: string;
  label: string;
  category: string;
};

function asBookmarkContent(content: unknown): BookmarkContent {
  const raw = content && typeof content === "object" ? (content as Record<string, unknown>) : {};
  return {
    label: typeof raw.label === "string" ? raw.label : "",
    color: typeof raw.color === "string" ? raw.color : undefined,
    order: typeof raw.order === "number" ? raw.order : undefined,
    category: typeof raw.category === "string" ? raw.category : undefined
  };
}

function bookmarkLabel(content: unknown): string {
  const label = asBookmarkContent(content).label.trim();
  return label || "Untitled bookmark";
}

export function BookmarkIndex() {
  const ctx = useWorkspace();
  const { bookmarks, jump, isJumpable, currentAnchorId } = useBookmarks(ctx);
  const groups = groupBookmarksByCategory(bookmarks);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<EditingBookmark | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = () => {
      setOpen(false);
      setEditing(null);
    };
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function startEdit(note: NoteRecord) {
    const content = asBookmarkContent(note.content);
    setOpen(true);
    setEditing({
      noteId: note.id,
      label: content.label,
      category: content.category ?? ""
    });
  }

  function saveEdit(note: NoteRecord) {
    if (!editing || editing.noteId !== note.id) return;
    const current = asBookmarkContent(note.content);
    const next: BookmarkContent = {
      ...current,
      label: editing.label.trim() || "Untitled bookmark"
    };
    const category = editing.category.trim();
    if (category) next.category = category;
    else delete next.category;
    setEditing(null);
    void ctx.dispatch("note.edit", { noteId: note.id, content: next });
  }

  function deleteBookmark(note: NoteRecord) {
    if (editing?.noteId === note.id) setEditing(null);
    void ctx.dispatch("note.delete", { noteId: note.id });
  }

  return (
    <div
      ref={rootRef}
      className={`bookmark-index${open ? " open" : ""}`}
      data-open={open ? "true" : undefined}
    >
      <button
        type="button"
        className={`bookmark-index-strip${open ? " active" : ""}`}
        aria-label="Bookmarks index"
        title="Bookmarks"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <List size={18} />
      </button>

      <div className="bookmark-index-panel" aria-hidden={open ? undefined : true}>
        <div className="bookmark-index-head">
          <span className="bookmark-index-title">Bookmarks</span>
        </div>

        <div className="bookmark-index-body">
          {groups.length === 0 ? (
            <div className="empty-state">No bookmarks yet.</div>
          ) : (
            groups.map((group) => (
              <div className="bookmark-index-group" key={group.category}>
                <div className="bookmark-index-label">
                  <FolderOpen size={13} />
                  <span>{group.ungrouped ? "Ungrouped" : group.category}</span>
                </div>
                {group.bookmarks.map((note) => {
                  const anchorId = note.anchorIds[0];
                  const jumpable = isJumpable(anchorId);
                  const active = !!anchorId && anchorId === currentAnchorId;
                  const label = bookmarkLabel(note.content);
                  const isEditing = editing?.noteId === note.id;

                  if (isEditing) {
                    return (
                      <form
                        key={note.id}
                        className="bookmark-index-edit"
                        data-note-id={note.id}
                        onSubmit={(event) => {
                          event.preventDefault();
                          saveEdit(note);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            event.preventDefault();
                            setEditing(null);
                          }
                        }}
                      >
                        <div className="bookmark-index-edit-fields">
                          <input
                            className="bookmark-index-edit-input"
                            aria-label="Bookmark title"
                            value={editing.label}
                            autoFocus
                            onChange={(event) =>
                              setEditing((value) =>
                                value && value.noteId === note.id ? { ...value, label: event.target.value } : value
                              )
                            }
                          />
                          <input
                            className="bookmark-index-edit-input"
                            aria-label="Bookmark group"
                            placeholder="Group"
                            value={editing.category}
                            onChange={(event) =>
                              setEditing((value) =>
                                value && value.noteId === note.id ? { ...value, category: event.target.value } : value
                              )
                            }
                          />
                        </div>
                        <div className="bookmark-index-edit-actions">
                          <button type="submit" className="bookmark-index-icon" title="Save" aria-label="Save bookmark">
                            <Check size={13} />
                          </button>
                          <button
                            type="button"
                            className="bookmark-index-icon"
                            title="Cancel"
                            aria-label="Cancel bookmark edit"
                            onClick={() => setEditing(null)}
                          >
                            <X size={13} />
                          </button>
                        </div>
                      </form>
                    );
                  }

                  return (
                    <div
                      key={note.id}
                      className={`bookmark-index-item${active ? " active" : ""}`}
                      data-note-id={note.id}
                    >
                      <button
                        type="button"
                        className="bookmark-index-row"
                        disabled={!jumpable}
                        title={jumpable ? `Jump to ${label}` : "This bookmark's passage isn't visible"}
                        onClick={() => jump(anchorId)}
                      >
                        {label}
                      </button>
                      <div className="bookmark-index-actions">
                        <button
                          type="button"
                          className="bookmark-index-icon"
                          title="Edit bookmark"
                          aria-label="Edit bookmark"
                          onClick={() => startEdit(note)}
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          type="button"
                          className="bookmark-index-icon danger"
                          title="Delete bookmark"
                          aria-label="Delete bookmark"
                          onClick={() => deleteBookmark(note)}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
