// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import type { ReactElement, ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AnyAnchor, NoteRecord, WorkspaceNode } from "../data/entityClient";
import type { FocusContextValue } from "../focus/FocusContext";
import { getView } from "./viewRegistry";
import type { WorkspaceContext } from "./viewRegistry";
import "./anchorViews";

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

function ctxWithLinkedNote() {
  const anchor = {
    id: "anchor_1",
    sourceId: "source_1",
    anchorKind: "html_selection",
    quote: "数学广角—优化"
  } as AnyAnchor;
  const note = {
    id: "note_1",
    anchorIds: ["anchor_1"],
    layerIds: [],
    conceptIds: [],
    visibility: "private",
    contentType: "markdown",
    content: "数学广角—优化"
  } as NoteRecord;
  const setAnchor = vi.fn();
  const setFocus = vi.fn();
  const focus = {
    focus: { type: "anchor", anchorId: anchor.id },
    draft: null,
    anchor,
    revealSeq: 0,
    setFocus,
    setDraft: vi.fn(),
    setAnchor,
    clear: vi.fn(),
    materializeAnchor: vi.fn()
  } as unknown as FocusContextValue;

  return {
    anchor,
    note,
    setAnchor,
    setFocus,
    ctx: {
      focus,
      activeSource: { id: "source_1", title: "义务教育教科书", sourceType: "pdf" },
      visibleNotes: [note],
      anchorBarActions: [],
      runAction: vi.fn(),
      generating: false,
      openOperationManager: vi.fn()
    } as unknown as WorkspaceContext
  };
}

describe("anchor.excerpt linked notes", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("clicking a linked note focuses the note viewer and re-reveals the source anchor", () => {
    const plugin = getView("anchor.excerpt");
    expect(plugin).toBeTruthy();
    const { ctx, anchor, note, setAnchor, setFocus } = ctxWithLinkedNote();
    const node = { id: "anchor", kind: "anchor.excerpt" } as WorkspaceNode;
    const { container, cleanup } = mount(<>{plugin!.render(node, ctx)}</>);

    const icon = container.querySelector(".anchor-linked-icon") as HTMLButtonElement;
    expect(icon).toBeTruthy();
    expect(container.querySelector(".anchor-linked-card")).toBeNull();

    act(() => icon.click());

    expect(setAnchor).toHaveBeenCalledWith(anchor);
    expect(setFocus).toHaveBeenCalledWith({ type: "note", noteId: note.id });
    expect(container.querySelector(".anchor-linked-card")).toBeNull();
    cleanup();
  });
});
