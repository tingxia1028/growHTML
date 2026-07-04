// @vitest-environment jsdom
// CONCEPT-UX-1 §2 — concept chips + the shared autocomplete. Covers:
//   • ConceptChips renders a note's linked concepts as clickable chips (fixture data)
//     and clicking one NAVIGATES (mock focus callback).
//   • the ＋ autocomplete suggests existing concepts by PREFIX and links the pick;
//     Enter on a no-match name CREATES.
//   • NoteConceptChips (the saved-note host, standalone = no provider) reads
//     note.conceptIds, links an existing concept via entityClient.updateNote (append,
//     never dropping links) and creates+links on Enter.
//   • FocusOverlay mounts the chips row for a SAVED note block.

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactElement, ReactNode } from "react";
import { entityClient, type ConceptRecord, type NoteRecord } from "../data/entityClient";
import "../notes/builtinNoteTypes";
import { ConceptChips, NoteConceptChips } from "./ConceptChips";
import { FocusOverlay } from "./FocusOverlay";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function concept(id: string, name: string): ConceptRecord {
  return { id, name, aliases: [], description: "", tags: [] };
}

const CONCEPTS = [concept("concept_a", "Neural Networks"), concept("concept_b", "Backpropagation")];

function noteFixture(conceptIds: string[] = ["concept_a"]): NoteRecord {
  return {
    id: "note_1",
    sourceId: "src_1",
    anchorIds: [],
    conceptIds,
    contentType: "markdown",
    content: "hello",
    visibility: "private",
    layerIds: []
  };
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

function pressEnter(input: HTMLInputElement) {
  act(() => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
}

beforeEach(() => {
  document.body.innerHTML = "";
  // The FocusOverlay header mounts a SpeakButton whose status probe fetches — stub
  // fetch to reject so it deterministically resolves "unavailable".
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("no network in test")))
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ConceptChips (dumb renderer)", () => {
  it("renders a chip per linked concept and clicking one navigates", () => {
    const onNavigate = vi.fn();
    const { container, cleanup } = mount(
      <ConceptChips
        conceptIds={["concept_a", "concept_b"]}
        concepts={CONCEPTS}
        onNavigate={onNavigate}
        onLink={vi.fn()}
        onCreateAndLink={vi.fn()}
      />
    );
    const chips = Array.from(container.querySelectorAll<HTMLButtonElement>(".concept-chip:not(.concept-chip-add)"));
    expect(chips.map((chip) => chip.textContent)).toEqual(["Neural Networks", "Backpropagation"]);

    act(() => chips[1].click());
    expect(onNavigate).toHaveBeenCalledWith("concept_b");
    cleanup();
  });

  it("＋ autocomplete: prefix-matches existing concepts and links the pick", () => {
    const onLink = vi.fn();
    const { container, cleanup } = mount(
      <ConceptChips conceptIds={[]} concepts={CONCEPTS} onNavigate={vi.fn()} onLink={onLink} onCreateAndLink={vi.fn()} />
    );
    act(() => (container.querySelector(".concept-chip-add") as HTMLButtonElement).click());
    const input = container.querySelector(".concept-autocomplete-input") as HTMLInputElement;
    expect(input).toBeTruthy();

    updateInput(input, "neu");
    const options = Array.from(container.querySelectorAll<HTMLButtonElement>(".concept-autocomplete-item"));
    expect(options.map((option) => option.textContent)).toEqual(["Neural Networks"]);

    act(() => options[0].click());
    expect(onLink).toHaveBeenCalledWith(CONCEPTS[0]);
    cleanup();
  });

  it("＋ autocomplete: Enter on a NO-MATCH name creates", () => {
    const onCreateAndLink = vi.fn();
    const { container, cleanup } = mount(
      <ConceptChips
        conceptIds={[]}
        concepts={CONCEPTS}
        onNavigate={vi.fn()}
        onLink={vi.fn()}
        onCreateAndLink={onCreateAndLink}
      />
    );
    act(() => (container.querySelector(".concept-chip-add") as HTMLButtonElement).click());
    const input = container.querySelector(".concept-autocomplete-input") as HTMLInputElement;

    updateInput(input, "Gradient Descent");
    pressEnter(input);
    expect(onCreateAndLink).toHaveBeenCalledWith("Gradient Descent");
    cleanup();
  });

  it("＋ autocomplete: Enter on an EXACT (case-insensitive) name links instead of creating", () => {
    const onLink = vi.fn();
    const onCreateAndLink = vi.fn();
    const { container, cleanup } = mount(
      <ConceptChips
        conceptIds={[]}
        concepts={CONCEPTS}
        onNavigate={vi.fn()}
        onLink={onLink}
        onCreateAndLink={onCreateAndLink}
      />
    );
    act(() => (container.querySelector(".concept-chip-add") as HTMLButtonElement).click());
    const input = container.querySelector(".concept-autocomplete-input") as HTMLInputElement;

    updateInput(input, "  neural   networks ");
    pressEnter(input);
    expect(onLink).toHaveBeenCalledWith(CONCEPTS[0]);
    expect(onCreateAndLink).not.toHaveBeenCalled();
    cleanup();
  });
});

describe("NoteConceptChips (saved-note host, standalone)", () => {
  it("renders the note's linked concepts from the fixture and links an existing pick via updateNote (append)", async () => {
    vi.spyOn(entityClient, "concepts").mockResolvedValue({ concepts: CONCEPTS });
    const updateNote = vi
      .spyOn(entityClient, "updateNote")
      .mockResolvedValue({ note: noteFixture(["concept_a", "concept_b"]) });

    const { container, cleanup } = mount(<NoteConceptChips note={noteFixture(["concept_a"])} />);
    await act(async () => {});

    // The fixture's linked concept renders as a named chip.
    const chips = Array.from(container.querySelectorAll<HTMLButtonElement>(".concept-chip:not(.concept-chip-add)"));
    expect(chips.map((chip) => chip.textContent)).toEqual(["Neural Networks"]);

    // Link an existing concept through the ＋ autocomplete.
    act(() => (container.querySelector(".concept-chip-add") as HTMLButtonElement).click());
    const input = container.querySelector(".concept-autocomplete-input") as HTMLInputElement;
    updateInput(input, "back");
    const option = container.querySelector(".concept-autocomplete-item") as HTMLButtonElement;
    expect(option.textContent).toBe("Backpropagation");
    await act(async () => option.click());

    // Standalone (no provider) → the entity-client fallback, APPENDING to the note's links.
    expect(updateNote).toHaveBeenCalledWith("note_1", { conceptIds: ["concept_a", "concept_b"] });
    // The new chip appears without a re-fetch.
    const after = Array.from(container.querySelectorAll<HTMLButtonElement>(".concept-chip:not(.concept-chip-add)"));
    expect(after.map((chip) => chip.textContent)).toEqual(["Neural Networks", "Backpropagation"]);
    cleanup();
  });

  it("Enter on a no-match name CREATES the concept and links it", async () => {
    vi.spyOn(entityClient, "concepts").mockResolvedValue({ concepts: CONCEPTS });
    const created = concept("concept_new", "Gradient Descent");
    const createConcept = vi.spyOn(entityClient, "createConcept").mockResolvedValue({ concept: created });
    const updateNote = vi
      .spyOn(entityClient, "updateNote")
      .mockResolvedValue({ note: noteFixture(["concept_a", "concept_new"]) });

    const { container, cleanup } = mount(<NoteConceptChips note={noteFixture(["concept_a"])} />);
    await act(async () => {});

    act(() => (container.querySelector(".concept-chip-add") as HTMLButtonElement).click());
    const input = container.querySelector(".concept-autocomplete-input") as HTMLInputElement;
    updateInput(input, "Gradient Descent");
    await act(async () => pressEnter(input));

    expect(createConcept).toHaveBeenCalledWith({ name: "Gradient Descent" });
    expect(updateNote).toHaveBeenCalledWith("note_1", { conceptIds: ["concept_a", "concept_new"] });
    cleanup();
  });
});

describe("FocusOverlay — the chips row on the note 大窗口", () => {
  it("mounts the concept chips for a SAVED note block (and not for a draft block)", async () => {
    vi.spyOn(entityClient, "concepts").mockResolvedValue({ concepts: CONCEPTS });

    const saved = mount(
      <FocusOverlay
        block={{ contentType: "markdown", content: "hello", note: noteFixture(["concept_a"]) }}
        onClose={() => {}}
      />
    );
    await act(async () => {});
    const row = document.querySelector(".sv-center-concepts");
    expect(row).toBeTruthy();
    expect(row!.querySelector(".concept-chip:not(.concept-chip-add)")?.textContent).toBe("Neural Networks");
    saved.cleanup();

    const draft = mount(<FocusOverlay block={{ contentType: "markdown", content: "hello" }} onClose={() => {}} />);
    expect(document.querySelector(".sv-center-concepts")).toBeNull();
    draft.cleanup();
  });
});
