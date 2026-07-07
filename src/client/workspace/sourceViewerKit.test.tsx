// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactNode } from "react";
import type { SourceRecord } from "../data/entityClient";
import type { WorkspaceContext } from "./viewRegistry";

vi.mock("./readerForSource", () => ({ readerForSource: () => null }));
vi.mock("./BookmarkIndex", () => ({ BookmarkIndex: () => null }));
vi.mock("./HideAllNotesToggle", () => ({ HideAllNotesToggle: () => null }));
vi.mock("./ExportNotesButton", () => ({ ExportNotesButton: () => null }));
vi.mock("../DiagramNote", () => ({ DiagramNote: () => null }));

import { SourceViewerView } from "./views";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(node: ReactNode): { container: HTMLElement; cleanup: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => root.render(node));
  return {
    container,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    }
  };
}

function source(id: string, title: string, activeKitIds: string[]): SourceRecord {
  return {
    id,
    title,
    sourceType: "pdf",
    path: "",
    contentHash: id,
    metadata: { activeKitIds }
  };
}

function selectValue(select: HTMLSelectElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("SourceViewerView - per-pane Product Kit selector", () => {
  it("renders and writes the kit for the pane's source instead of the globally focused source", () => {
    const left = source("left", "Math", ["kit-math"]);
    const right = source("right", "English", ["kit-english"]);
    const focusPane = vi.fn();
    const setSourceKit = vi.fn(async () => {});
    const kitIdsForSource = vi.fn((item: SourceRecord | null) => {
      const ids = item?.metadata?.activeKitIds;
      return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
    });
    const ctx = {
      activeSource: left,
      anchors: [],
      error: "",
      paintAnchors: [],
      revealAnchors: [],
      focus: {
        anchor: null,
        revealSeq: 0,
        setDraft: vi.fn(),
        setAnchor: vi.fn(),
        setFocus: vi.fn()
      },
      renderedHtml: "",
      annotationMode: "margin",
      kitIdsForSource,
      installedKits: [
        { id: "kit-math", name: "Math Kit", icon: "calculator" },
        { id: "kit-english", name: "English Kit", icon: "book-open" }
      ],
      setSourceKit,
      setActiveSourceId: vi.fn(),
      canForkActiveSource: false,
      forkActiveSource: vi.fn(),
      sourceForPane: (paneId: string) => (paneId === "pane:right" ? right : left),
      paintAnchorsForPane: () => ({ paintAnchors: [], revealAnchors: [] }),
      renderedHtmlForPane: () => "",
      focusPane,
      openLocalFile: vi.fn()
    } as unknown as WorkspaceContext;

    const { container, cleanup } = mount(
      <SourceViewerView
        ctx={ctx}
        tabStrip={<div className="reader-tabs" />}
        pane={{ paneId: "pane:right", sourceId: "right" }}
      />
    );

    const select = container.querySelector<HTMLSelectElement>(".kit-toolbar-native-select")!;
    expect(select.value).toBe("kit-english");
    expect(kitIdsForSource).toHaveBeenCalledWith(right);

    act(() => selectValue(select, "core"));
    expect(focusPane).toHaveBeenCalledWith("pane:right");
    expect(setSourceKit).toHaveBeenCalledWith("right", "core");

    cleanup();
  });
});
