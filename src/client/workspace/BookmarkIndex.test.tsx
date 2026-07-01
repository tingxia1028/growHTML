// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { AnyAnchor, NoteRecord } from "../data/entityClient";
import type { WorkspaceContextValue } from "./WorkspaceContext";

let mockCtx: WorkspaceContextValue;

vi.mock("./WorkspaceContext", () => ({
  useWorkspace: () => mockCtx
}));

import { BookmarkIndex } from "./BookmarkIndex";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const anchor = {
  id: "anchor_1",
  sourceId: "src_1",
  anchorKind: "html_selection",
  studyId: "p1",
  selector: '[data-study-id="p1"]',
  quote: "passage"
} as AnyAnchor;

function bookmark(content: Record<string, unknown> = {}): NoteRecord {
  return {
    id: "note_b1",
    sourceId: "src_1",
    anchorIds: ["anchor_1"],
    conceptIds: [],
    contentType: "bookmark",
    content: {
      label: "Chapter 1",
      color: "#3b82f6",
      order: 2,
      ...content
    },
    visibility: "visible",
    layerIds: []
  };
}

function makeCtx(dispatch = vi.fn()): WorkspaceContextValue {
  return {
    visibleNotes: [bookmark()],
    anchors: [anchor],
    focus: { anchor: null, setAnchor: vi.fn() },
    dispatch
  } as unknown as WorkspaceContextValue;
}

function renderIndex(ctx: WorkspaceContextValue): { container: HTMLElement; cleanup: () => void } {
  mockCtx = ctx;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<BookmarkIndex />));
  return {
    container,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    }
  };
}

function updateInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("BookmarkIndex", () => {
  it("opens from the contents icon and closes when clicking outside", () => {
    const { container, cleanup } = renderIndex(makeCtx());
    const trigger = container.querySelector(".bookmark-index-strip") as HTMLButtonElement;

    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".bookmark-index-collapse")).toBeNull();
    expect(container.querySelector(".bookmark-index-pin")).toBeNull();

    act(() => trigger.click());
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector(".bookmark-index")?.classList.contains("open")).toBe(true);

    act(() => document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".bookmark-index")?.classList.contains("open")).toBe(false);
    cleanup();
  });

  it("edits a bookmark title and group through note.edit", () => {
    const dispatch = vi.fn();
    const { container, cleanup } = renderIndex(makeCtx(dispatch));

    act(() => (container.querySelector(".bookmark-index-strip") as HTMLButtonElement).click());
    act(() => (container.querySelector('[aria-label="Edit bookmark"]') as HTMLButtonElement).click());
    const [title, group] = Array.from(
      container.querySelectorAll(".bookmark-index-edit-input")
    ) as HTMLInputElement[];
    updateInput(title, "Renamed topic");
    updateInput(group, "Unit A");
    act(() => (container.querySelector('[aria-label="Save bookmark"]') as HTMLButtonElement).click());

    expect(dispatch).toHaveBeenCalledWith("note.edit", {
      noteId: "note_b1",
      content: {
        label: "Renamed topic",
        color: "#3b82f6",
        order: 2,
        category: "Unit A"
      }
    });
    cleanup();
  });

  it("deletes a bookmark through note.delete", () => {
    const dispatch = vi.fn();
    const { container, cleanup } = renderIndex(makeCtx(dispatch));

    act(() => (container.querySelector(".bookmark-index-strip") as HTMLButtonElement).click());
    act(() => (container.querySelector('[aria-label="Delete bookmark"]') as HTMLButtonElement).click());

    expect(dispatch).toHaveBeenCalledWith("note.delete", { noteId: "note_b1" });
    cleanup();
  });
});
