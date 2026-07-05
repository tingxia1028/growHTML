// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { SlashEntry } from "./engine";
import { SlashPalette } from "./SlashPalette";

function mount(entries: SlashEntry[]) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() =>
    root.render(
      <SlashPalette query="" entries={entries} activeIndex={0} onPick={vi.fn()} onNavigate={vi.fn()} />
    )
  );
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    }
  };
}

describe("SlashPalette icons", () => {
  it("renders known action icon names as svg instead of leaking the icon key text", () => {
    const { container, unmount } = mount([
      { kind: "operation", id: "textbook.generate-practice", title: "Practice checks", aliases: [], icon: "list-checks" },
      { kind: "operation", id: "op.custom", title: "Custom", aliases: [], icon: "*" }
    ]);

    const namedIconRow = container.querySelector('[data-entry-id="textbook.generate-practice"]')!;
    expect(namedIconRow.querySelector("svg.slash-palette-icon")).toBeTruthy();
    expect(namedIconRow.querySelector(".slash-palette-icon")!.textContent).toBe("");

    const glyphRow = container.querySelector('[data-entry-id="op.custom"]')!;
    expect(glyphRow.querySelector(".slash-palette-icon")!.textContent).toBe("*");
    unmount();
  });
});
