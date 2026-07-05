// @vitest-environment jsdom
// 错题本 (mistake.book) view — the CORE browse/manage surface over every mistake note.
// Rendered through the registered view (getView("mistake.book")), with entityClient.allNotes
// spied (the same 全库 seam the view uses at runtime) and the built-in note types registered
// so the mistake card/editor actually render. Covers:
//   • only mistake notes list (a non-mistake note is excluded), across two sources
//   • a legacy `textbook.mistake` record is INCLUDED (the capability is alias-aware)
//   • the mastery filter narrows 弱项 to weak/unknown
//   • note.delete dispatches with the row's id
//   • the empty state renders when nothing qualifies
//   • 复习错题 sets the pending review scope + navigates the review runner (Commit 2)

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactElement, ReactNode } from "react";
import { entityClient, type NoteRecord, type SourceRecord, type WorkspaceNode } from "../data/entityClient";
import { setLocale } from "../i18n";
import { getView, type WorkspaceContext } from "./viewRegistry";

const navigateShell = vi.hoisted(() => vi.fn(() => true));
vi.mock("./shellNav", () => ({ navigateShell }));

// Side effects: the built-in note types (incl. the core mistake render/edit) + the view.
import "../notes/builtinNoteTypes";
import "./mistakeBookView";
import { consumePendingReviewScope } from "../review/reviewScope";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SRC_A = "src_a";
const SRC_B = "src_b";

function mistake(
  id: string,
  over: Partial<NoteRecord & { createdAt: string; content: Record<string, unknown> }> = {}
): NoteRecord {
  const { content, ...rest } = over;
  return {
    id,
    sourceId: SRC_A,
    anchorIds: [],
    conceptIds: [],
    contentType: "mistake",
    content: { question: `Q-${id}`, wrongAnswer: "错的", correctAnswer: "对的", retryCount: 0, mastery: "weak", ...content },
    visibility: "private",
    layerIds: [],
    ...rest
  } as unknown as NoteRecord;
}

function plainNote(id: string): NoteRecord {
  return {
    id,
    sourceId: SRC_A,
    anchorIds: [],
    conceptIds: [],
    contentType: "markdown",
    content: "just prose",
    visibility: "private",
    layerIds: []
  } as unknown as NoteRecord;
}

const SOURCES: SourceRecord[] = [
  { id: SRC_A, title: "物理课本", sourceType: "html", path: "", contentHash: "" },
  { id: SRC_B, title: "数学练习", sourceType: "html", path: "", contentHash: "" }
];

function fakeCtx(over: Partial<Record<keyof WorkspaceContext, unknown>> = {}): WorkspaceContext {
  return {
    dispatch: vi.fn(async () => {}),
    sources: SOURCES,
    activeSourceId: SRC_A,
    ...over
  } as unknown as WorkspaceContext;
}

function mount(el: ReactNode): { container: HTMLElement; root: Root; cleanup: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(el as ReactElement));
  return {
    container,
    root,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    }
  };
}

async function renderBook(ctx: WorkspaceContext): Promise<{ container: HTMLElement; cleanup: () => void }> {
  const plugin = getView("mistake.book");
  expect(plugin).toBeTruthy();
  const node = { id: "mistakes", kind: "mistake.book" } as WorkspaceNode;
  const mounted = mount(<>{plugin!.render(node, ctx)}</>);
  await act(async () => {}); // flush the allNotes load
  return mounted;
}

beforeEach(() => {
  setLocale("zh");
  document.body.innerHTML = "";
  navigateShell.mockClear();
  consumePendingReviewScope(); // clear any leaked scope from a prior test
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("mistake.book view", () => {
  it("lists ONLY mistake notes (across sources), excluding a non-mistake note", async () => {
    vi.spyOn(entityClient, "allNotes").mockResolvedValue({
      notes: [
        mistake("m_weak", { sourceId: SRC_A, content: { mastery: "weak" }, createdAt: "2026-03-01T00:00:00.000Z" }),
        mistake("m_improving", { sourceId: SRC_B, content: { mastery: "improving" }, createdAt: "2026-03-02T00:00:00.000Z" }),
        mistake("m_mastered", { sourceId: SRC_B, content: { mastery: "mastered" }, createdAt: "2026-03-03T00:00:00.000Z" }),
        plainNote("n_md")
      ]
    });

    const { container, cleanup } = await renderBook(fakeCtx());
    const rows = container.querySelectorAll(".mistake-book-item");
    expect(rows.length).toBe(3);
    const ids = Array.from(rows).map((el) => el.getAttribute("data-note-id"));
    expect(ids).not.toContain("n_md");
    expect(new Set(ids)).toEqual(new Set(["m_weak", "m_improving", "m_mastered"]));
    // Each mistake renders through its note-type (the tb-mistake card markup).
    expect(container.querySelector(".tb-mistake")).toBeTruthy();
    cleanup();
  });

  it("includes a LEGACY textbook.mistake record (capability is alias-aware)", async () => {
    vi.spyOn(entityClient, "allNotes").mockResolvedValue({
      notes: [mistake("m_legacy", { contentType: "textbook.mistake" }), plainNote("n_md")]
    });
    const { container, cleanup } = await renderBook(fakeCtx());
    const rows = container.querySelectorAll(".mistake-book-item");
    expect(rows.length).toBe(1);
    expect(rows[0].getAttribute("data-note-id")).toBe("m_legacy");
    cleanup();
  });

  it("the 弱项 mastery filter narrows to weak/unknown mistakes", async () => {
    vi.spyOn(entityClient, "allNotes").mockResolvedValue({
      notes: [
        mistake("m_weak", { content: { mastery: "weak" } }),
        mistake("m_unknown", { content: { mastery: "unknown" } }),
        mistake("m_improving", { content: { mastery: "improving" } }),
        mistake("m_mastered", { content: { mastery: "mastered" } })
      ]
    });
    const { container, cleanup } = await renderBook(fakeCtx());
    expect(container.querySelectorAll(".mistake-book-item").length).toBe(4);

    const weakChip = Array.from(container.querySelectorAll(".mistake-book-chip")).find(
      (el) => el.textContent === "弱项"
    ) as HTMLButtonElement;
    expect(weakChip).toBeTruthy();
    act(() => weakChip.click());

    const ids = Array.from(container.querySelectorAll(".mistake-book-item")).map((el) =>
      el.getAttribute("data-note-id")
    );
    expect(new Set(ids)).toEqual(new Set(["m_weak", "m_unknown"])); // improving/mastered hidden
    cleanup();
  });

  it("deleting a mistake dispatches note.delete with its id", async () => {
    const dispatch = vi.fn(async () => {});
    vi.spyOn(entityClient, "allNotes").mockResolvedValue({ notes: [mistake("m_weak")] });
    const { container, cleanup } = await renderBook(fakeCtx({ dispatch }));
    act(() => (container.querySelector(".mistake-book-delete") as HTMLButtonElement).click());
    expect(dispatch).toHaveBeenCalledWith("note.delete", { noteId: "m_weak" });
    cleanup();
  });

  it("renders the empty state when there are no mistakes", async () => {
    vi.spyOn(entityClient, "allNotes").mockResolvedValue({ notes: [plainNote("n_md")] });
    const { container, cleanup } = await renderBook(fakeCtx());
    expect(container.querySelector(".mistake-book-item")).toBeNull();
    expect(container.querySelector(".mistake-book-empty")).toBeTruthy();
    cleanup();
  });

  it("复习错题 sets the pending review scope + navigates the review runner", async () => {
    vi.spyOn(entityClient, "allNotes").mockResolvedValue({ notes: [mistake("m_weak")] });
    const { container, cleanup } = await renderBook(fakeCtx());

    const launch = container.querySelector(".mistake-book-launch") as HTMLButtonElement;
    expect(launch.disabled).toBe(false);
    act(() => launch.click());

    expect(navigateShell).toHaveBeenCalledWith({ type: "pane", kind: "review.panel" });
    // The scope was armed for the next review mount (consume-once).
    expect(consumePendingReviewScope()).toBe("mistakes");
    cleanup();
  });
});
