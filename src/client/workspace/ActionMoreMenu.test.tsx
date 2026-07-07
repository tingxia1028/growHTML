// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ActionMoreMenu } from "./ActionMoreMenu";
import type { ToolbarAction } from "./WorkspaceContext";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ACTIONS: ToolbarAction[] = [
  {
    id: "explain",
    title: "Explain",
    kind: "builtin",
    scope: "anchor"
  }
];

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  if (root) {
    const current = root;
    act(() => current.unmount());
    root = null;
  }
  container?.remove();
  container = null;
  document.querySelectorAll(".action-more-menu").forEach((node) => node.remove());
  vi.restoreAllMocks();
});

function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<ActionMoreMenu items={ACTIONS} onRun={vi.fn()} surface="inline" />);
  });
}

const trigger = () => container!.querySelector(".action-more-trigger") as HTMLButtonElement;
const menu = () => document.querySelector(".action-more-menu");

describe("ActionMoreMenu", () => {
  it("closes when another toolbar popover opens", () => {
    mount();
    act(() => trigger().click());
    expect(menu()).toBeTruthy();

    act(() => {
      document.dispatchEvent(new CustomEvent("sv:toolbar-popover-open", { detail: { owner: "slash-selection" } }));
    });

    expect(menu()).toBeNull();
  });
});
