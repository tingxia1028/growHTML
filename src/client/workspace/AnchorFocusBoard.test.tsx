// @vitest-environment jsdom
// Component coverage for the Anchor Focus board (N6 / D12). Proves the wiring the pure
// model can't: layout A renders anchors in document order with their notes' PreviewCards;
// layout B buckets notes into the source's stage-layer columns by layerId; the header
// toggle switches layouts; the 只看当前Layer / search filters narrow. The board reads the
// shared WorkspaceContext (stubbed here, the NoteListPanel.test.tsx idiom) and renders
// each note through the shipped §10 PreviewCard (ArtifactCard → getNoteType().render).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import type { ReactElement, ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AnyAnchor, NoteRecord, StudyLayerRecord } from "../data/entityClient";
import { setLocale } from "../i18n";
import type { WorkspaceContextValue } from "./WorkspaceContext";

let mockWorkspace: WorkspaceContextValue;

vi.mock("./WorkspaceContext", () => ({
  useWorkspace: () => mockWorkspace,
  useWorkspaceOptional: () => mockWorkspace
}));

import { AnchorFocusBoard } from "./AnchorFocusBoard";

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

function anchor(id: string, quote: string): AnyAnchor {
  return { id, sourceId: "source_1", anchorKind: "html_selection", quote } as unknown as AnyAnchor;
}

function note(id: string, anchorIds: string[], layerIds: string[], content: string): NoteRecord {
  return {
    id,
    anchorIds,
    conceptIds: [],
    layerIds,
    visibility: "private",
    contentType: "markdown",
    content
  } as unknown as NoteRecord;
}

function layer(id: string, title: string, order: number, color: string): StudyLayerRecord {
  return { id, title, order, color, enabled: true, importMode: "owned", visibility: "private" } as unknown as StudyLayerRecord;
}

const anchors = [anchor("a1", "First anchored passage"), anchor("a2", "Second anchored passage")];
const layers = [layer("L1", "预习", 1, "#00a"), layer("L2", "学习", 2, "#0a0")];
const notes = [
  note("n1", ["a1"], ["L1"], "preview note about photosynthesis"),
  note("n2", ["a2"], ["L2"], "study note about respiration"),
  note("n3", ["a1"], [], "orphan note with no layer")
];

function baseWorkspace(): WorkspaceContextValue {
  return {
    activeSource: { id: "source_1", title: "Biology Ch.4" },
    anchors,
    notes,
    sourceLayers: layers,
    enabledLayerIds: new Set(["L1", "L2"]),
    // ArtifactCard reads pluginPrefs via useWorkspaceOptional; undefined is fine.
    pluginPrefs: undefined
  } as unknown as WorkspaceContextValue;
}

beforeEach(() => {
  setLocale("zh");
  mockWorkspace = baseWorkspace();
});

describe("AnchorFocusBoard", () => {
  it("layout A renders anchors in document order, each with its notes' PreviewCards", () => {
    const { container, cleanup } = mount(<AnchorFocusBoard onClose={() => {}} />);

    // Default layout is document order.
    expect(container.querySelector(".anchor-board")!.getAttribute("data-layout")).toBe("document");
    const rows = Array.from(container.querySelectorAll(".anchor-board-row"));
    expect(rows.map((row) => row.getAttribute("data-anchor-id"))).toEqual(["a1", "a2"]);
    // Row 1 (a1) carries its passage + the shipped PreviewCards for its notes (n1, n3).
    expect(rows[0].querySelector(".anchor-board-quote")!.textContent).toContain("First anchored passage");
    const a1Cards = rows[0].querySelectorAll(".sv-preview-card");
    expect(a1Cards).toHaveLength(2);
    expect(rows[0].textContent).toContain("preview note about photosynthesis");
    // Row 2 (a2) carries n2.
    expect(rows[1].querySelectorAll(".sv-preview-card")).toHaveLength(1);
    expect(rows[1].textContent).toContain("study note about respiration");

    cleanup();
  });

  it("layout B buckets notes into the source's stage-layer columns by layerId", () => {
    const { container, cleanup } = mount(<AnchorFocusBoard onClose={() => {}} />);

    // Switch to the stage-layer layout via the header toggle.
    const layerTab = container.querySelector('.anchor-board-tab[data-layout="layer"]') as HTMLButtonElement;
    act(() => layerTab.click());
    expect(container.querySelector(".anchor-board")!.getAttribute("data-layout")).toBe("layer");

    const columns = Array.from(container.querySelectorAll(".anchor-board-column"));
    // Columns are DATA-DRIVEN from the source's layers (order 1, 2) + the trailing 未分层.
    const titles = columns.map((c) => c.querySelector(".anchor-board-column-title")!.textContent);
    expect(titles).toEqual(["预习", "学习", "未分层"]);

    const colById = (id: string) => container.querySelector(`.anchor-board-column[data-layer-id="${id}"]`)!;
    expect(colById("L1").textContent).toContain("preview note about photosynthesis"); // n1 → 预习
    expect(colById("L2").textContent).toContain("study note about respiration"); // n2 → 学习
    // n3 (no layer) falls into the trailing 未分层 bucket — never lost.
    const unlayered = container.querySelector('.anchor-board-column[data-unlayered="true"]')!;
    expect(unlayered.textContent).toContain("orphan note with no layer");

    cleanup();
  });

  it("the layout toggle switches between the two layouts", () => {
    const { container, cleanup } = mount(<AnchorFocusBoard onClose={() => {}} />);
    const board = () => container.querySelector(".anchor-board")!.getAttribute("data-layout");
    const tab = (which: string) => container.querySelector(`.anchor-board-tab[data-layout="${which}"]`) as HTMLButtonElement;

    expect(board()).toBe("document");
    act(() => tab("layer").click());
    expect(board()).toBe("layer");
    expect(container.querySelectorAll(".anchor-board-column").length).toBeGreaterThan(0);
    act(() => tab("document").click());
    expect(board()).toBe("document");
    expect(container.querySelectorAll(".anchor-board-row").length).toBe(2);

    cleanup();
  });

  it("search narrows the notes (layout A)", () => {
    const { container, cleanup } = mount(<AnchorFocusBoard onClose={() => {}} />);
    const search = container.querySelector(".anchor-board-search-input") as HTMLInputElement;

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(search, "respiration");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // Only n2 (respiration) survives; n1 / n3 are filtered out.
    expect(container.textContent).toContain("study note about respiration");
    expect(container.textContent).not.toContain("preview note about photosynthesis");
    expect(container.textContent).not.toContain("orphan note with no layer");

    cleanup();
  });

  it("只看当前Layer narrows to notes in an enabled layer (layout A)", () => {
    // Only L1 (预习) enabled → n1 shows; n2 (学习/L2) is hidden; n3 (no layer) always shows.
    mockWorkspace = { ...baseWorkspace(), enabledLayerIds: new Set(["L1"]) } as WorkspaceContextValue;
    const { container, cleanup } = mount(<AnchorFocusBoard onClose={() => {}} />);
    const check = container.querySelector(".anchor-board-only-layer-input") as HTMLInputElement;

    act(() => check.click());

    expect(container.textContent).toContain("preview note about photosynthesis"); // n1 (L1)
    expect(container.textContent).toContain("orphan note with no layer"); // n3 (no layer, never orphaned)
    expect(container.textContent).not.toContain("study note about respiration"); // n2 (L2 disabled)

    cleanup();
  });
});
