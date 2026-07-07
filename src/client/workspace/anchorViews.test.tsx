// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import type { ReactElement, ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AnyAnchor, NoteRecord, WorkspaceNode } from "../data/entityClient";
import type { FocusContextValue } from "../focus/FocusContext";
import { setLocale } from "../i18n";
import { getAnchorGlyphVisibility, setAnchorGlyphVisibility } from "../markerOverlay";
import { registerSourceRealmDoc, unregisterSourceRealmDoc } from "./sourceRealmDoc";
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
    setLocale("zh");
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

  it("treats a region draft as focused anchor context even without quote text", () => {
    const plugin = getView("anchor.excerpt");
    expect(plugin).toBeTruthy();
    const { ctx } = ctxWithLinkedNote();
    const draft = {
      mode: "region" as const,
      sourceId: "source_1",
      kind: "pdf" as const,
      page: 6,
      rect: [0.1, 0.2, 0.3, 0.4] as [number, number, number, number]
    };
    (ctx.focus as unknown as FocusContextValue).anchor = null;
    (ctx.focus as unknown as FocusContextValue).draft = draft;
    (ctx.focus as unknown as FocusContextValue).focus = { type: "anchor-draft", draft };
    const node = { id: "anchor", kind: "anchor.excerpt" } as WorkspaceNode;
    const { container, cleanup } = mount(<>{plugin!.render(node, ctx)}</>);

    expect(container.querySelector(".anchor-excerpt-empty")).toBeNull();
    expect(container.querySelector(".anchor-excerpt-card.region")).toBeTruthy();
    expect(container.querySelector(".anchor-excerpt-quote")?.textContent).toBe("区域锚点");
    expect((container.querySelector(".anchor-context-jump") as HTMLButtonElement).disabled).toBe(true);
    cleanup();
  });
});

// The global 显示锚点标记 switch (D2 amendment) lives INSIDE the Anchor panel
// content. Flipping it drives the live markerOverlay store (all host overlays
// re-lay-out; guests get it over sv:anchors) and persists via the annotations.ts
// localStorage helper so the choice survives reloads.
describe("anchor panel 显示锚点标记 switch", () => {
  beforeEach(() => {
    setLocale("zh");
    // The switch now drives the FOCUSED source's REALM store (F-1 follow-up) resolved
    // from the sourceRealmDoc registry — register the jsdom document as source_1's realm
    // so the flip is observable via getAnchorGlyphVisibility(document).
    registerSourceRealmDoc("source_1", document);
  });

  afterEach(() => {
    window.localStorage.removeItem("sv-anchor-glyph-markers");
    setAnchorGlyphVisibility(document, true);
    unregisterSourceRealmDoc("source_1", document);
  });

  it("renders in the panel, flips the focused pane's realm glyph store, and persists the choice", () => {
    const plugin = getView("anchor.excerpt");
    expect(plugin).toBeTruthy();
    const { ctx } = ctxWithLinkedNote();
    const node = { id: "anchor", kind: "anchor.excerpt" } as WorkspaceNode;
    const { container, cleanup } = mount(<>{plugin!.render(node, ctx)}</>);

    const button = container.querySelector(".anchor-glyph-switch") as HTMLButtonElement;
    const actions = container.querySelector(".anchor-context-actions") as HTMLElement;
    expect(button).toBeTruthy();
    expect(actions).toBeTruthy();
    expect(actions.querySelector(".anchor-glyph-switch")).toBe(button);
    expect(actions.querySelector(".anchor-context-jump")).toBeTruthy();
    expect(container.querySelector(".anchor-panel-toolbar .anchor-glyph-switch")).toBeNull();
    expect(container.querySelector(".anchor-action-bar > .anchor-glyph-switch")).toBeNull();
    expect(container.querySelector(".anchor-action-bar .action-grid-row")).toBeTruthy();
    expect(container.querySelector(".anchor-action-bar .action-grid-grid")).toBeNull();
    expect(button.getAttribute("aria-pressed")).toBe("true"); // default: anchor glyphs visible

    act(() => button.click());
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(getAnchorGlyphVisibility(document)).toBe(false);
    expect(window.localStorage.getItem("sv-anchor-glyph-markers")).toBe("hidden");

    act(() => button.click());
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(getAnchorGlyphVisibility(document)).toBe(true);
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
    expect(container.querySelector(".anchor-glyph-switch")).toBeTruthy();
    expect(container.querySelector(".anchor-panel-toolbar .anchor-glyph-switch")).toBeTruthy();
    expect(container.querySelector(".anchor-action-bar > .anchor-glyph-switch")).toBeNull();
    cleanup();
  });

  it("renders the marker switch and anchor chrome in English when locale is English", () => {
    setLocale("en");
    const plugin = getView("anchor.excerpt");
    expect(plugin).toBeTruthy();
    const { ctx } = ctxWithLinkedNote();
    const node = { id: "anchor", kind: "anchor.excerpt" } as WorkspaceNode;
    const { container, cleanup } = mount(<>{plugin!.render(node, ctx)}</>);

    const markerButton = container.querySelector(".anchor-glyph-switch") as HTMLButtonElement;
    expect(markerButton.textContent).toBe("");
    expect(markerButton.getAttribute("title")).toBe("Show anchor markers");
    expect(markerButton.getAttribute("aria-label")).toBe("Show anchor markers");
    expect(container.querySelector(".anchor-linked-label")!.textContent).toBe("Linked notes");
    expect((container.querySelector(".anchor-context-jump") as HTMLButtonElement).getAttribute("aria-label")).toBe("Reveal this anchor in the reader");
    expect(container.textContent).not.toContain("Show anchor markers");
    expect(container.textContent).not.toContain("显示锚点标记");
    expect(container.textContent).not.toContain("关联笔记");
    cleanup();
  });
});
