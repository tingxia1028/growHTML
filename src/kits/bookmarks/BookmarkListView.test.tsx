// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { AnyAnchor, NoteRecord } from "../../client/data/entityClient";
import { getView } from "../../client/workspace/viewRegistry";
import type { WorkspaceContext } from "../../client/workspace/viewRegistry";
// Side-effect imports: register the bookmark NoteType plugin (chip render) + the panel.
import "../../client/notes/builtinNoteTypes";
import "./BookmarkListView";

const anchor: AnyAnchor = {
  id: "anchor_1",
  sourceId: "src_1",
  anchorKind: "html_selection",
  studyId: "p1",
  selector: '[data-study-id="p1"]',
  quote: "passage"
} as AnyAnchor;

function bookmark(id: string, label: string, anchorIds: string[]): NoteRecord {
  return { id, anchorIds, contentType: "bookmark", content: { label }, layerIds: [] } as unknown as NoteRecord;
}

function note(id: string): NoteRecord {
  return { id, anchorIds: ["anchor_1"], contentType: "markdown", content: "a note", layerIds: [] } as unknown as NoteRecord;
}

// Minimal context cast — the panel only reads visibleNotes / anchors / focus / activeSourceId.
function ctxWith(over: Partial<WorkspaceContext>): WorkspaceContext {
  return {
    visibleNotes: [],
    anchors: [],
    activeSourceId: "src_1",
    focus: { setAnchor: vi.fn() },
    dispatch: vi.fn(),
    ...over
  } as unknown as WorkspaceContext;
}

function renderPanel(ctx: WorkspaceContext): { container: HTMLElement; cleanup: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(getView("bookmark.list")!.render({ id: "bookmarks", kind: "bookmark.list" } as never, ctx) as React.ReactElement));
  return { container, cleanup: () => { act(() => root.unmount()); container.remove(); } };
}

describe("bookmark.list view", () => {
  it("renders only bookmark notes, each as a chip row", () => {
    const ctx = ctxWith({
      visibleNotes: [bookmark("note_b1", "Chapter 3", ["anchor_1"]), note("note_m1")],
      anchors: [anchor]
    });
    const { container, cleanup } = renderPanel(ctx);
    const rows = container.querySelectorAll(".bookmark-row");
    expect(rows.length).toBe(1);
    expect(container.querySelector(".sv-bookmark-chip")).toBeTruthy();
    expect(container.textContent).toContain("Chapter 3");
    cleanup();
  });

  it("clicking a row focuses the bookmark's anchor (jump)", () => {
    const setAnchor = vi.fn();
    const ctx = ctxWith({
      visibleNotes: [bookmark("note_b1", "Key", ["anchor_1"])],
      anchors: [anchor],
      focus: { setAnchor } as never
    });
    const { container, cleanup } = renderPanel(ctx);
    act(() => (container.querySelector(".bookmark-row") as HTMLButtonElement).click());
    expect(setAnchor).toHaveBeenCalledWith(anchor);
    cleanup();
  });

  it("disables the row (no jump) when the bookmark's anchor isn't present", () => {
    const setAnchor = vi.fn();
    const ctx = ctxWith({
      visibleNotes: [bookmark("note_b1", "Orphan", ["anchor_missing"])],
      anchors: [],
      focus: { setAnchor } as never
    });
    const { container, cleanup } = renderPanel(ctx);
    const row = container.querySelector(".bookmark-row") as HTMLButtonElement;
    expect(row.disabled).toBe(true);
    cleanup();
  });

  it("deleting a bookmark dispatches note.delete with its id", () => {
    const dispatch = vi.fn();
    const ctx = ctxWith({
      visibleNotes: [bookmark("note_b1", "Key", ["anchor_1"])],
      anchors: [anchor],
      dispatch
    });
    const { container, cleanup } = renderPanel(ctx);
    act(() => (container.querySelector(".bookmark-delete") as HTMLButtonElement).click());
    expect(dispatch).toHaveBeenCalledWith("note.delete", { noteId: "note_b1" });
    cleanup();
  });

  it("shows an empty state when there are no bookmarks", () => {
    const { container, cleanup } = renderPanel(ctxWith({ visibleNotes: [note("note_m1")], anchors: [anchor] }));
    expect(container.querySelector(".bookmark-row")).toBeNull();
    expect(container.textContent).toContain("No bookmarks yet.");
    cleanup();
  });
});
