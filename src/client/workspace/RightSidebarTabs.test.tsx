// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import type { ReactElement, ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { WorkspaceNode } from "../data/entityClient";
import { setLocale } from "../i18n";
import type { WorkspaceContext } from "./viewRegistry";

vi.mock("./NoteListPanel", () => ({
  NoteListPanel: () => <div className="mock-note-list">Notes body</div>
}));

import { getView } from "./viewRegistry";
import { rightSplitKey } from "./rightSplit";
import "./RightSidebarTabs";

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

function pointerEvent(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  Object.defineProperty(event, "pointerId", { value: init.pointerId ?? 1 });
  return event;
}

describe("RightSidebarTabs note focus", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    window.localStorage.clear();
    setLocale("zh");
  });

  it("switches the right sidebar to Notes when focus targets a note", () => {
    const plugin = getView("right.tabs");
    expect(plugin).toBeTruthy();
    const node = { id: "right", kind: "right.tabs" } as WorkspaceNode;
    const ctx = {
      activeLayoutId: "default",
      focus: {
        focus: { type: "note", noteId: "note_1" }
      }
    } as unknown as WorkspaceContext;

    const { container, cleanup } = mount(<>{plugin!.render(node, ctx)}</>);

    const selected = container.querySelector('[role="tab"][aria-selected="true"]');
    expect(selected?.textContent).toBe("笔记");
    expect(container.querySelector(".mock-note-list")).toBeTruthy();

    cleanup();
  });

  it("flips the right sidebar tab labels to English when locale changes", () => {
    setLocale("en");
    const plugin = getView("right.tabs");
    const node = { id: "right", kind: "right.tabs" } as WorkspaceNode;
    const ctx = {
      activeLayoutId: "default",
      focus: { focus: null }
    } as unknown as WorkspaceContext;

    const { container, cleanup } = mount(<>{plugin!.render(node, ctx)}</>);

    const labels = Array.from(container.querySelectorAll('[role="tab"]')).map((tab) => tab.textContent);
    expect(labels).toEqual(["Anchor", "Notes", "Layers"]);
    expect(container.querySelector(".right-tabs-popped-label")?.textContent).toBe("AI Chat");

    cleanup();
  });

  it("resizes the split against the whole sidebar, not the upper tab body", () => {
    const plugin = getView("right.tabs");
    expect(plugin).toBeTruthy();
    const node = { id: "right", kind: "right.tabs" } as WorkspaceNode;
    const ctx = {
      activeLayoutId: "default",
      focus: {
        focus: null
      }
    } as unknown as WorkspaceContext;

    const { container, cleanup } = mount(<>{plugin!.render(node, ctx)}</>);

    const split = container.querySelector<HTMLElement>(".right-tabs-split")!;
    const body = container.querySelector<HTMLElement>(".right-tabs-body")!;
    const divider = container.querySelector<HTMLElement>(".right-tabs-divider")!;

    split.getBoundingClientRect = () =>
      ({ top: 100, bottom: 1100, left: 0, right: 360, width: 360, height: 1000, x: 0, y: 100, toJSON: () => ({}) }) as DOMRect;
    body.getBoundingClientRect = () =>
      ({ top: 136, bottom: 550, left: 0, right: 360, width: 360, height: 414, x: 0, y: 136, toJSON: () => ({}) }) as DOMRect;

    act(() => {
      divider.dispatchEvent(pointerEvent("pointerdown", { clientY: 550, button: 0 }));
    });
    act(() => {
      document.dispatchEvent(pointerEvent("pointermove", { clientY: 560 }));
    });
    act(() => {
      document.dispatchEvent(pointerEvent("pointerup", { clientY: 560 }));
    });

    const stored = JSON.parse(window.localStorage.getItem(rightSplitKey("default")) ?? "{}") as { ratio?: number };
    expect(stored.ratio).toBeCloseTo(0.46, 2);
    expect(stored.ratio).toBeLessThan(0.6);
    expect(split.style.getPropertyValue("--right-tabs-top-size")).toContain("46");

    cleanup();
  });
});
