// @vitest-environment jsdom
// CONCEPT-UX-1 §2/§3 — the ConceptInspector's lightweight interactions:
//   • 关联到…: ONE autocomplete pick creates a relation with kind "related"
//     immediately (the 10-kind form is gone from this surface).
//   • linked-note rows JUMP: reveal the note's anchor in the reader when it belongs
//     to the active source (focus.setAnchor) and focus the note (focus.setFocus).

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactElement, ReactNode } from "react";
import {
  entityClient,
  type AnyAnchor,
  type ConceptRecord,
  type NoteRecord
} from "../data/entityClient";
import { ConceptInspector } from "./ConceptInspector";
import type { InspectorContext } from "./registry";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function concept(id: string, name: string): ConceptRecord {
  return { id, name, aliases: [], description: "", tags: [] };
}

const CONCEPT_A = concept("concept_a", "Render Thread");
const CONCEPT_B = concept("concept_b", "Game Thread");

const ANCHOR: AnyAnchor = {
  id: "anchor_1",
  sourceId: "src_1",
  anchorKind: "html_selection",
  studyId: "p1",
  selector: '[data-study-id="p1"]',
  quote: "passage"
};

const LINKED_NOTE: NoteRecord = {
  id: "note_1",
  sourceId: "src_1",
  anchorIds: ["anchor_1"],
  conceptIds: ["concept_a"],
  contentType: "markdown",
  content: "a linked note",
  visibility: "private",
  layerIds: []
};

function fakeCtx() {
  const setFocus = vi.fn();
  const setAnchor = vi.fn();
  const dispatch = vi.fn(async () => {});
  const ctx = {
    focus: { focus: { type: "concept", conceptId: "concept_a" }, setFocus, setAnchor },
    anchors: [ANCHOR],
    dispatch,
    conceptsVersion: 0,
    refreshConcepts: vi.fn()
  } as unknown as InspectorContext;
  return { ctx, setFocus, setAnchor, dispatch };
}

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

function updateInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function renderInspector(ctx: InspectorContext) {
  const mounted = mount(<ConceptInspector conceptId="concept_a" ctx={ctx} />);
  await act(async () => {}); // flush conceptDetail + concepts + allNotes
  return mounted;
}

beforeEach(() => {
  document.body.innerHTML = "";
  vi.spyOn(entityClient, "conceptDetail").mockResolvedValue({
    concept: CONCEPT_A,
    notes: [LINKED_NOTE],
    relations: []
  });
  vi.spyOn(entityClient, "concepts").mockResolvedValue({ concepts: [CONCEPT_A, CONCEPT_B] });
  vi.spyOn(entityClient, "allNotes").mockResolvedValue({ notes: [LINKED_NOTE] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ConceptInspector — 关联到… (one-pick relation)", () => {
  it("picking a concept in the autocomplete creates a 'related' relation immediately", async () => {
    const { ctx, dispatch } = fakeCtx();
    const { container, cleanup } = await renderInspector(ctx);

    // The old 10-kind form is GONE from this surface.
    expect(container.querySelector(".relation-kind-select")).toBeNull();
    expect(container.querySelector(".relation-target-select")).toBeNull();

    const input = container.querySelector(
      ".concept-relate-input .concept-autocomplete-input"
    ) as HTMLInputElement;
    expect(input).toBeTruthy();
    updateInput(input, "game");
    const option = container.querySelector(".concept-autocomplete-item") as HTMLButtonElement;
    expect(option.textContent).toBe("Game Thread");

    await act(async () => option.click());
    expect(dispatch).toHaveBeenCalledWith("relation.create", {
      fromConceptId: "concept_a",
      toConceptId: "concept_b",
      relationKind: "related"
    });
    cleanup();
  });

  it("the focused concept itself is never offered as a relation target", async () => {
    const { ctx } = fakeCtx();
    const { container, cleanup } = await renderInspector(ctx);
    const input = container.querySelector(
      ".concept-relate-input .concept-autocomplete-input"
    ) as HTMLInputElement;
    updateInput(input, "render");
    expect(container.querySelectorAll(".concept-relate-input .concept-autocomplete-item").length).toBe(0);
    cleanup();
  });
});

describe("ConceptInspector — linked-note rows jump", () => {
  it("clicking a linked note reveals its anchor in the reader AND focuses the note", async () => {
    const { ctx, setAnchor, setFocus } = fakeCtx();
    const { container, cleanup } = await renderInspector(ctx);

    const row = container.querySelector(".concept-note-item") as HTMLButtonElement;
    expect(row).toBeTruthy();
    act(() => row.click());

    expect(setAnchor).toHaveBeenCalledWith(ANCHOR);
    expect(setFocus).toHaveBeenCalledWith({ type: "note", noteId: "note_1" });
    cleanup();
  });

  it("a note whose anchor is NOT on the active source still focuses the note (no reveal)", async () => {
    const { ctx, setAnchor, setFocus } = fakeCtx();
    (ctx as unknown as { anchors: AnyAnchor[] }).anchors = [];
    const { container, cleanup } = await renderInspector(ctx);

    const row = container.querySelector(".concept-note-item") as HTMLButtonElement;
    act(() => row.click());

    expect(setAnchor).not.toHaveBeenCalled();
    expect(setFocus).toHaveBeenCalledWith({ type: "note", noteId: "note_1" });
    cleanup();
  });
});
