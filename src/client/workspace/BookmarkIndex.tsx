// BookmarkIndex (R8, spec §9) — the hover-reveal "table of contents" pinned to the app's
// FAR RIGHT edge. It is CHROME (rendered by WorkspaceShell outside the dock tree), the
// symmetric mirror of the left IconRail, and is INDEPENDENT of the persistent right column
// (§9.3) — the two can coexist.
//
// Interaction:
//   • Collapsed (default): a thin vertical strip with a contents icon. Doesn't eat reading
//     width (it overlays the right edge).
//   • Hover the strip → the panel slides in from the right (CSS translateX transition),
//     OVER content (high z-index). Mouse-leave collapses it.
//   • A pin toggle keeps it open persistently; the pinned flag persists to localStorage
//     (key `sv-bookmark-index-pinned`, the same per-pref pattern the shell uses).
//   • Top of the panel: a « collapse button + the pin toggle.
//
// Content (§9.2): the SAME hook the Bookmarks pane uses (no new fetch — IRON LAW), grouped
// by `content.category` via the pure groupBookmarksByCategory helper. Each row jumps to the
// bookmark's anchor; disabled when the anchor isn't visible; the row whose anchor === the
// focused anchor gets `.active`.

import { useEffect, useState } from "react";
import { ChevronLeft, FolderOpen, List, Pin, PinOff } from "lucide-react";
import { useWorkspace } from "./WorkspaceContext";
import { useBookmarks } from "./useBookmarks";
import { groupBookmarksByCategory } from "./groupBookmarks";

const PINNED_KEY = "sv-bookmark-index-pinned";

function loadPinned(): boolean {
  try {
    return globalThis.localStorage?.getItem(PINNED_KEY) === "true";
  } catch {
    return false;
  }
}

function bookmarkLabel(content: unknown): string {
  if (content && typeof content === "object") {
    const label = (content as Record<string, unknown>).label;
    if (typeof label === "string" && label) return label;
  }
  return "Untitled bookmark";
}

export function BookmarkIndex() {
  const ctx = useWorkspace();
  const { bookmarks, jump, isJumpable, currentAnchorId } = useBookmarks(ctx);
  const groups = groupBookmarksByCategory(bookmarks);

  // Pin = persistent open. Hover = transient open. The panel is open when either is true.
  const [pinned, setPinned] = useState<boolean>(loadPinned);
  const [hovered, setHovered] = useState(false);
  const open = pinned || hovered;

  useEffect(() => {
    try {
      globalThis.localStorage?.setItem(PINNED_KEY, pinned ? "true" : "false");
    } catch {
      // storage unavailable — keep the in-memory flag
    }
  }, [pinned]);

  return (
    <div
      className={`bookmark-index${open ? " open" : ""}${pinned ? " pinned" : ""}`}
      data-open={open ? "true" : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Collapsed strip — the always-present hover target + contents icon. */}
      <button
        type="button"
        className="bookmark-index-strip"
        aria-label="Bookmarks index"
        title="Bookmarks"
        aria-expanded={open}
        onFocus={() => setHovered(true)}
      >
        <List size={18} />
      </button>

      {/* The slide-in panel (always rendered; CSS translateX hides it when closed). */}
      <div className="bookmark-index-panel" aria-hidden={open ? undefined : true}>
        <div className="bookmark-index-head">
          <button
            type="button"
            className="bookmark-index-collapse"
            aria-label="Collapse bookmarks index"
            title="Collapse"
            onClick={() => {
              setHovered(false);
              setPinned(false);
            }}
          >
            <ChevronLeft size={16} />
          </button>
          <span className="bookmark-index-title">Bookmarks</span>
          <button
            type="button"
            className={`bookmark-index-pin${pinned ? " active" : ""}`}
            aria-label={pinned ? "Unpin bookmarks index" : "Pin bookmarks index"}
            aria-pressed={pinned}
            title={pinned ? "Unpin" : "Pin open"}
            onClick={() => setPinned((value) => !value)}
          >
            {pinned ? <PinOff size={15} /> : <Pin size={15} />}
          </button>
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
                  return (
                    <button
                      key={note.id}
                      type="button"
                      className={`bookmark-index-row${active ? " active" : ""}`}
                      data-note-id={note.id}
                      disabled={!jumpable}
                      title={jumpable ? "Jump to this bookmark" : "This bookmark's passage isn't visible"}
                      onClick={() => jump(anchorId)}
                    >
                      {bookmarkLabel(note.content)}
                    </button>
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
