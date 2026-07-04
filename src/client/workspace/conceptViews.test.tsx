// @vitest-environment jsdom
// CONCEPT-UX-1 §4 — concept list usability. Covers:
//   • sorting by linked-note count DESC (then updatedAt DESC) with a count badge per row
//   • the client-side name filter (normalized substring, aliases included)
//   • the empty-state guidance line (选中文字 → 标为概念)
// Rendered through the registered view (getView("concept.list")), with the entity
// client's reads spied — the same seam the view uses at runtime.

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactElement, ReactNode } from "react";
import { entityClient, type ConceptRecord, type NoteRecord, type WorkspaceNode } from "../data/entityClient";
import { getView } from "./viewRegistry";
import type { WorkspaceContext } from "./viewRegistry";
import "./conceptViews";
import { conceptNoteCounts, filterConceptsByName, sortConceptsForList } from "./conceptViews";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function concept(id: string, name: string, updatedAt: string, aliases: string[] = []): ConceptRecord {
  return { id, name, aliases, description: "", tags: [], updatedAt } as unknown as ConceptRecord;
}

function note(id: string, conceptIds: string[]): NoteRecord {
  return {
    id,
    anchorIds: [],
    conceptIds,
    contentType: "markdown",
    content: "x",
    visibility: "private",
    layerIds: []
  };
}

// B has 2 linked notes, C has 1, A has 0 → expected order B, C, A.
const CONCEPTS = [
  concept("concept_a", "Attention", "2026-07-03T00:00:00.000Z", ["注意力"]),
  concept("concept_b", "Backprop", "2026-07-01T00:00:00.000Z"),
  concept("concept_c", "Convolution", "2026-07-02T00:00:00.000Z")
];
const NOTES = [
  note("note_1", ["concept_b"]),
  note("note_2", ["concept_b", "concept_c"])
];

function fakeCtx(): WorkspaceContext {
  return {
    focus: { focus: null, setFocus: vi.fn() },
    dispatch: vi.fn(async () => {}),
    conceptsVersion: 0
  } as unknown as WorkspaceContext;
}

function mount(nodeEl: ReactNode): { container: HTMLElement; root: Root; cleanup: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(nodeEl as ReactElement));
  return {
    container,
    root,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    }
  };
}

async function renderConceptList(): Promise<{ container: HTMLElement; cleanup: () => void }> {
  const plugin = getView("concept.list");
  expect(plugin).toBeTruthy();
  const node = { id: "concepts", kind: "concept.list" } as WorkspaceNode;
  const mounted = mount(<>{plugin!.render(node, fakeCtx())}</>);
  await act(async () => {}); // flush the concepts + allNotes load
  return mounted;
}

function updateInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("pure helpers", () => {
  it("conceptNoteCounts joins over the notes' conceptIds", () => {
    const counts = conceptNoteCounts(NOTES);
    expect(counts.get("concept_b")).toBe(2);
    expect(counts.get("concept_c")).toBe(1);
    expect(counts.get("concept_a")).toBeUndefined();
  });

  it("sortConceptsForList: count DESC, then updatedAt DESC", () => {
    const sorted = sortConceptsForList(CONCEPTS, conceptNoteCounts(NOTES));
    expect(sorted.map((item) => item.id)).toEqual(["concept_b", "concept_c", "concept_a"]);
    // Tie on count (0 each) → newer updatedAt first.
    const tied = sortConceptsForList(
      [concept("concept_x", "X", "2026-01-01T00:00:00.000Z"), concept("concept_y", "Y", "2026-06-01T00:00:00.000Z")],
      new Map()
    );
    expect(tied.map((item) => item.id)).toEqual(["concept_y", "concept_x"]);
  });

  it("filterConceptsByName: normalized substring over names AND aliases", () => {
    expect(filterConceptsByName(CONCEPTS, "  BACK ").map((item) => item.id)).toEqual(["concept_b"]);
    expect(filterConceptsByName(CONCEPTS, "注意").map((item) => item.id)).toEqual(["concept_a"]);
    expect(filterConceptsByName(CONCEPTS, "").length).toBe(3);
  });
});

describe("concept.list view", () => {
  it("lists concepts sorted by linked-note count desc with a badge per row", async () => {
    vi.spyOn(entityClient, "concepts").mockResolvedValue({ concepts: CONCEPTS });
    vi.spyOn(entityClient, "allNotes").mockResolvedValue({ notes: NOTES });

    const { container, cleanup } = await renderConceptList();
    const names = Array.from(container.querySelectorAll(".concept-item-name")).map((el) => el.textContent);
    expect(names).toEqual(["Backprop", "Convolution", "Attention"]);
    const badges = Array.from(container.querySelectorAll(".concept-count-badge")).map((el) => el.textContent);
    expect(badges).toEqual(["2", "1", "0"]);
    cleanup();
  });

  it("filters client-side by name; a no-match query shows the no-matches line", async () => {
    vi.spyOn(entityClient, "concepts").mockResolvedValue({ concepts: CONCEPTS });
    vi.spyOn(entityClient, "allNotes").mockResolvedValue({ notes: NOTES });

    const { container, cleanup } = await renderConceptList();
    const filter = container.querySelector(".concept-filter-input") as HTMLInputElement;
    expect(filter).toBeTruthy();

    updateInput(filter, "conv");
    let names = Array.from(container.querySelectorAll(".concept-item-name")).map((el) => el.textContent);
    expect(names).toEqual(["Convolution"]);

    updateInput(filter, "zzz");
    names = Array.from(container.querySelectorAll(".concept-item-name")).map((el) => el.textContent);
    expect(names).toEqual([]);
    expect(container.querySelector(".concept-list .empty-state")?.textContent).toBe("没有匹配的概念。");
    cleanup();
  });

  it("empty vault → ONE guidance line pointing at 标为概念", async () => {
    vi.spyOn(entityClient, "concepts").mockResolvedValue({ concepts: [] });
    vi.spyOn(entityClient, "allNotes").mockResolvedValue({ notes: [] });

    const { container, cleanup } = await renderConceptList();
    expect(container.querySelector(".concept-empty-guidance")?.textContent).toBe("选中文字 → 标为概念");
    cleanup();
  });
});
