// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import type { ReactElement, ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { WorkspaceContext } from "./viewRegistry";
import type { OpenPane } from "./panes";
import { focusedPane, openOrFocusPane, type PanesState } from "./panes";

// Mock the heavy reader body: render the injected `tabStrip` verbatim (so we exercise the
// real SourceTabs strip DOM) inside the SAME `.reader-header > .reader-tabs` slot, without
// mounting the reader pipeline (iframe/pdf/etc).
vi.mock("./views", () => ({
  SourceViewerView: ({ tabStrip }: { ctx: unknown; tabStrip?: ReactNode }) => (
    <main className="reader-panel">
      <header className="reader-header">{tabStrip}</header>
    </main>
  )
}));

import { getView } from "./viewRegistry";
import "./SourceTabs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(node: ReactNode): { container: HTMLElement; cleanup: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => root.render(node as ReactElement));
  return {
    container,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    }
  };
}

type Ctx = WorkspaceContext & {
  openPanes: OpenPane[];
  focusedPaneId: string;
  focusPane: (paneId: string) => void;
  closePane: (paneId: string) => void;
  sourceForPane: (paneId: string) => { id: string; title: string } | null;
};

function makeCtx(over: Partial<Ctx>): Ctx {
  const titles: Record<string, string> = { "pane:A": "Doc A", "pane:B": "Doc B" };
  return {
    openPanes: [],
    focusedPaneId: "",
    focusPane: vi.fn(),
    closePane: vi.fn(),
    sourceForPane: (paneId: string) => {
      const title = titles[paneId];
      return title ? { id: paneId.replace("pane:", ""), title } : null;
    },
    ...over
  } as unknown as Ctx;
}

const paneA: OpenPane = { paneId: "pane:A", sourceId: "A", viewState: {} };
const paneB: OpenPane = { paneId: "pane:B", sourceId: "B", viewState: {} };

describe("SourceTabs — multi-document tab strip", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("single-pane DOM == old .reader-tab chrome (icon + title + close, one active tab)", () => {
    const plugin = getView("source.tabs");
    expect(plugin).toBeTruthy();
    const ctx = makeCtx({ openPanes: [paneA], focusedPaneId: "pane:A" });
    const { container, cleanup } = mount(<>{plugin!.render({ id: "x", kind: "source.tabs" }, ctx)}</>);

    // The strip lives in the reader-header, exactly one tab, marked active.
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

  it("renders one tab per open pane; marks the focused pane active", () => {
    const plugin = getView("source.tabs");
    const ctx = makeCtx({ openPanes: [paneA, paneB], focusedPaneId: "pane:B" });
    const { container, cleanup } = mount(<>{plugin!.render({ id: "x", kind: "source.tabs" }, ctx)}</>);

    const titles = Array.from(container.querySelectorAll(".reader-tab-title")).map((n) => n.textContent);
    expect(titles).toEqual(["Doc A", "Doc B"]);
    const active = container.querySelector('.reader-tab.active .reader-tab-title');
    expect(active?.textContent).toBe("Doc B");

    cleanup();
  });

  it("clicking a tab focuses its pane (focus-follows-pane)", () => {
    const plugin = getView("source.tabs");
    const focusPane = vi.fn();
    const ctx = makeCtx({ openPanes: [paneA, paneB], focusedPaneId: "pane:A", focusPane });
    const { container, cleanup } = mount(<>{plugin!.render({ id: "x", kind: "source.tabs" }, ctx)}</>);

    const bTab = Array.from(container.querySelectorAll<HTMLElement>(".reader-tab")).find(
      (t) => t.querySelector(".reader-tab-title")?.textContent === "Doc B"
    )!;
    act(() => {
      bTab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(focusPane).toHaveBeenCalledWith("pane:B");

    cleanup();
  });

  it("the × closes a pane (and does not also focus it)", () => {
    const plugin = getView("source.tabs");
    const focusPane = vi.fn();
    const closePane = vi.fn();
    const ctx = makeCtx({ openPanes: [paneA, paneB], focusedPaneId: "pane:A", focusPane, closePane });
    const { container, cleanup } = mount(<>{plugin!.render({ id: "x", kind: "source.tabs" }, ctx)}</>);

    const bClose = Array.from(container.querySelectorAll<HTMLElement>(".reader-tab"))
      .find((t) => t.querySelector(".reader-tab-title")?.textContent === "Doc B")!
      .querySelector<HTMLButtonElement>(".reader-tab-close")!;
    act(() => {
      bClose.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(closePane).toHaveBeenCalledWith("pane:B");
    // stopPropagation → the tab's mousedown focus didn't fire from the close click.
    expect(focusPane).not.toHaveBeenCalled();

    cleanup();
  });

  it("no open pane → the empty-state placeholder tab", () => {
    const plugin = getView("source.tabs");
    const ctx = makeCtx({ openPanes: [], focusedPaneId: "" });
    const { container, cleanup } = mount(<>{plugin!.render({ id: "x", kind: "source.tabs" }, ctx)}</>);
    expect(container.querySelector(".reader-tab-empty")).toBeTruthy();
    expect(container.querySelector(".reader-tab-title")?.textContent).toBe("Open or import a source");
    cleanup();
  });

  // FOCUS-FOLLOWS-PANE for commandContext.sourceId: the derived activeSourceId shim (=
  // focused pane's sourceId) is what feeds commandContext.sourceId. Flipping focus to B
  // makes the shim resolve to B's source — so add-note/toolbar target B, not A.
  it("focus-follows-pane: the derived activeSourceId (commandContext.sourceId) follows the focused pane", () => {
    let state: PanesState = { openPanes: [], focusedPaneId: "" };
    state = openOrFocusPane(state, "A");
    state = openOrFocusPane(state, "B"); // focus B
    const shimFor = (s: PanesState) => focusedPane(s.openPanes, s.focusedPaneId)?.sourceId ?? "";
    expect(shimFor(state)).toBe("B");
    // Flip focus back to A → the shim (and thus commandContext.sourceId) becomes A.
    state = { openPanes: state.openPanes, focusedPaneId: "pane:A" };
    expect(shimFor(state)).toBe("A");
  });
});
