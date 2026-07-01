// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import type { ReactElement, ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { WorkspaceNode } from "../data/entityClient";
import type { WorkspaceContext } from "./viewRegistry";

vi.mock("./NoteListPanel", () => ({
  NoteListPanel: () => <div className="mock-note-list">Notes body</div>
}));

import { getView } from "./viewRegistry";
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

describe("RightSidebarTabs note focus", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    window.localStorage.clear();
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
    expect(selected?.textContent).toBe("Notes");
    expect(container.querySelector(".mock-note-list")).toBeTruthy();

    cleanup();
  });
});
