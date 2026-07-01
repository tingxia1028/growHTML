// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import type { ReactElement, ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AnyAnchor, NoteRecord } from "../data/entityClient";
import type { WorkspaceContextValue } from "./WorkspaceContext";

let mockWorkspace: WorkspaceContextValue;

vi.mock("./WorkspaceContext", () => ({
  useWorkspace: () => mockWorkspace,
  // The shared ArtifactCard (rendered inside NoteListPanel) reads the null-safe hook.
  useWorkspaceOptional: () => mockWorkspace
}));

import { NoteListPanel } from "./NoteListPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(node: ReactNode): { container: HTMLElement; root: Root; cleanup: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node as ReactElement));
  return {
    container,
    root,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    }
  };
}

function note(id: string, anchorId: string): NoteRecord {
  return {
    id,
    anchorIds: [anchorId],
    layerIds: [],
    conceptIds: [],
    visibility: "private",
    contentType: "markdown",
    content: id
  } as NoteRecord;
}

function anchor(id: string): AnyAnchor {
  return {
    id,
    sourceId: "source_1",
    anchorKind: "html_selection",
    quote: id
  } as AnyAnchor;
}

describe("NoteListPanel focused note", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    HTMLElement.prototype.scrollIntoView = vi.fn();
    const notes = [note("note_1", "anchor_1"), note("note_2", "anchor_2")];
    mockWorkspace = {
      visibleNotes: notes,
      anchors: [anchor("anchor_1"), anchor("anchor_2")],
      focus: {
        focus: { type: "note", noteId: "note_1" },
        setAnchor: vi.fn()
      },
      dispatch: vi.fn(),
      sourceLayers: []
    } as unknown as WorkspaceContextValue;
  });

  it("marks the focused note card active and scrolls it into the note viewer", () => {
    const { container, cleanup } = mount(<NoteListPanel collapsible={false} />);

    const activeRow = container.querySelector('.note-list-row.active[data-note-id="note_1"]');
    expect(activeRow).toBeTruthy();
    expect(container.querySelector('.note-list-row.active[data-note-id="note_2"]')).toBeNull();
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });

    cleanup();
  });

  it("opens a collapsible note viewer when a note is focused", () => {
    const { container, cleanup } = mount(<NoteListPanel collapsible defaultOpen={false} />);

    expect(container.querySelector(".note-list-body")).toBeTruthy();
    expect(container.querySelector(".note-list-head")?.getAttribute("aria-expanded")).toBe("true");

    cleanup();
  });
});
