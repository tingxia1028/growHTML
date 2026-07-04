// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { setLocale } from "../i18n";
import { TopBar } from "./TopBar";
import type { WorkspaceContext } from "./viewRegistry";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  setLocale("zh");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

function cleanup() {
  act(() => root.unmount());
  container.remove();
}

function ctx(): WorkspaceContext {
  return {
    setAnnotationMode: vi.fn(),
    focus: { anchor: null, setAnchor: vi.fn() }
  } as unknown as WorkspaceContext;
}

describe("TopBar i18n", () => {
  it("renders Chinese labels by default", () => {
    act(() => root.render(<TopBar ctx={ctx()} />));

    expect(container.querySelector(".topbar-center")!.getAttribute("aria-label")).toBe("阅读模式");
    expect(container.textContent).toContain("笔记叠层");
    expect(container.textContent).toContain("锚点聚焦");

    cleanup();
  });

  it("renders English labels after locale changes", () => {
    setLocale("en");
    act(() => root.render(<TopBar ctx={ctx()} />));

    expect(container.querySelector(".topbar-center")!.getAttribute("aria-label")).toBe("Reading mode");
    expect(container.textContent).toContain("Notes Overlay");
    expect(container.textContent).toContain("Anchor Focus");

    cleanup();
  });
});
