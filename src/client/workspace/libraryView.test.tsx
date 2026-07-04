// @vitest-environment jsdom
// LIB-2 — the rebuilt Library pane: registry-driven sections (collapse/count/empty
// states), the NEW full 文档 list with type filter chips, the header search filter
// (SEARCH-1 seam), the ONE unified `+` menu (registry groups, fixture kit action,
// web-disabled hint), fixture kit sections, i18n locale flip, and the ported legacy
// behaviors (open / close-from-list / recent rows / folder trees / refresh).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import type { ReactElement, ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

// Keep the views.tsx static import graph jsdom-safe (same stubs as WorkspaceShell.test):
// the reader modules pull pdf.js/webview code that needs DOMMatrix/canvas.
vi.mock("../PdfReader", () => ({ PdfReader: () => null }));
vi.mock("../ImageReader", () => ({ ImageReader: () => null }));
vi.mock("../WebviewReader", () => ({ WebviewReader: () => null }));
vi.mock("../LocalHtmlReader", () => ({ LocalHtmlReader: () => null }));

import type { SourceRecord, WorkspaceNode } from "../data/entityClient";
import { setLocale } from "../i18n";
import { getView } from "./viewRegistry";
import type { WorkspaceContext } from "./viewRegistry";
import { registerLibraryAddAction, registerLibrarySection } from "./librarySections";
import "./views";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const COLLAPSED_KEY = "sv-library-collapsed";

function source(id: string, title: string, sourceType: string): SourceRecord {
  return { id, title, sourceType, path: `${id}.dat`, contentHash: `hash_${id}` };
}

const fixtureSources = [
  source("source_1", "线性代数教材", "pdf"),
  source("source_2", "细胞生物学讲义", "html"),
  source("source_3", "React 文档", "webpage"),
  source("source_4", "错题截图", "image")
];

function makeCtx(overrides: Record<string, unknown> = {}): WorkspaceContext {
  return {
    sources: fixtureSources,
    recentSources: fixtureSources,
    activeSourceId: "source_2",
    setActiveSourceId: vi.fn(),
    deleteSourceItem: vi.fn().mockResolvedValue(undefined),
    removeRecentSourceId: vi.fn(),
    loadSources: vi.fn().mockResolvedValue(undefined),
    canOpenLocal: true,
    openFileDialog: vi.fn().mockResolvedValue(undefined),
    openFolderDialog: vi.fn().mockResolvedValue(undefined),
    folderRoots: [],
    closeFolderRoot: vi.fn(),
    openLocalFile: vi.fn().mockResolvedValue(undefined),
    activeFilePath: undefined,
    importUrl: "",
    setImportUrl: vi.fn(),
    importFromUrl: vi.fn().mockResolvedValue(undefined),
    openLiveUrl: vi.fn().mockResolvedValue(undefined),
    ...overrides
  } as unknown as WorkspaceContext;
}

let container: HTMLDivElement;
let root: Root | null = null;

async function mountLibrary(ctx: WorkspaceContext): Promise<HTMLElement> {
  const plugin = getView("library");
  expect(plugin).toBeTruthy();
  const node = { id: "library", kind: "library" } as WorkspaceNode;
  root = createRoot(container);
  await act(async () => root!.render(plugin!.render(node, ctx) as ReactElement));
  return container;
}

async function unmount(): Promise<void> {
  if (root) {
    const current = root;
    await act(async () => current.unmount());
    root = null;
  }
}

async function click(element: Element | null): Promise<void> {
  expect(element).toBeTruthy();
  await act(async () => (element as HTMLElement).click());
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function sectionEl(id: string): HTMLElement | null {
  return container.querySelector(`[data-section-id="${id}"]`);
}

function sectionCount(id: string): string {
  return sectionEl(id)?.querySelector(".library-section-count")?.textContent ?? "";
}

async function openAddMenu(): Promise<HTMLElement> {
  await click(container.querySelector('[aria-label="添加到资料库"]'));
  const popover = document.body.querySelector(".panel-menu-popover");
  expect(popover).toBeTruthy();
  return popover as HTMLElement;
}

async function openLibrarySearch(): Promise<HTMLInputElement> {
  const trigger = container.querySelector(".library-search-toggle");
  expect(trigger).toBeTruthy();
  await click(trigger);
  const input = container.querySelector(".library-search") as HTMLInputElement | null;
  expect(input).toBeTruthy();
  return input!;
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ entries: [] }) }))
  );
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(async () => {
  await unmount();
  container.remove();
  vi.unstubAllGlobals();
  setLocale("zh");
});

describe("LibraryView sections (registry-driven)", () => {
  it("keeps Library header tools grouped on the right", async () => {
    await mountLibrary(makeCtx());
    const head = container.querySelector(".library-head") as HTMLElement;
    const actions = head.querySelector(".library-actions") as HTMLElement;
    expect(head.children).toHaveLength(2);
    expect(head.firstElementChild).toBe(container.querySelector(".library-title"));
    expect(head.lastElementChild).toBe(actions);

    const actionChildren = Array.from(actions.children);
    expect(actionChildren).toHaveLength(3);
    expect(actionChildren[0].classList.contains("library-search-toggle")).toBe(true);
    expect(actionChildren[1].classList.contains("library-icon-btn")).toBe(true);
    expect(actionChildren[2].classList.contains("panel-menu")).toBe(true);
  });

  it("renders the three core sections in order with count badges", async () => {
    await mountLibrary(makeCtx());
    const ids = Array.from(container.querySelectorAll("[data-section-id]")).map((el) =>
      el.getAttribute("data-section-id")
    );
    expect(ids).toEqual(["core.recent", "core.documents", "core.folders"]);
    expect(sectionCount("core.recent")).toBe("4");
    expect(sectionCount("core.documents")).toBe("4");
    expect(sectionCount("core.folders")).toBe("0");
  });

  it("最近 caps at 5 compact rows", async () => {
    const many = Array.from({ length: 8 }, (_, i) => source(`source_${i}`, `文档 ${i}`, "pdf"));
    await mountLibrary(makeCtx({ sources: many, recentSources: many }));
    expect(sectionEl("core.recent")!.querySelectorAll(".source-item")).toHaveLength(5);
    expect(sectionCount("core.recent")).toBe("5");
  });

  it("collapses a section on toggle and persists the state across remounts", async () => {
    const ctx = makeCtx();
    await mountLibrary(ctx);
    expect(sectionEl("core.documents")!.querySelector(".library-documents")).toBeTruthy();

    await click(sectionEl("core.documents")!.querySelector(".library-section-toggle"));
    expect(sectionEl("core.documents")!.querySelector(".library-documents")).toBeNull();
    expect(
      sectionEl("core.documents")!.querySelector(".library-section-toggle")!.getAttribute("aria-expanded")
    ).toBe("false");
    expect(JSON.parse(window.localStorage.getItem(COLLAPSED_KEY)!)).toMatchObject({
      "core.documents": true
    });

    await unmount();
    await mountLibrary(ctx);
    expect(sectionEl("core.documents")!.querySelector(".library-documents")).toBeNull();
    expect(sectionEl("core.recent")!.querySelector(".recent-source-list")).toBeTruthy();
  });

  it("a fixture (kit) section renders through the registry and unregisters cleanly", async () => {
    const dispose = registerLibrarySection({
      id: "fixture.textbook",
      title: { zh: "教材包", en: "Textbook packs" },
      order: 40,
      count: () => 1,
      render: () => <div className="fixture-kit-body">数学套装</div>
    });
    try {
      await mountLibrary(makeCtx());
      const fixture = sectionEl("fixture.textbook");
      expect(fixture).toBeTruthy();
      expect(fixture!.querySelector(".fixture-kit-body")!.textContent).toBe("数学套装");
      // Registered AFTER core.folders by order.
      const ids = Array.from(container.querySelectorAll("[data-section-id]")).map((el) =>
        el.getAttribute("data-section-id")
      );
      expect(ids[ids.length - 1]).toBe("fixture.textbook");
    } finally {
      dispose();
    }
    await unmount();
    await mountLibrary(makeCtx());
    expect(sectionEl("fixture.textbook")).toBeNull();
  });

  it("shows one guidance line per empty section (空库 → 点 + 导入第一份资料)", async () => {
    await mountLibrary(makeCtx({ sources: [], recentSources: [], folderRoots: [] }));
    expect(sectionEl("core.documents")!.querySelector(".library-empty")!.textContent).toBe(
      "点 + 导入第一份资料"
    );
    expect(sectionEl("core.recent")!.querySelector(".library-empty")!.textContent).toBe("还没有阅读记录。");
    expect(sectionEl("core.folders")!.querySelector(".library-empty")!.textContent).toBe(
      "点 + 本地… 选择文件夹"
    );
  });
});

describe("文档 — the full sources list + type filter chips", () => {
  it("lists every source with the active one highlighted", async () => {
    await mountLibrary(makeCtx());
    const rows = sectionEl("core.documents")!.querySelectorAll(".library-doc-list .source-item");
    expect(rows).toHaveLength(4);
    const titles = Array.from(rows).map((row) => row.querySelector(".source-item-text span")!.textContent);
    expect(titles).toEqual(["线性代数教材", "细胞生物学讲义", "React 文档", "错题截图"]);
    expect(rows[1].classList.contains("active")).toBe(true);
  });

  it("derives the chip set from the sourceTypes present and filters on click", async () => {
    await mountLibrary(makeCtx());
    const chips = Array.from(sectionEl("core.documents")!.querySelectorAll(".library-chip"));
    expect(chips.map((chip) => chip.textContent)).toEqual(["全部", "PDF", "HTML", "网页", "图片"]);
    expect(chips[0].classList.contains("active")).toBe(true);

    const webChip = chips.find((chip) => chip.textContent === "网页")!;
    await click(webChip);
    const rows = sectionEl("core.documents")!.querySelectorAll(".library-doc-list .source-item");
    expect(rows).toHaveLength(1);
    expect(rows[0].querySelector(".source-item-text span")!.textContent).toBe("React 文档");

    await click(
      Array.from(sectionEl("core.documents")!.querySelectorAll(".library-chip")).find(
        (chip) => chip.textContent === "全部"
      )!
    );
    expect(sectionEl("core.documents")!.querySelectorAll(".library-doc-list .source-item")).toHaveLength(4);
  });

  it("opens a source from the list and closes one from the Library list without deleting it", async () => {
    const ctx = makeCtx();
    await mountLibrary(ctx);
    const rows = sectionEl("core.documents")!.querySelectorAll(".library-doc-list .source-item");
    await click(rows[0].querySelector(".source-item-open"));
    expect(ctx.setActiveSourceId).toHaveBeenCalledWith("source_1");
    await click(rows[2].querySelector(".source-item-remove"));
    expect(ctx.deleteSourceItem).not.toHaveBeenCalled();
    const remainingTitles = Array.from(sectionEl("core.documents")!.querySelectorAll(".library-doc-list .source-item"))
      .map((row) => row.querySelector(".source-item-text span")!.textContent);
    expect(remainingTitles).toEqual(["线性代数教材", "细胞生物学讲义", "错题截图"]);
    expect(sectionCount("core.documents")).toBe("3");
  });

  it("renders source rows as title-only compact rows with tooltip detail", async () => {
    await mountLibrary(makeCtx());
    const row = sectionEl("core.documents")!.querySelector(".library-doc-list .source-item")!;
    expect(row.querySelector(".source-item-text span")!.textContent).toBe("线性代数教材");
    expect(row.querySelector(".source-item-text small")).toBeNull();
    expect(row.getAttribute("title")).toContain("Type: pdf");
    expect(row.getAttribute("title")).toContain("Path: source_1.dat");
    expect(row.getAttribute("title")).not.toContain("ID: source_1");
  });

  it("removes recent rows through the recent-list action, not source delete", async () => {
    const ctx = makeCtx();
    await mountLibrary(ctx);
    const row = sectionEl("core.recent")!.querySelector(".recent-source-list .source-item")!;
    await click(row.querySelector(".source-item-remove"));
    expect(ctx.removeRecentSourceId).toHaveBeenCalledWith("source_1");
    expect(ctx.deleteSourceItem).not.toHaveBeenCalled();
  });
});

describe("header search (SEARCH-1 seam)", () => {
  it("filters items across sections by title match and updates the counts", async () => {
    await mountLibrary(makeCtx());
    expect(container.querySelector(".library-search")).toBeNull();
    const input = await openLibrarySearch();
    await act(async () => setInputValue(input, "细胞"));

    expect(sectionCount("core.documents")).toBe("1");
    expect(sectionCount("core.recent")).toBe("1");
    const rows = sectionEl("core.documents")!.querySelectorAll(".library-doc-list .source-item");
    expect(rows).toHaveLength(1);
    expect(rows[0].querySelector(".source-item-text span")!.textContent).toBe("细胞生物学讲义");
  });

  it("shows a no-matches line (not the import guidance) when a search empties a section", async () => {
    await mountLibrary(makeCtx());
    const input = await openLibrarySearch();
    await act(async () => setInputValue(input, "不存在的标题"));
    expect(sectionCount("core.documents")).toBe("0");
    expect(sectionEl("core.documents")!.querySelector(".library-empty")!.textContent).toBe("没有匹配的条目。");
  });
});

describe("the unified + menu (registry groups)", () => {
  it("portals the add menu outside the Library panel so panel overflow cannot clip it", async () => {
    await mountLibrary(makeCtx());
    const popover = await openAddMenu();

    expect(container.querySelector(".panel-menu-popover")).toBeNull();
    expect(document.body.contains(popover)).toBe(true);
    expect(popover.style.position).toBe("fixed");
    expect(popover.style.width).toBe("260px");
  });

  it("renders the 导入 group's built-ins and runs them against the context", async () => {
    const ctx = makeCtx();
    await mountLibrary(ctx);
    const popover = await openAddMenu();

    const importGroup = popover.querySelector('[data-add-group="import"]')!;
    expect(
      Array.from(importGroup.querySelectorAll("[data-add-action]")).map((el) => el.getAttribute("data-add-action"))
    ).toEqual(["core.import-local", "core.import-web"]);
    const localBlock = importGroup.querySelector('[data-add-action="core.import-local"]')!;
    expect(localBlock.querySelector(".panel-menu-label")!.textContent).toBe("本地文件/文件夹…");
    expect(importGroup.querySelector('[data-add-action="core.import-file"]')).toBeNull();
    expect(importGroup.querySelector('[data-add-action="core.import-web"]')).toBeTruthy();
    expect(importGroup.querySelector('[data-add-action="core.mount-folder"]')).toBeNull();

    const buttons = Array.from(localBlock.querySelectorAll(".library-add-local-action")) as HTMLButtonElement[];
    expect(buttons.map((button) => button.textContent)).toEqual(["文件", "文件夹"]);
    await click(buttons[0]);
    expect(ctx.openFileDialog).toHaveBeenCalledTimes(1);

    const reopened = await openAddMenu();
    const folderButton = reopened.querySelectorAll(".library-add-local-action")[1];
    await click(folderButton);
    expect(ctx.openFolderDialog).toHaveBeenCalledTimes(1);
  });

  it("wires the 网页 inline block to the existing URL handlers", async () => {
    const ctx = makeCtx();
    await mountLibrary(ctx);
    const popover = await openAddMenu();
    const webBlock = popover.querySelector('[data-add-action="core.import-web"]')!;
    const input = webBlock.querySelector(".panel-menu-input") as HTMLInputElement;
    await act(async () => setInputValue(input, "https://example.com"));
    expect(ctx.setImportUrl).toHaveBeenCalledWith("https://example.com");

    const buttons = Array.from(webBlock.querySelectorAll(".library-add-web-action"));
    expect(buttons).toHaveLength(2);
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual(["抓取网页", "实时打开"]);

    await click(buttons.find((button) => button.getAttribute("aria-label") === "抓取网页")!);
    expect(ctx.importFromUrl).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector(".panel-menu-popover")).toBeNull();
  });

  it("auto-closes the + menu when focus moves outside", async () => {
    await mountLibrary(makeCtx());
    await openAddMenu();
    expect(document.body.querySelector(".panel-menu-popover")).toBeTruthy();

    await act(async () => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(document.body.querySelector(".panel-menu-popover")).toBeNull();
  });

  it("exposes the built-in 新建 entries — Markdown (default, first) + HTML 页 (SRC-1)", async () => {
    await mountLibrary(makeCtx());
    const popover = await openAddMenu();
    const createGroup = popover.querySelector('[data-add-group="create"]')!;
    const actions = Array.from(createGroup.querySelectorAll("[data-add-action]")).map((el) =>
      el.getAttribute("data-add-action")
    );
    expect(actions.indexOf("core.create-markdown")).toBeLessThan(actions.indexOf("core.create-html"));
    expect(createGroup.querySelector('[data-add-action="core.create-markdown"]')!.textContent).toBe("新建 Markdown");
    expect(createGroup.querySelector('[data-add-action="core.create-html"]')!.textContent).toBe("新建 HTML 页");
    // The LIB-2 transitional 文档… action (HTML import seam) is superseded by SRC-1.
    expect(createGroup.querySelector('[data-add-action="core.create-document"]')).toBeNull();
  });

  it("shows a fixture add-action under its group and drops it after unregistering", async () => {
    const run = vi.fn();
    const dispose = registerLibraryAddAction({
      id: "fixture.create-pack",
      group: "create",
      title: { zh: "新建课程包", en: "New course pack" },
      order: 20,
      run
    });
    const ctx = makeCtx();
    try {
      await mountLibrary(ctx);
      const popover = await openAddMenu();
      const fixture = popover.querySelector('[data-add-action="fixture.create-pack"]');
      expect(fixture).toBeTruthy();
      expect(fixture!.closest('[data-add-group="create"]')).toBeTruthy();
      await click(fixture);
      expect(run).toHaveBeenCalledTimes(1);
      expect(run.mock.calls[0][0]).toBe(ctx);
    } finally {
      dispose();
    }
    await unmount();
    await mountLibrary(makeCtx());
    const popover = await openAddMenu();
    expect(popover.querySelector('[data-add-action="fixture.create-pack"]')).toBeNull();
  });

  it("disables desktop-only items on web with the hint", async () => {
    await mountLibrary(makeCtx({ canOpenLocal: false }));
    const popover = await openAddMenu();
    const localButtons = Array.from(popover.querySelectorAll(".library-add-local-action")) as HTMLButtonElement[];
    expect(localButtons).toHaveLength(2);
    expect(localButtons.every((button) => button.disabled)).toBe(true);
    expect(localButtons.map((button) => button.title)).toEqual(["仅桌面端可用", "仅桌面端可用"]);
    expect(popover.querySelector(".panel-menu-hint")!.textContent).toBe("打开本地文件/文件夹仅桌面端可用。");
  });
});

describe("文件夹 + header behaviors (ported)", () => {
  it("renders mounted folder trees and closes one via its button", async () => {
    const ctx = makeCtx({ folderRoots: ["C:\\study\\notes"] });
    await mountLibrary(ctx);
    expect(sectionCount("core.folders")).toBe("1");
    const host = sectionEl("core.folders")!.querySelector(".folder-tree-host");
    expect(host).toBeTruthy();
    expect(host!.querySelector(".file-tree")).toBeTruthy();
    await click(host!.querySelector(".folder-tree-close"));
    expect(ctx.closeFolderRoot).toHaveBeenCalledWith("C:\\study\\notes");
  });

  it("refreshes the source list from the subtle header icon", async () => {
    const ctx = makeCtx();
    await mountLibrary(ctx);
    await click(container.querySelector(".library-icon-btn"));
    expect(ctx.loadSources).toHaveBeenCalledTimes(1);
  });

  it("opens a recent row (one-click open keeps working)", async () => {
    const ctx = makeCtx();
    await mountLibrary(ctx);
    const rows = sectionEl("core.recent")!.querySelectorAll(".source-item");
    await click(rows[0].querySelector(".source-item-open"));
    expect(ctx.setActiveSourceId).toHaveBeenCalledWith("source_1");
  });
});

describe("i18n", () => {
  it("re-renders the pane in English after a locale flip", async () => {
    setLocale("en");
    await mountLibrary(makeCtx({ sources: [], recentSources: [] }));
    expect(container.querySelector(".library-title")!.textContent).toBe("Library");
    expect(sectionEl("core.documents")!.querySelector(".library-empty")!.textContent).toBe(
      "Click + to import your first document"
    );
    const toggleTitles = Array.from(container.querySelectorAll(".library-section-toggle span:first-of-type")).map(
      (el) => el.textContent
    );
    expect(toggleTitles).toContain("Documents");
  });
});
