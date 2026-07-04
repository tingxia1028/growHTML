// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { ReactElement, ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AnyAnchor, NoteRecord } from "../data/entityClient";
import { setLocale } from "../i18n";
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
    setLocale("zh");
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

  it("distinguishes concept marker notes with a chip-style row", () => {
    const marker = {
      ...note("note_marker", "anchor_1"),
      conceptIds: ["concept_1"],
      content: "anchor_1"
    };
    mockWorkspace = {
      ...mockWorkspace,
      visibleNotes: [marker, note("note_regular", "anchor_2")],
      focus: { focus: null, setAnchor: vi.fn() }
    } as unknown as WorkspaceContextValue;

    const { container, cleanup } = mount(<NoteListPanel collapsible={false} />);

    const markerRow = container.querySelector('.note-list-row[data-note-id="note_marker"]')!;
    expect(markerRow.className).toContain("note-list-row-marker");
    expect(markerRow.getAttribute("data-note-kind")).toBe("concept-marker");
    expect(markerRow.querySelector(".note-list-marker-chip")!.textContent).toBe("知元标记");
    expect(container.querySelector('.note-list-row[data-note-id="note_regular"]')!.className).not.toContain("note-list-row-marker");

    cleanup();
  });

  it("keeps note cards adaptive by overriding the shared 260px preview width", () => {
    const cssPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../styles.css");
    const css = readFileSync(cssPath, "utf8").replace(/\r\n/g, "\n");
    const fixedRule = css.indexOf(".note-list-row .sv-artifact-card.sv-preview-card,\n.anchor-linked-card");
    const adaptiveRule = css.lastIndexOf(".note-list-row .sv-artifact-card.sv-preview-card");

    expect(fixedRule).toBeGreaterThan(-1);
    expect(adaptiveRule).toBeGreaterThan(fixedRule);
    expect(css.slice(adaptiveRule, adaptiveRule + 120)).toContain("max-width: none");
  });
});
