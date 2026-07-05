// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { setLocale } from "../i18n";

vi.mock("./UserMenu", () => ({
  UserMenu: () => <div className="mock-user-menu" />
}));

import { IconRail } from "./IconRail";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  setLocale("zh");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

function renderRail() {
  act(() => root.render(<IconRail selected="library" onSelect={vi.fn()} />));
}

function cleanup() {
  act(() => root.unmount());
  container.remove();
}

describe("IconRail i18n", () => {
  it("renders Chinese tooltip labels by default", () => {
    renderRail();
    const labels = Array.from(container.querySelectorAll(".icon-rail-btn")).map((button) =>
      button.getAttribute("aria-label")
    );
    expect(labels).toEqual(["资料库", "复习", "错题本", "知元", "画像"]);
    cleanup();
  });

  it("renders English tooltip labels after locale changes", () => {
    setLocale("en");
    renderRail();
    const labels = Array.from(container.querySelectorAll(".icon-rail-btn")).map((button) =>
      button.getAttribute("aria-label")
    );
    expect(labels).toEqual(["Library", "Review", "Mistakes", "Concepts", "Profile"]);
    cleanup();
  });
});
