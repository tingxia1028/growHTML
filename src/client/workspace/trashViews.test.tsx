// @vitest-environment jsdom
// 回收站 view (TRUST-3) — typed sections render, per-item 恢复/彻底删除 hit the IO
// seam (purge behind a confirm), 清空回收站 requires the typed phrase (the TRUST-2
// idiom), restore-conflict hints show, the retention readout carries the server's
// number, the empty state, and the zh→en locale flip.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { setLocale } from "../i18n";
import { getView } from "./viewRegistry";
import { setTrashIoForTests, type TrashListing } from "./trashIo";
import { setTrashUiForTests, TrashPanel } from "./trashViews";

let container: HTMLDivElement;
let root: Root;

const listing: TrashListing = {
  retentionDays: 30,
  sources: [
    {
      id: "src_01HZZZZZZZZZZZZZZZZZZZZZS1",
      title: "被删的文档",
      sourceType: "html",
      deletedAt: "2026-07-01T08:00:00.000Z",
      purgeAt: "2026-07-31T08:00:00.000Z",
      noteCount: 2,
      anchorCount: 3
    }
  ],
  notes: [
    {
      id: "note_01HZZZZZZZZZZZZZZZZZZZZN1",
      contentType: "markdown",
      excerpt: "一条被删的笔记",
      deletedAt: "2026-07-02T08:00:00.000Z",
      purgeAt: "2026-08-01T08:00:00.000Z",
      sourceId: "src_live",
      sourceTitle: "活着的文档",
      sourceState: "live"
    },
    {
      id: "note_01HZZZZZZZZZZZZZZZZZZZZN2",
      contentType: "markdown",
      excerpt: "来源也被删的笔记",
      deletedAt: "2026-07-03T08:00:00.000Z",
      purgeAt: "2026-08-02T08:00:00.000Z",
      sourceId: "src_01HZZZZZZZZZZZZZZZZZZZZZS1",
      sourceTitle: "被删的文档",
      sourceState: "trashed"
    }
  ]
};

beforeEach(() => {
  setLocale("zh");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  setTrashIoForTests(null);
  setTrashUiForTests(null);
  setLocale("zh");
  vi.restoreAllMocks();
});

async function renderPanel() {
  await act(async () => {
    root.render(<TrashPanel />);
  });
}

const text = () => container.textContent ?? "";

describe("TrashPanel (trash.panel view)", () => {
  it("is registered in the view registry as trash.panel", () => {
    expect(getView("trash.panel")).toBeDefined();
  });

  it("renders typed sections with rows, cascade counts, hints and the retention readout", async () => {
    setTrashIoForTests({ fetchTrash: async () => listing });
    await renderPanel();

    // Retention readout carries the SERVER's number.
    expect(text()).toContain("保留 30 天");

    // Typed sections + rows.
    expect(text()).toContain("已删除的文档");
    expect(text()).toContain("已删除的笔记");
    expect(container.querySelectorAll(".trash-source-row")).toHaveLength(1);
    expect(container.querySelectorAll(".trash-note-row")).toHaveLength(2);
    expect(text()).toContain("被删的文档");
    expect(text()).toContain("2 条笔记 · 3 处标注");

    // The trashed-source note carries the restore-conflict hint; the live one doesn't.
    const hints = Array.from(container.querySelectorAll(".trash-row-hint")).map((el) => el.textContent);
    expect(hints).toEqual(["来源文档也在回收站 — 先恢复文档"]);

    // Every row has 恢复 + 彻底删除.
    expect(container.querySelectorAll(".trash-restore")).toHaveLength(3);
    expect(container.querySelectorAll(".trash-purge")).toHaveLength(3);
  });

  it("shows the empty state (and disables 清空回收站) when the bin is empty", async () => {
    setTrashIoForTests({ fetchTrash: async () => ({ retentionDays: 30, sources: [], notes: [] }) });
    await renderPanel();

    expect(text()).toContain("回收站是空的");
    expect(container.querySelector<HTMLButtonElement>(".trash-purge-all")!.disabled).toBe(true);
  });

  it("恢复 calls the restore edge and reloads; a 409 conflict surfaces inline", async () => {
    const restore = vi.fn(async () => ({
      ok: true as const,
      restored: { type: "note" as const, id: "note_01HZZZZZZZZZZZZZZZZZZZZN1" },
      cascade: { notes: 0, anchors: 1, patches: 0 }
    }));
    const fetchTrash = vi.fn(async () => listing);
    setTrashIoForTests({ fetchTrash, restore });
    await renderPanel();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-id="note_01HZZZZZZZZZZZZZZZZZZZZN1"] .trash-restore')!
        .click();
    });
    expect(restore).toHaveBeenCalledWith("note_01HZZZZZZZZZZZZZZZZZZZZN1");
    expect(fetchTrash).toHaveBeenCalledTimes(2); // initial load + post-action reload

    // Conflict path: the server's 409 message shows inline, nothing crashes.
    setTrashIoForTests({
      fetchTrash,
      restore: async () => {
        throw new Error("这条笔记的来源文档还在回收站里 — 请先恢复该文档");
      }
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-id="note_01HZZZZZZZZZZZZZZZZZZZZN2"] .trash-restore')!
        .click();
    });
    expect(container.querySelector(".trash-error")!.textContent).toContain("请先恢复该文档");
  });

  it("彻底删除 asks for confirmation and only purges on accept", async () => {
    const purge = vi.fn(async () => ({ ok: true as const, purged: { sources: 0, notes: 1, anchors: 0, patches: 0 } }));
    setTrashIoForTests({ fetchTrash: async () => listing, purge });
    const confirm = vi.fn(() => false);
    setTrashUiForTests({ confirm });
    await renderPanel();

    const purgeButton = container.querySelector<HTMLButtonElement>(
      '[data-id="note_01HZZZZZZZZZZZZZZZZZZZZN1"] .trash-purge'
    )!;
    await act(async () => {
      purgeButton.click();
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(purge).not.toHaveBeenCalled(); // declined

    confirm.mockReturnValue(true);
    await act(async () => {
      purgeButton.click();
    });
    expect(purge).toHaveBeenCalledWith("note_01HZZZZZZZZZZZZZZZZZZZZN1");
  });

  it("清空回收站 requires typing the EXACT phrase (cancel = no-op, mismatch = alert)", async () => {
    const purgeAll = vi.fn(async () => ({ ok: true as const, purged: { sources: 1, notes: 2, anchors: 3, patches: 0 } }));
    setTrashIoForTests({ fetchTrash: async () => listing, purgeAll });
    const prompt = vi.fn<(message: string) => string | null>(() => null);
    const alert = vi.fn();
    setTrashUiForTests({ prompt, alert });
    await renderPanel();

    const purgeAllButton = container.querySelector<HTMLButtonElement>(".trash-purge-all")!;
    await act(async () => {
      purgeAllButton.click(); // cancelled prompt
    });
    expect(purgeAll).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();

    prompt.mockReturnValue("清空");
    await act(async () => {
      purgeAllButton.click(); // wrong phrase
    });
    expect(purgeAll).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledTimes(1);

    prompt.mockReturnValue("清空回收站");
    await act(async () => {
      purgeAllButton.click();
    });
    expect(purgeAll).toHaveBeenCalledWith("清空回收站");
  });

  it("surfaces a load failure honestly", async () => {
    setTrashIoForTests({
      fetchTrash: async () => {
        throw new Error("boom");
      }
    });
    await renderPanel();
    expect(container.querySelector(".trash-error")!.textContent).toContain("回收站加载失败");
  });

  it("re-renders in English after the locale flip (no hardcoded literals)", async () => {
    setTrashIoForTests({ fetchTrash: async () => listing });
    setLocale("en");
    await renderPanel();

    expect(text()).toContain("Recycle bin");
    expect(text()).toContain("Deleted documents");
    expect(text()).toContain("Deleted notes");
    expect(text()).toContain("kept for 30 days");
    expect(text()).toContain("2 notes · 3 highlights");
    expect(container.querySelector(".trash-purge-all")!.textContent).toBe("Empty recycle bin");
  });
});
