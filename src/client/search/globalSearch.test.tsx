// @vitest-environment jsdom
// GlobalSearchPalette (SEARCH-1) — jsdom coverage of the palette contract: the global
// Cmd/Ctrl+K hotkey opens/toggles (Esc closes), grouped sections render (笔记/文档/命令),
// keyboard nav is flat with wrap, Enter dispatches per family through the injected deps
// (focusAnchor / focusNote / openSource / command.run — all mocked), the cross-source
// reveal completes when the opened source's anchors arrive, the empty state shows, and
// the new strings flip with the locale. Raw createRoot + act (the SlashPalette harness);
// the debounce runs on REAL timers (150ms) to stay clear of fake-timer/microtask races.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../i18n";
import type { SearchCommandEntry } from "./commandEntries";
import { GlobalSearchPalette, isSearchHotkey, type GlobalSearchDeps } from "./GlobalSearch";
import { SEARCH_DEBOUNCE_MS, type SearchHitDto } from "./searchEngine";
import type { RecentsStore } from "./searchRecents";

type AnchorFixture = { id: string };

/** An in-memory RecentsStore so tests never touch real localStorage. */
function memoryRecentsStore(): RecentsStore {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value)
  };
}

const FIXTURE_HITS: SearchHitDto[] = [
  {
    family: "note",
    id: "note_active",
    contentType: "markdown",
    title: "浮力定律",
    snippet: "…浮力定律与压强…",
    sourceId: "src_active",
    sourceTitle: "讲义",
    anchorId: "anchor_active",
    updatedAt: "2026-07-01T00:00:00.000Z"
  },
  {
    family: "note",
    id: "note_other",
    contentType: "quiz",
    title: "什么是浮力",
    snippet: "",
    sourceId: "src_other",
    sourceTitle: "网页",
    anchorId: "anchor_other",
    updatedAt: "2026-07-01T00:00:00.000Z"
  },
  {
    family: "source",
    id: "src_two",
    title: "关于浮力的网页",
    sourceType: "webpage",
    snippet: "",
    updatedAt: "2026-07-01T00:00:00.000Z"
  }
];

function makeDeps(hits: SearchHitDto[] = FIXTURE_HITS) {
  const runCommand = vi.fn(() => true);
  const commands: SearchCommandEntry[] = [
    {
      id: "open:review.panel",
      title: { zh: "打开复习", en: "Open Review" },
      aliases: ["review", "复习"],
      target: { type: "pane", kind: "review.panel" },
      run: runCommand
    }
  ];
  const deps: GlobalSearchDeps<AnchorFixture> = {
    activeSourceId: "src_active",
    anchors: [{ id: "anchor_active" }],
    focusAnchor: vi.fn(),
    focusNote: vi.fn(),
    openSource: vi.fn(),
    commands,
    fetchHits: vi.fn(async (_q: string) => hits),
    recentsStore: memoryRecentsStore()
  };
  return { deps, runCommand };
}

let root: Root | null = null;
let container: HTMLElement | null = null;

function mount(deps: GlobalSearchDeps<AnchorFixture>) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<GlobalSearchPalette deps={deps} />));
  return {
    rerender: (next: GlobalSearchDeps<AnchorFixture>) => act(() => root!.render(<GlobalSearchPalette deps={next} />))
  };
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  setLocale("zh");
});

const pressWindow = (key: string, init: KeyboardEventInit = {}) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, ...init }));
  });

const openPalette = () => pressWindow("k", { ctrlKey: true });

const paletteInput = () => document.querySelector<HTMLInputElement>(".global-search-input");

function type(text: string) {
  const input = paletteInput()!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const pressInput = (key: string) =>
  act(() => {
    paletteInput()!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });

/** Let the real-timer debounce elapse + the mocked fetch settle. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, SEARCH_DEBOUNCE_MS + 40));
  });
}

const groupTitles = () =>
  Array.from(document.querySelectorAll(".global-search-group-title")).map((el) => el.textContent);

describe("isSearchHotkey", () => {
  it("Ctrl+K and Cmd+K (any case), never with Alt, never bare K", () => {
    expect(isSearchHotkey({ key: "k", ctrlKey: true, metaKey: false, altKey: false })).toBe(true);
    expect(isSearchHotkey({ key: "K", ctrlKey: false, metaKey: true, altKey: false })).toBe(true);
    expect(isSearchHotkey({ key: "k", ctrlKey: true, metaKey: false, altKey: true })).toBe(false);
    expect(isSearchHotkey({ key: "k", ctrlKey: false, metaKey: false, altKey: false })).toBe(false);
  });
});

describe("GlobalSearchPalette — open/close", () => {
  it("closed by default; Ctrl+K opens; Esc closes; Meta+K reopens", () => {
    const { deps } = makeDeps();
    mount(deps);
    expect(paletteInput()).toBeNull();

    openPalette();
    expect(paletteInput()).not.toBeNull();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();

    pressWindow("Escape");
    expect(paletteInput()).toBeNull();

    pressWindow("k", { metaKey: true });
    expect(paletteInput()).not.toBeNull();
  });

  it("empty query doubles as a navigation menu: the commands group renders immediately", () => {
    const { deps } = makeDeps();
    mount(deps);
    openPalette();
    expect(groupTitles()).toEqual(["命令"]);
    expect(document.querySelector('[data-row-id="open:review.panel"]')?.textContent).toContain("打开复习");
  });
});

describe("GlobalSearchPalette — query → grouped results", () => {
  it("debounced fetch renders 笔记 + 文档 groups with rows; no command group when none match", async () => {
    const { deps } = makeDeps();
    mount(deps);
    openPalette();
    type("浮力");
    await settle();

    expect(deps.fetchHits).toHaveBeenCalledWith("浮力", { families: [], contentTypes: [] });
    expect(groupTitles()).toEqual(["笔记", "文档"]);
    expect(document.querySelector('[data-row-id="note_active"]')).not.toBeNull();
    expect(document.querySelector('[data-row-id="src_two"]')).not.toBeNull();
    // First flat row is active (aria-selected).
    const rows = document.querySelectorAll(".global-search-row");
    expect(rows[0].classList.contains("active")).toBe(true);
    expect(rows[0].getAttribute("aria-selected")).toBe("true");
  });

  it("no hits + no matching command → the empty state", async () => {
    const { deps } = makeDeps([]);
    mount(deps);
    openPalette();
    type("zzz");
    await settle();
    expect(document.querySelector(".global-search-empty")?.textContent).toBe("没有匹配结果");
  });
});

describe("GlobalSearchPalette — Enter dispatches per family", () => {
  it("note on the ACTIVE source → focusAnchor(the anchor record) and closes", async () => {
    const { deps } = makeDeps();
    mount(deps);
    openPalette();
    type("浮力");
    await settle();

    pressInput("Enter"); // active row 0 = note_active (sourceId === activeSourceId)
    expect(deps.focusAnchor).toHaveBeenCalledWith(deps.anchors[0]);
    expect(deps.openSource).not.toHaveBeenCalled();
    expect(paletteInput()).toBeNull(); // closed after pick
  });

  it("note WITHOUT an anchor → focusNote fallback", async () => {
    const { deps } = makeDeps([
      {
        family: "note",
        id: "note_loose",
        contentType: "markdown",
        title: "独立笔记",
        snippet: "",
        sourceId: "src_active",
        updatedAt: "2026-07-01T00:00:00.000Z"
      }
    ]);
    mount(deps);
    openPalette();
    type("独立");
    await settle();
    pressInput("Enter");
    expect(deps.focusNote).toHaveBeenCalledWith("note_loose");
    expect(deps.focusAnchor).not.toHaveBeenCalled();
  });

  it("cross-source note → openSource, then the reveal completes when its anchors arrive", async () => {
    const { deps } = makeDeps();
    const { rerender } = mount(deps);
    openPalette();
    type("浮力");
    await settle();

    pressInput("ArrowDown"); // row 1 = note_other (src_other)
    pressInput("Enter");
    expect(deps.openSource).toHaveBeenCalledWith("src_other");
    expect(deps.focusAnchor).not.toHaveBeenCalled();

    // The workspace switches source and (later) loads its anchors — the pending
    // reveal effect completes the focus with the freshly loaded record.
    const loadedAnchor = { id: "anchor_other" };
    rerender({ ...deps, activeSourceId: "src_other", anchors: [loadedAnchor] });
    expect(deps.focusAnchor).toHaveBeenCalledWith(loadedAnchor);
  });

  it("source row → openSource; command row → run()", async () => {
    const { deps, runCommand } = makeDeps();
    mount(deps);
    openPalette();
    type("浮力");
    await settle();

    pressInput("ArrowDown");
    pressInput("ArrowDown"); // row 2 = the source row
    pressInput("Enter");
    expect(deps.openSource).toHaveBeenCalledWith("src_two");
    expect(paletteInput()).toBeNull();

    // Reopen; "复习" matches the command; ArrowUp wraps to the LAST flat row = command.
    openPalette();
    type("复习");
    await settle();
    pressInput("ArrowUp");
    pressInput("Enter");
    expect(runCommand).toHaveBeenCalledTimes(1);
    expect(paletteInput()).toBeNull();
  });
});

const filterButtons = () => Array.from(document.querySelectorAll<HTMLButtonElement>(".global-search-filter"));
const clickFilter = (label: string) => {
  const button = filterButtons().find((el) => el.textContent === label)!;
  act(() => button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })));
};
const recentRows = () => Array.from(document.querySelectorAll<HTMLElement>("[data-recent]"));

describe("GlobalSearchPalette — SEARCH-2 filters (design §3)", () => {
  it("empty filter fetches with the SEARCH-1-parity shape; a family chip narrows the fetch + hides commands", async () => {
    const { deps } = makeDeps();
    mount(deps);
    openPalette();
    // The filter bar renders: 全部 · 笔记 · 文档.
    expect(filterButtons().map((el) => el.textContent)).toEqual(["全部", "笔记", "文档"]);
    // Empty (全部) is active by default; the command group shows.
    expect(groupTitles()).toEqual(["命令"]);

    clickFilter("文档"); // narrow to sources only
    type("浮力");
    await settle();
    // Fetch carried the family filter (the server does the actual narrowing); the
    // command group is hidden client-side while a specific family is chosen.
    expect(deps.fetchHits).toHaveBeenLastCalledWith("浮力", { families: ["source"], contentTypes: [] });
    expect(groupTitles()).not.toContain("命令");

    clickFilter("全部"); // reset to neutral
    await settle();
    expect(deps.fetchHits).toHaveBeenLastCalledWith("浮力", { families: [], contentTypes: [] });
  });
});

describe("GlobalSearchPalette — SEARCH-2 recents (design §3)", () => {
  it("a settled query is recorded and offered on the next empty open; picking it re-runs it", async () => {
    const store = memoryRecentsStore();
    const { deps } = makeDeps();
    deps.recentsStore = store;
    mount(deps);

    openPalette();
    type("浮力");
    await settle(); // records "浮力"
    pressWindow("Escape");

    openPalette(); // empty query → recents surface
    expect(document.querySelector(".global-search-group[data-family='recent']")).not.toBeNull();
    expect(recentRows().map((el) => el.getAttribute("data-recent"))).toContain("浮力");

    // Picking a recent fills the input and re-runs the search.
    act(() => recentRows()[0].dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })));
    expect(paletteInput()?.value).toBe("浮力");
    await settle();
    expect(deps.fetchHits).toHaveBeenLastCalledWith("浮力", { families: [], contentTypes: [] });
  });

  it("clear empties the recents list", async () => {
    const { deps } = makeDeps();
    mount(deps);
    openPalette();
    type("压强");
    await settle();
    pressWindow("Escape");
    openPalette();
    expect(recentRows().length).toBeGreaterThan(0);
    const clear = document.querySelector<HTMLButtonElement>(".global-search-recents-clear")!;
    act(() => clear.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })));
    expect(recentRows().length).toBe(0);
  });
});

describe("GlobalSearchPalette — i18n", () => {
  it("the new strings flip with the locale (headers + placeholder + empty state)", async () => {
    setLocale("en");
    const { deps } = makeDeps();
    mount(deps);
    openPalette();
    expect(paletteInput()?.placeholder).toBe("Search notes, documents, commands…");
    expect(groupTitles()).toEqual(["Commands"]);
    expect(filterButtons().map((el) => el.textContent)).toEqual(["All", "Notes", "Documents"]);
    type("浮力");
    await settle();
    expect(groupTitles()).toEqual(["Notes", "Documents"]);
  });
});
