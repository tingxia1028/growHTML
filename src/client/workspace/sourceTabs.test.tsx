// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { WorkspaceContext } from "./viewRegistry";
import type { OpenPane } from "./panes";
import {
  closePane as closePaneModel,
  focusPane as focusPaneModel,
  focusedPane,
  openOrFocusPane,
  switchFocusedPane,
  type PanesState
} from "./panes";

vi.mock("./views", () => ({
  SourceViewerView: ({
    ctx,
    tabStrip,
    pane
  }: {
    ctx: { focusPane?: (paneId: string) => void };
    tabStrip?: ReactNode;
    pane?: { paneId: string; sourceId: string };
  }) => (
    <main className="reader-panel" data-pane-id={pane?.paneId ?? ""}>
      <header className="reader-header">{tabStrip}</header>
      <button
        type="button"
        className="reader-body-focus"
        onMouseDown={() => {
          if (pane) ctx.focusPane?.(pane.paneId);
        }}
      >
        body
      </button>
    </main>
  )
}));

import { getView } from "./viewRegistry";
import "./SourceTabs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(node: ReactNode): { container: HTMLElement; render: (next: ReactNode) => void; cleanup: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => root.render(node as ReactElement));
  return {
    container,
    render: (next: ReactNode) => {
      act(() => root.render(next as ReactElement));
    },
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    }
  };
}

type TestSource = { id: string; title: string; sourceType: string };
type Ctx = WorkspaceContext & {
  openPanes: OpenPane[];
  focusedPaneId: string;
  focusPane: (paneId: string) => void;
  closePane: (paneId: string) => void;
  sourceForPane: (paneId: string) => TestSource | null;
};

function makeCtx(over: Partial<Ctx> & { sourceTypes?: Record<string, string> } = {}): Ctx {
  const titles: Record<string, string> = { "pane:A": "Doc A", "pane:B": "Doc B", "pane:C": "Doc C" };
  const sourceTypes = over.sourceTypes ?? {};
  return {
    activeLayoutId: "test",
    openPanes: [],
    focusedPaneId: "",
    focusPane: vi.fn(),
    closePane: vi.fn(),
    sourceForPane: (paneId: string) => {
      const title = titles[paneId];
      return title
        ? { id: paneId.replace("pane:", ""), title, sourceType: sourceTypes[paneId] ?? "html" }
        : null;
    },
    ...over
  } as unknown as Ctx;
}

const paneA: OpenPane = { paneId: "pane:A", sourceId: "A", viewState: {} };
const paneB: OpenPane = { paneId: "pane:B", sourceId: "B", viewState: {} };
const paneC: OpenPane = { paneId: "pane:C", sourceId: "C", viewState: {} };

function tabByTitle(container: HTMLElement, title: string): HTMLElement {
  return Array.from(container.querySelectorAll<HTMLElement>(".reader-tab")).find(
    (t) => t.querySelector(".reader-tab-title")?.textContent === title
  )!;
}

function titlesIn(group: Element | null): string[] {
  return Array.from(group?.querySelectorAll(".reader-tab-title") ?? []).map((node) => node.textContent ?? "");
}

function fakeDataTransfer(): DataTransfer {
  const store = new Map<string, string>();
  const types: string[] = [];
  return {
    effectAllowed: "all",
    dropEffect: "none",
    types: types as unknown as DOMStringList,
    setData(type: string, value: string) {
      store.set(type, value);
      types.push(type);
    },
    getData(type: string) {
      return store.get(type) ?? "";
    }
  } as unknown as DataTransfer;
}

function dragEvent(type: string, dataTransfer: DataTransfer): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  return event;
}

function StatefulSourceTabs({
  initialState,
  sourceTypes
}: {
  initialState: PanesState;
  sourceTypes?: Record<string, string>;
}) {
  const plugin = getView("source.tabs")!;
  const [state, setState] = useState(initialState);
  const ctx = makeCtx({
    openPanes: state.openPanes,
    focusedPaneId: state.focusedPaneId,
    sourceTypes,
    focusPane: (paneId: string) => setState((current) => focusPaneModel(current, paneId)),
    closePane: (paneId: string) => setState((current) => closePaneModel(current, paneId))
  });
  return <>{plugin.render({ id: "x", kind: "source.tabs" }, ctx)}</>;
}

describe("SourceTabs - multi-document tab strip", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    window.localStorage.clear();
  });

  it("single-pane DOM keeps the reader-tab chrome", () => {
    const plugin = getView("source.tabs");
    expect(plugin).toBeTruthy();
    const ctx = makeCtx({ openPanes: [paneA], focusedPaneId: "pane:A" });
    const { container, cleanup } = mount(<>{plugin!.render({ id: "x", kind: "source.tabs" }, ctx)}</>);

    const strip = container.querySelector(".reader-header > .reader-tabs");
    expect(strip).toBeTruthy();
    const tabs = container.querySelectorAll(".reader-tab");
    expect(tabs).toHaveLength(1);
    const tab = tabs[0];
    expect(tab.classList.contains("active")).toBe(true);
    expect(tab.getAttribute("aria-selected")).toBe("true");
    expect(tab.querySelector(".reader-tab-title")?.textContent).toBe("Doc A");
    expect(tab.querySelector(".reader-tab-close")).toBeTruthy();
    expect(tab.querySelector(".reader-tab-icon")).toBeTruthy();

    cleanup();
  });

  it("renders one tab per open pane and marks the focused pane active", () => {
    const plugin = getView("source.tabs");
    const ctx = makeCtx({ openPanes: [paneA, paneB], focusedPaneId: "pane:B" });
    const { container, cleanup } = mount(<>{plugin!.render({ id: "x", kind: "source.tabs" }, ctx)}</>);

    const titles = Array.from(container.querySelectorAll(".reader-tab-title")).map((n) => n.textContent);
    expect(titles).toEqual(["Doc A", "Doc B"]);
    const active = container.querySelector(".reader-tab.active .reader-tab-title");
    expect(active?.textContent).toBe("Doc B");

    cleanup();
  });

  it("clicking a tab focuses its pane", () => {
    const plugin = getView("source.tabs");
    const focusPane = vi.fn();
    const ctx = makeCtx({ openPanes: [paneA, paneB], focusedPaneId: "pane:A", focusPane });
    const { container, cleanup } = mount(<>{plugin!.render({ id: "x", kind: "source.tabs" }, ctx)}</>);

    const bTab = tabByTitle(container, "Doc B");
    act(() => {
      bTab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(focusPane).toHaveBeenCalledWith("pane:B");

    cleanup();
  });

  it("the close button closes a pane without also focusing it", () => {
    const plugin = getView("source.tabs");
    const focusPane = vi.fn();
    const closePane = vi.fn();
    const ctx = makeCtx({ openPanes: [paneA, paneB], focusedPaneId: "pane:A", focusPane, closePane });
    const { container, cleanup } = mount(<>{plugin!.render({ id: "x", kind: "source.tabs" }, ctx)}</>);

    const bClose = tabByTitle(container, "Doc B").querySelector<HTMLButtonElement>(".reader-tab-close")!;
    act(() => {
      bClose.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(closePane).toHaveBeenCalledWith("pane:B");
    expect(focusPane).not.toHaveBeenCalled();

    cleanup();
  });

  it("renders the empty-state placeholder tab when no pane is open", () => {
    const plugin = getView("source.tabs");
    const ctx = makeCtx({ openPanes: [], focusedPaneId: "" });
    const { container, cleanup } = mount(<>{plugin!.render({ id: "x", kind: "source.tabs" }, ctx)}</>);
    expect(container.querySelector(".reader-tab-empty")).toBeTruthy();
    expect(container.querySelector(".reader-tab-title")?.textContent).toBe("Open or import a source");
    cleanup();
  });

  it("splitting creates left/right tab groups instead of duplicating every tab in the left strip", () => {
    const plugin = getView("source.tabs");
    const focusPane = vi.fn();
    const ctx = makeCtx({ openPanes: [paneA, paneB], focusedPaneId: "pane:A", focusPane });
    const { container, cleanup } = mount(<>{plugin!.render({ id: "x", kind: "source.tabs" }, ctx)}</>);

    const splitBtn = container.querySelector<HTMLButtonElement>(".reader-split-btn");
    expect(splitBtn).toBeTruthy();
    expect(splitBtn!.disabled).toBe(false);
    act(() => {
      splitBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector(".source-split")).toBeTruthy();
    expect(container.querySelector(".source-split-divider")).toBeTruthy();
    expect(container.querySelectorAll(".reader-panel")).toHaveLength(2);
    expect(titlesIn(container.querySelector(".source-tabs-group-left"))).toEqual(["Doc A"]);
    expect(titlesIn(container.querySelector(".source-tabs-group-right"))).toEqual(["Doc B"]);
    expect(focusPane).toHaveBeenCalledWith("pane:B");

    cleanup();
  });

  it("drags a source tab from the left group to the right group", () => {
    const plugin = getView("source.tabs");
    const ctx = makeCtx({ openPanes: [paneA, paneB, paneC], focusedPaneId: "pane:A" });
    const { container, cleanup } = mount(<>{plugin!.render({ id: "x", kind: "source.tabs" }, ctx)}</>);

    act(() => {
      container.querySelector<HTMLButtonElement>(".reader-split-btn")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(titlesIn(container.querySelector(".source-tabs-group-left"))).toEqual(["Doc A", "Doc C"]);
    expect(titlesIn(container.querySelector(".source-tabs-group-right"))).toEqual(["Doc B"]);

    const transfer = fakeDataTransfer();
    act(() => {
      tabByTitle(container, "Doc C").dispatchEvent(dragEvent("dragstart", transfer));
      const right = container.querySelector(".source-tabs-group-right")!;
      right.dispatchEvent(dragEvent("dragover", transfer));
      right.dispatchEvent(dragEvent("drop", transfer));
    });

    expect(titlesIn(container.querySelector(".source-tabs-group-left"))).toEqual(["Doc A"]);
    expect(titlesIn(container.querySelector(".source-tabs-group-right"))).toEqual(["Doc B", "Doc C"]);

    cleanup();
  });

  it("reader body focus in the right group routes through focusPane so sidebar context can follow it", () => {
    const plugin = getView("source.tabs");
    const focusPane = vi.fn();
    const ctx = makeCtx({ openPanes: [paneA, paneB], focusedPaneId: "pane:A", focusPane });
    const { container, cleanup } = mount(<>{plugin!.render({ id: "x", kind: "source.tabs" }, ctx)}</>);

    act(() => {
      container.querySelector<HTMLButtonElement>(".reader-split-btn")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    focusPane.mockClear();
    const rightBody = container.querySelector<HTMLElement>('.reader-panel[data-pane-id="pane:B"] .reader-body-focus')!;
    act(() => {
      rightBody.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });

    expect(focusPane).toHaveBeenCalledWith("pane:B");
    cleanup();
  });

  it("opens a newly added pane into the right group when the right group is active", () => {
    const plugin = getView("source.tabs");
    const focusPane = vi.fn();
    const firstCtx = makeCtx({ openPanes: [paneA, paneB], focusedPaneId: "pane:A", focusPane });
    const mounted = mount(<>{plugin!.render({ id: "x", kind: "source.tabs" }, firstCtx)}</>);

    act(() => {
      mounted.container.querySelector<HTMLButtonElement>(".reader-split-btn")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const focusedRightCtx = makeCtx({ openPanes: [paneA, paneB], focusedPaneId: "pane:B", focusPane });
    mounted.render(<>{plugin!.render({ id: "x", kind: "source.tabs" }, focusedRightCtx)}</>);
    const nextCtx = makeCtx({ openPanes: [paneA, paneB, paneC], focusedPaneId: "pane:C", focusPane });
    mounted.render(<>{plugin!.render({ id: "x", kind: "source.tabs" }, nextCtx)}</>);

    expect(titlesIn(mounted.container.querySelector(".source-tabs-group-left"))).toEqual(["Doc A"]);
    expect(titlesIn(mounted.container.querySelector(".source-tabs-group-right"))).toEqual(["Doc B", "Doc C"]);
    mounted.cleanup();
  });

  it("keeps the left editor group alive when switching the focused left pane to another document", () => {
    const plugin = getView("source.tabs");
    const focusPane = vi.fn();
    const firstCtx = makeCtx({ openPanes: [paneA, paneB], focusedPaneId: "pane:A", focusPane });
    const mounted = mount(<>{plugin!.render({ id: "x", kind: "source.tabs" }, firstCtx)}</>);

    act(() => {
      mounted.container.querySelector<HTMLButtonElement>(".reader-split-btn")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(titlesIn(mounted.container.querySelector(".source-tabs-group-left"))).toEqual(["Doc A"]);
    expect(titlesIn(mounted.container.querySelector(".source-tabs-group-right"))).toEqual(["Doc B"]);

    const switched = switchFocusedPane({ openPanes: [paneA, paneB], focusedPaneId: "pane:A" }, "C");
    const nextCtx = makeCtx({ openPanes: switched.openPanes, focusedPaneId: switched.focusedPaneId, focusPane });
    mounted.render(<>{plugin!.render({ id: "x", kind: "source.tabs" }, nextCtx)}</>);

    expect(mounted.container.querySelector(".source-split")).toBeTruthy();
    expect(mounted.container.querySelectorAll(".reader-panel")).toHaveLength(2);
    expect(titlesIn(mounted.container.querySelector(".source-tabs-group-left"))).toEqual(["Doc C"]);
    expect(titlesIn(mounted.container.querySelector(".source-tabs-group-right"))).toEqual(["Doc B"]);
    mounted.cleanup();
  });

  it("keeps the right editor group alive when switching the focused right pane to another document", () => {
    const plugin = getView("source.tabs");
    const focusPane = vi.fn();
    const firstCtx = makeCtx({ openPanes: [paneA, paneB], focusedPaneId: "pane:A", focusPane });
    const mounted = mount(<>{plugin!.render({ id: "x", kind: "source.tabs" }, firstCtx)}</>);

    act(() => {
      mounted.container.querySelector<HTMLButtonElement>(".reader-split-btn")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const focusedRightCtx = makeCtx({ openPanes: [paneA, paneB], focusedPaneId: "pane:B", focusPane });
    mounted.render(<>{plugin!.render({ id: "x", kind: "source.tabs" }, focusedRightCtx)}</>);
    expect(titlesIn(mounted.container.querySelector(".source-tabs-group-left"))).toEqual(["Doc A"]);
    expect(titlesIn(mounted.container.querySelector(".source-tabs-group-right"))).toEqual(["Doc B"]);

    const switched = switchFocusedPane({ openPanes: [paneA, paneB], focusedPaneId: "pane:B" }, "C");
    const nextCtx = makeCtx({ openPanes: switched.openPanes, focusedPaneId: switched.focusedPaneId, focusPane });
    mounted.render(<>{plugin!.render({ id: "x", kind: "source.tabs" }, nextCtx)}</>);

    expect(mounted.container.querySelector(".source-split")).toBeTruthy();
    expect(mounted.container.querySelectorAll(".reader-panel")).toHaveLength(2);
    expect(titlesIn(mounted.container.querySelector(".source-tabs-group-left"))).toEqual(["Doc A"]);
    expect(titlesIn(mounted.container.querySelector(".source-tabs-group-right"))).toEqual(["Doc C"]);
    mounted.cleanup();
  });

  it("closing left-group tabs does not close the right-group document", () => {
    const { container, cleanup } = mount(
      <StatefulSourceTabs
        initialState={{ openPanes: [paneA, paneB, paneC], focusedPaneId: "pane:A" }}
      />
    );

    act(() => {
      container.querySelector<HTMLButtonElement>(".reader-split-btn")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(titlesIn(container.querySelector(".source-tabs-group-left"))).toEqual(["Doc A", "Doc C"]);
    expect(titlesIn(container.querySelector(".source-tabs-group-right"))).toEqual(["Doc B"]);

    act(() => {
      tabByTitle(container, "Doc A")
        .querySelector<HTMLButtonElement>(".reader-tab-close")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(titlesIn(container.querySelector(".source-tabs-group-left"))).toEqual(["Doc C"]);
    expect(titlesIn(container.querySelector(".source-tabs-group-right"))).toEqual(["Doc B"]);

    act(() => {
      tabByTitle(container, "Doc C")
        .querySelector<HTMLButtonElement>(".reader-tab-close")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector(".source-split")).toBeNull();
    expect(titlesIn(container.querySelector(".reader-tabs"))).toEqual(["Doc B"]);

    cleanup();
  });

  it("allows PDF/image sources to split side by side", () => {
    const plugin = getView("source.tabs");
    const ctx = makeCtx({
      openPanes: [paneA, paneB],
      focusedPaneId: "pane:A",
      sourceTypes: { "pane:A": "pdf", "pane:B": "image" }
    });
    const { container, cleanup } = mount(<>{plugin!.render({ id: "x", kind: "source.tabs" }, ctx)}</>);

    const splitBtn = container.querySelector<HTMLButtonElement>(".reader-split-btn");
    expect(splitBtn).toBeTruthy();
    expect(splitBtn!.disabled).toBe(false);
    expect(splitBtn!.getAttribute("data-host-realm-blocked")).toBeNull();
    act(() => {
      splitBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector(".source-split")).toBeTruthy();
    expect(container.querySelectorAll(".reader-panel")).toHaveLength(2);

    cleanup();
  });

  it("allows PDF/HTML sources to split", () => {
    const plugin = getView("source.tabs");
    const ctx = makeCtx({
      openPanes: [paneA, paneB],
      focusedPaneId: "pane:A",
      sourceTypes: { "pane:A": "pdf", "pane:B": "html" }
    });
    const { container, cleanup } = mount(<>{plugin!.render({ id: "x", kind: "source.tabs" }, ctx)}</>);
    const splitBtn = container.querySelector<HTMLButtonElement>(".reader-split-btn");
    expect(splitBtn!.disabled).toBe(false);
    expect(splitBtn!.getAttribute("data-host-realm-blocked")).toBeNull();
    cleanup();
  });

  it("focus-follows-pane: the derived activeSourceId follows the focused pane", () => {
    let state: PanesState = { openPanes: [], focusedPaneId: "" };
    state = openOrFocusPane(state, "A");
    state = openOrFocusPane(state, "B");
    const shimFor = (s: PanesState) => focusedPane(s.openPanes, s.focusedPaneId)?.sourceId ?? "";
    expect(shimFor(state)).toBe("B");
    state = { openPanes: state.openPanes, focusedPaneId: "pane:A" };
    expect(shimFor(state)).toBe("A");
  });
});
