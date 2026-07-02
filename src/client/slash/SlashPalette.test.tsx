// @vitest-environment jsdom
// SlashPalette component tests (SC-0) — a CONTROLLED dumb list: rows render
// icon+title+id+kit badge, the parent-owned activeIndex highlights, arrows report
// onNavigate (wrapping), Enter/click report onPick. No registry, no state.
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { SlashEntry } from "./engine";
import { SlashPalette, slashPaletteKeyDown, type SlashPaletteProps } from "./SlashPalette";

const ENTRIES: SlashEntry[] = [
  { kind: "noteType", id: "quiz", title: "小测", aliases: ["判断题"] },
  { kind: "noteType", id: "flashcard", title: "闪卡", aliases: ["卡片"] },
  {
    kind: "noteType",
    id: "textbook.exercise",
    title: "练习",
    aliases: ["练习题"],
    kitId: "textbook-learning"
  },
  { kind: "operation", id: "op.summarize", title: "总结", aliases: [], icon: "✍" }
];

function mount(props: Partial<SlashPaletteProps> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const onPick = vi.fn();
  const onNavigate = vi.fn();
  const render = (next: Partial<SlashPaletteProps> = {}) =>
    act(() =>
      root.render(
        <SlashPalette
          query=""
          entries={ENTRIES}
          activeIndex={0}
          onPick={onPick}
          onNavigate={onNavigate}
          {...props}
          {...next}
        />
      )
    );
  render();
  const unmount = () => {
    act(() => root.unmount());
    container.remove();
  };
  return { container, render, onPick, onNavigate, unmount };
}

const keydown = (el: Element, key: string) =>
  el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

describe("SlashPalette — rows", () => {
  it("renders one row per entry: title + id, active row highlighted (aria-selected)", () => {
    const { container, unmount } = mount({ activeIndex: 1 });
    const rows = Array.from(container.querySelectorAll(".slash-palette-row"));
    expect(rows.length).toBe(ENTRIES.length);
    expect(rows[0]!.querySelector(".slash-palette-title")!.textContent).toBe("小测");
    expect(rows[0]!.querySelector(".slash-palette-id")!.textContent).toBe("quiz");
    // The parent-owned activeIndex is the single highlight.
    expect(rows[1]!.classList.contains("active")).toBe(true);
    expect(rows[1]!.getAttribute("aria-selected")).toBe("true");
    expect(rows[0]!.classList.contains("active")).toBe(false);
    unmount();
  });

  it("shows a kit badge only for kit-owned entries", () => {
    const { container, unmount } = mount();
    const rows = Array.from(container.querySelectorAll(".slash-palette-row"));
    expect(rows[2]!.querySelector(".slash-palette-kit")!.textContent).toBe("textbook-learning");
    expect(rows[0]!.querySelector(".slash-palette-kit")).toBeNull();
    unmount();
  });

  it("icon: explicit glyph string wins; a noteType without one falls back to the central icon map (svg)", () => {
    const { container, unmount } = mount();
    const rows = Array.from(container.querySelectorAll(".slash-palette-row"));
    // op.summarize declared icon "✍".
    expect(rows[3]!.querySelector(".slash-palette-icon")!.textContent).toBe("✍");
    // quiz has no icon string → the lucide fallback renders an <svg>.
    expect(rows[0]!.querySelector("svg.slash-palette-icon")).toBeTruthy();
    unmount();
  });

  it("empty entries → an empty state naming the query (no listbox)", () => {
    const { container, unmount } = mount({ entries: [], query: "zzz" });
    const empty = container.querySelector(".slash-palette-empty")!;
    expect(empty.textContent).toContain("/zzz");
    expect(container.querySelector("[role=listbox]")).toBeNull();
    unmount();
  });
});

describe("SlashPalette — keyboard nav + pick", () => {
  it("ArrowDown/ArrowUp report onNavigate with the wrapped next index", () => {
    const { container, render, onNavigate, unmount } = mount({ activeIndex: 0 });
    const palette = container.querySelector(".slash-palette")!;
    keydown(palette, "ArrowDown");
    expect(onNavigate).toHaveBeenLastCalledWith(1);
    keydown(palette, "ArrowUp"); // from 0 → wraps to the last row
    expect(onNavigate).toHaveBeenLastCalledWith(ENTRIES.length - 1);

    render({ activeIndex: ENTRIES.length - 1 });
    keydown(container.querySelector(".slash-palette")!, "ArrowDown"); // last → wraps to 0
    expect(onNavigate).toHaveBeenLastCalledWith(0);
    unmount();
  });

  it("Enter picks the ACTIVE entry", () => {
    const { container, onPick, unmount } = mount({ activeIndex: 2 });
    keydown(container.querySelector(".slash-palette")!, "Enter");
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(ENTRIES[2]);
    unmount();
  });

  it("mousedown on a row picks THAT entry (not the active one)", () => {
    const { container, onPick, unmount } = mount({ activeIndex: 0 });
    const rows = container.querySelectorAll(".slash-palette-row");
    act(() => {
      rows[1]!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    });
    expect(onPick).toHaveBeenCalledWith(ENTRIES[1]);
    unmount();
  });

  it("other keys are not consumed (the composer keeps typing)", () => {
    const { container, onPick, onNavigate, unmount } = mount();
    keydown(container.querySelector(".slash-palette")!, "a");
    keydown(container.querySelector(".slash-palette")!, "Escape"); // closing = parent state
    expect(onPick).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
    unmount();
  });
});

describe("slashPaletteKeyDown — the shared key mapping (SC-1 composer reuses it)", () => {
  const target = () => ({
    entries: ENTRIES,
    activeIndex: 1,
    onPick: vi.fn(),
    onNavigate: vi.fn()
  });

  it("consumes arrows/Enter and reports intents; leaves everything else alone", () => {
    const t = target();
    expect(slashPaletteKeyDown("ArrowDown", t)).toBe(true);
    expect(t.onNavigate).toHaveBeenLastCalledWith(2);
    expect(slashPaletteKeyDown("Enter", t)).toBe(true);
    expect(t.onPick).toHaveBeenCalledWith(ENTRIES[1]);
    expect(slashPaletteKeyDown("Tab", t)).toBe(false);
    expect(slashPaletteKeyDown("Escape", t)).toBe(false);
  });

  it("no entries (or a stale out-of-range active row) → nothing consumed", () => {
    const empty = { entries: [] as SlashEntry[], activeIndex: 0, onPick: vi.fn(), onNavigate: vi.fn() };
    expect(slashPaletteKeyDown("ArrowDown", empty)).toBe(false);
    expect(slashPaletteKeyDown("Enter", empty)).toBe(false);
    const stale = { entries: ENTRIES, activeIndex: 99, onPick: vi.fn(), onNavigate: vi.fn() };
    expect(slashPaletteKeyDown("Enter", stale)).toBe(false);
    expect(stale.onPick).not.toHaveBeenCalled();
  });
});
