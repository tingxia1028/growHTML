// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import type { ReactElement, ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AnyAnchor, NoteRecord, WorkspaceNode } from "../data/entityClient";
import type { FocusContextValue } from "../focus/FocusContext";
import { getAnchorGlyphVisibility, setAnchorGlyphVisibility } from "../markerOverlay";
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

// The global 显示锚点标记 switch (D2 amendment) lives INSIDE the Anchor panel
// content. Flipping it drives the live markerOverlay store (all host overlays
// re-lay-out; guests get it over sv:anchors) and persists via the annotations.ts
// localStorage helper so the choice survives reloads.
describe("anchor panel 显示锚点标记 switch", () => {
  afterEach(() => {
    window.localStorage.removeItem("sv-anchor-glyph-markers");
    setAnchorGlyphVisibility(true);
  });

  it("renders in the panel, flips the live glyph store, and persists the choice", () => {
    const plugin = getView("anchor.excerpt");
    expect(plugin).toBeTruthy();
    const { ctx } = ctxWithLinkedNote();
    const node = { id: "anchor", kind: "anchor.excerpt" } as WorkspaceNode;
    const { container, cleanup } = mount(<>{plugin!.render(node, ctx)}</>);

    const input = container.querySelector(".anchor-glyph-switch-input") as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.checked).toBe(true); // default: anchor glyphs visible

    act(() => input.click());
    expect(input.checked).toBe(false);
    expect(getAnchorGlyphVisibility()).toBe(false);
    expect(window.localStorage.getItem("sv-anchor-glyph-markers")).toBe("hidden");

    act(() => input.click());
    expect(input.checked).toBe(true);
    expect(getAnchorGlyphVisibility()).toBe(true);
    expect(window.localStorage.getItem("sv-anchor-glyph-markers")).toBe("shown");
    cleanup();
  });

  it("also renders in the empty (no anchor focused) state", () => {
    const plugin = getView("anchor.excerpt");
    const { ctx } = ctxWithLinkedNote();
    (ctx.focus as { anchor: unknown; draft: unknown }).anchor = null;
    (ctx.focus as { anchor: unknown; draft: unknown }).draft = null;
    const node = { id: "anchor", kind: "anchor.excerpt" } as WorkspaceNode;
    const { container, cleanup } = mount(<>{plugin!.render(node, ctx)}</>);
    expect(container.querySelector(".anchor-excerpt-empty")).toBeTruthy();
    expect(container.querySelector(".anchor-glyph-switch-input")).toBeTruthy();
    cleanup();
  });
});
