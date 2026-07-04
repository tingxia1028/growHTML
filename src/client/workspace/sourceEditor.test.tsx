// @vitest-environment jsdom
// SRC-1/2 — the authored editor view (sourceEditor.tsx) + its routing seam
// (readerForSource): the kid-first toolbar transform (buttons insert/wrap markdown —
// zero syntax knowledge), the LIVE preview through the existing markdown renderer,
// plain typing untouched, the html source editor, the save → 受影响的锚点 surfacing,
// the shared-source edit warning, and the authored-vs-imported routing guard.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import type { ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

// Keep the readerForSource static import graph jsdom-safe (same stubs as the other
// workspace view tests): reader modules pull pdf.js/webview code needing canvas.
vi.mock("../PdfReader", () => ({ PdfReader: () => null }));
vi.mock("../ImageReader", () => ({ ImageReader: () => null }));
vi.mock("../WebviewReader", () => ({ WebviewReader: () => null }));
vi.mock("../LocalHtmlReader", () => ({ LocalHtmlReader: () => null }));

// The editor consumes the workspace through useWorkspace() — stub the hook with a
// minimal ctx (reload/loadSources/anchors/focus) instead of mounting the provider.
const workspaceCtx = {
  reloadActiveSource: vi.fn().mockResolvedValue(undefined),
  loadSources: vi.fn().mockResolvedValue(undefined),
  anchors: [] as Array<{ id: string }>,
  focus: { setAnchor: vi.fn() }
};
vi.mock("./WorkspaceContext", () => ({
  useWorkspace: () => workspaceCtx
}));

import type { SourceRecord } from "../data/entityClient";
import { setLocale } from "../i18n";
import {
  applyMarkdownAction,
  AuthoredSourceView,
  resetSharedEditConfirmationsForTests
} from "./sourceEditor";
import { readerForSource } from "./readerForSource";
import { setSourceAuthoringIoForTests, type SaveContentOutcome } from "./sourceAuthoringIo";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PLACEHOLDERS = { bold: "加粗文字", heading: "标题", listItem: "列表项", quote: "引用内容" };

function authoredSource(sourceType: "markdown" | "html", id = "src_authored"): SourceRecord {
  return {
    id,
    title: "未命名文档",
    sourceType,
    path: `${id}.md`,
    contentHash: "sha256:aa",
    origin: "authored",
    revision: 1
  } as unknown as SourceRecord;
}

let container: HTMLDivElement;
let root: Root | null = null;

async function mount(element: ReactElement): Promise<void> {
  root = createRoot(container);
  await act(async () => root!.render(element));
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

function typeInTextarea(textarea: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
  setter.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

function editorTextarea(): HTMLTextAreaElement {
  const textarea = container.querySelector(".source-editor-input") as HTMLTextAreaElement | null;
  expect(textarea).toBeTruthy();
  return textarea!;
}

const saveOutcome = (anchors: SaveContentOutcome["reprojection"]["anchors"]): SaveContentOutcome => ({
  source: { id: "src_authored", title: "未命名文档", revision: 2, contentHash: "sha256:bb" },
  reprojection: {
    total: anchors.length,
    matched: anchors.filter((a) => a.status === "matched").length,
    fuzzy: anchors.filter((a) => a.status === "fuzzy").length,
    unmatched: anchors.filter((a) => a.status === "unmatched").length,
    anchors
  }
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  workspaceCtx.reloadActiveSource.mockClear();
  workspaceCtx.loadSources.mockClear();
  workspaceCtx.focus.setAnchor.mockClear();
  workspaceCtx.anchors = [];
  resetSharedEditConfirmationsForTests();
  setSourceAuthoringIoForTests({
    fetchContent: vi.fn().mockResolvedValue(""),
    fetchShareStatus: vi
      .fn()
      .mockResolvedValue({ shared: false, publishedPackCount: 0, importedLayerCount: 0 }),
    saveContent: vi.fn().mockResolvedValue(saveOutcome([])),
    createAuthored: vi.fn()
  });
});

afterEach(async () => {
  await unmount();
  container.remove();
  setSourceAuthoringIoForTests(null);
  setLocale("zh");
  vi.restoreAllMocks();
});

// —— the pure toolbar transform ————————————————————————————————————————————————————

describe("applyMarkdownAction — buttons produce correct markdown", () => {
  it("bold wraps the selection and keeps the rest untouched", () => {
    const result = applyMarkdownAction("细胞是生命的单位", 0, 2, "bold", PLACEHOLDERS);
    expect(result.value).toBe("**细胞**是生命的单位");
    expect(result.value.slice(result.selectionStart, result.selectionEnd)).toBe("细胞");
  });

  it("bold with an empty selection inserts a SELECTED placeholder (type-to-replace)", () => {
    const result = applyMarkdownAction("", 0, 0, "bold", PLACEHOLDERS);
    expect(result.value).toBe("**加粗文字**");
    expect(result.value.slice(result.selectionStart, result.selectionEnd)).toBe("加粗文字");
  });

  it("heading prefixes the current line and toggles off on a second press", () => {
    const once = applyMarkdownAction("我的标题\n正文", 1, 1, "heading", PLACEHOLDERS);
    expect(once.value).toBe("# 我的标题\n正文");
    const twice = applyMarkdownAction(once.value, 2, 2, "heading", PLACEHOLDERS);
    expect(twice.value).toBe("我的标题\n正文");
  });

  it("subheading replaces an existing heading level instead of stacking #s", () => {
    const result = applyMarkdownAction("# 我的标题", 4, 4, "subheading", PLACEHOLDERS);
    expect(result.value).toBe("## 我的标题");
  });

  it("list prefixes every selected line; ordered numbers them", () => {
    const value = "苹果\n香蕉\n橘子";
    const list = applyMarkdownAction(value, 0, value.length, "list", PLACEHOLDERS);
    expect(list.value).toBe("- 苹果\n- 香蕉\n- 橘子");
    const ordered = applyMarkdownAction(value, 0, value.length, "ordered", PLACEHOLDERS);
    expect(ordered.value).toBe("1. 苹果\n2. 香蕉\n3. 橘子");
  });

  it("quote prefixes the line and an empty line gets a selected placeholder", () => {
    expect(applyMarkdownAction("一句话", 0, 0, "quote", PLACEHOLDERS).value).toBe("> 一句话");
    expect(applyMarkdownAction("", 0, 0, "quote", PLACEHOLDERS).value).toBe("> 引用内容");
  });
});

// —— the view ————————————————————————————————————————————————————————————————————————

describe("AuthoredSourceView — kid-first markdown editing", () => {
  it("a BLANK authored markdown doc opens straight into 编辑 mode (typing in seconds)", async () => {
    await mount(<AuthoredSourceView source={authoredSource("markdown")} reader={<div />} />);
    expect(container.querySelector(".source-editor-host")?.getAttribute("data-mode")).toBe("edit");
    expect(editorTextarea()).toBeTruthy();
    expect(container.querySelector(".source-editor-toolbar")).toBeTruthy();
  });

  it("plain typing stays plain, and the LIVE preview renders through the markdown renderer", async () => {
    await mount(<AuthoredSourceView source={authoredSource("markdown")} reader={<div />} />);
    const textarea = editorTextarea();
    await act(async () => typeInTextarea(textarea, "你好,世界。\n\n**重点**记住。"));
    expect(textarea.value).toBe("你好,世界。\n\n**重点**记住。");
    const preview = container.querySelector(".source-editor-preview-body")!;
    expect(preview.innerHTML).toContain("<p>你好,世界。</p>");
    expect(preview.innerHTML).toContain("<strong>重点</strong>");
  });

  it("toolbar buttons transform the textarea content (bold around the selection)", async () => {
    await mount(<AuthoredSourceView source={authoredSource("markdown")} reader={<div />} />);
    const textarea = editorTextarea();
    await act(async () => typeInTextarea(textarea, "细胞是生命的单位"));
    textarea.setSelectionRange(0, 2);
    await click(container.querySelector('[data-md-action="bold"]'));
    expect(editorTextarea().value).toBe("**细胞**是生命的单位");
    await click(container.querySelector('[data-md-action="heading"]'));
    expect(editorTextarea().value.startsWith("# ")).toBe(true);
  });

  it("an authored HTML page defaults to the in-place page editor, 源码 stays reachable", async () => {
    setSourceAuthoringIoForTests({
      fetchContent: vi.fn().mockResolvedValue("<h1>Hi</h1>"),
      fetchShareStatus: vi.fn().mockResolvedValue({ shared: false, publishedPackCount: 0, importedLayerCount: 0 })
    });
    await mount(<AuthoredSourceView source={authoredSource("html", "src_html")} reader={<div />} />);
    // Non-blank content → starts in 阅读 mode; enter 编辑 explicitly.
    await click(container.querySelectorAll(".source-editor-mode-btn")[1]);
    // SRC-2b: 所见即改 is the default — no markdown toolbar, no raw textarea.
    expect(container.querySelector(".source-editor-toolbar")).toBeNull();
    expect(container.querySelector(".source-editor-inplace-frame")).toBeTruthy();
    expect(container.querySelector(".source-editor-input-html")).toBeNull();
    // The 源码 escape hatch: raw source editor + sandboxed live preview.
    await click(container.querySelector('[data-html-view="source"]'));
    expect(container.querySelector(".source-editor-input-html")).toBeTruthy();
    expect(container.querySelector(".source-editor-html-preview")).toBeTruthy();
  });

  it("saves through the SRC-2 pipeline, reloads the reader, and lists 受影响的锚点", async () => {
    const saveContent = vi.fn().mockResolvedValue(
      saveOutcome([
        { anchorId: "anchor_ok", status: "matched", quote: "还在的划线" },
        { anchorId: "anchor_lost", status: "unmatched", quote: "被改掉的段落" }
      ])
    );
    setSourceAuthoringIoForTests({
      fetchContent: vi.fn().mockResolvedValue(""),
      fetchShareStatus: vi.fn().mockResolvedValue({ shared: false, publishedPackCount: 0, importedLayerCount: 0 }),
      saveContent
    });
    await mount(<AuthoredSourceView source={authoredSource("markdown")} reader={<div />} />);
    await act(async () => typeInTextarea(editorTextarea(), "新的内容"));
    await click(container.querySelector(".source-editor-save"));

    expect(saveContent).toHaveBeenCalledWith("src_authored", { content: "新的内容", title: undefined });
    expect(workspaceCtx.reloadActiveSource).toHaveBeenCalledTimes(1);

    const affected = container.querySelector(".source-editor-affected")!;
    expect(affected.textContent).toContain("受影响的锚点");
    expect(affected.textContent).toContain("被改掉的段落");
    // Matched anchors are NOT noise in the list.
    expect(affected.textContent).not.toContain("还在的划线");
  });

  it("warns before the FIRST edit of a shared source and respects cancel", async () => {
    setSourceAuthoringIoForTests({
      fetchContent: vi.fn().mockResolvedValue("已有内容"),
      fetchShareStatus: vi.fn().mockResolvedValue({ shared: true, publishedPackCount: 1, importedLayerCount: 0 })
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    await mount(<AuthoredSourceView source={authoredSource("markdown")} reader={<div />} />);
    expect(container.querySelector(".source-editor-host")?.getAttribute("data-mode")).toBe("read");

    // Cancel keeps 阅读 mode.
    await click(container.querySelectorAll(".source-editor-mode-btn")[1]);
    expect(confirmSpy).toHaveBeenCalledWith("已分享过的文档,编辑会使旧分享包无法绑定。仍要编辑吗?");
    expect(container.querySelector(".source-editor-host")?.getAttribute("data-mode")).toBe("read");

    // Confirm enters 编辑 mode.
    confirmSpy.mockReturnValue(true);
    await click(container.querySelectorAll(".source-editor-mode-btn")[1]);
    expect(container.querySelector(".source-editor-host")?.getAttribute("data-mode")).toBe("edit");
  });

  it("does NOT warn for unshared sources", async () => {
    setSourceAuthoringIoForTests({
      fetchContent: vi.fn().mockResolvedValue("已有内容"),
      fetchShareStatus: vi.fn().mockResolvedValue({ shared: false, publishedPackCount: 0, importedLayerCount: 0 })
    });
    const confirmSpy = vi.spyOn(window, "confirm");
    await mount(<AuthoredSourceView source={authoredSource("markdown")} reader={<div />} />);
    await click(container.querySelectorAll(".source-editor-mode-btn")[1]);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(container.querySelector(".source-editor-host")?.getAttribute("data-mode")).toBe("edit");
  });
});

// —— SRC-2b: HTML 所见即改 (in-place page editing) ————————————————————————————————————

describe("AuthoredSourceView — HTML in-place editing (SRC-2b)", () => {
  async function mountHtmlInEdit(content: string): Promise<{
    frame: HTMLIFrameElement;
    doc: Document;
    saveContent: ReturnType<typeof vi.fn>;
  }> {
    const saveContent = vi.fn().mockResolvedValue(saveOutcome([]));
    setSourceAuthoringIoForTests({
      fetchContent: vi.fn().mockResolvedValue(content),
      fetchShareStatus: vi
        .fn()
        .mockResolvedValue({ shared: false, publishedPackCount: 0, importedLayerCount: 0 }),
      saveContent
    });
    await mount(<AuthoredSourceView source={authoredSource("html", "src_html")} reader={<div />} />);
    await click(container.querySelectorAll(".source-editor-mode-btn")[1]);
    const frame = container.querySelector(".source-editor-inplace-frame") as HTMLIFrameElement;
    expect(frame).toBeTruthy();
    const doc = frame.contentDocument!;
    expect(doc).toBeTruthy();
    return { frame, doc, saveContent };
  }

  /** Dispatch inside the FRAME's realm (its own window's Event constructor). */
  function fireInFrame(doc: Document, target: Node, type: string): void {
    const win = doc.defaultView!;
    target.dispatchEvent(new win.Event(type, { bubbles: true }));
  }

  it("arms the page for editing: contenteditable body + the loaded content", async () => {
    const { doc } = await mountHtmlInEdit('<h1 data-study-id="html-1">Hi</h1>');
    expect(doc.body.getAttribute("contenteditable")).toBe("true");
    expect(doc.querySelector('h1[data-study-id="html-1"]')?.textContent).toBe("Hi");
  });

  it("typing in place marks dirty and 保存 sends the SANITIZED html through the SRC-2 pipeline", async () => {
    const { doc, saveContent } = await mountHtmlInEdit('<p data-study-id="html-1">原文</p>');
    doc.querySelector("p")!.textContent = "改过的文字";
    await act(async () => fireInFrame(doc, doc.body, "input"));
    expect(container.querySelector(".source-editor-dirty")).toBeTruthy();

    await click(container.querySelector(".source-editor-save"));
    expect(saveContent).toHaveBeenCalledWith("src_html", {
      // Sanitized fragment: the edit kept, contenteditable/editing-style artifacts gone.
      content: '<p data-study-id="html-1">改过的文字</p>',
      title: undefined
    });
    expect(workspaceCtx.reloadActiveSource).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".source-editor-dirty")).toBeNull();
  });

  it("页面编辑 ⇄ 源码 round-trips the content BOTH ways", async () => {
    const { doc } = await mountHtmlInEdit("<h2>题</h2><p>身</p>");
    expect(doc.querySelector("p")?.textContent).toBe("身");

    // Page → source: the textarea shows the serialized page.
    await click(container.querySelector('[data-html-view="source"]'));
    const textarea = container.querySelector(".source-editor-input-html") as HTMLTextAreaElement;
    expect(textarea.value).toBe("<h2>题</h2><p>身</p>");

    // Hand-edit the source, then back to the page: the frame shows the change.
    await act(async () => typeInTextarea(textarea, "<h2>题</h2><p>新的身</p>"));
    await click(container.querySelector('[data-html-view="page"]'));
    const frame = container.querySelector(".source-editor-inplace-frame") as HTMLIFrameElement;
    expect(frame.contentDocument!.querySelector("p")?.textContent).toBe("新的身");

    // And back to source once more — nothing was lost on the way through.
    await click(container.querySelector('[data-html-view="source"]'));
    expect((container.querySelector(".source-editor-input-html") as HTMLTextAreaElement).value).toBe(
      "<h2>题</h2><p>新的身</p>"
    );
  });

  it("leaving 编辑 for 阅读 pulls unsaved in-place edits into the draft (nothing lost)", async () => {
    const { doc } = await mountHtmlInEdit("<p>原文</p>");
    doc.querySelector("p")!.textContent = "没保存的修改";
    await act(async () => fireInFrame(doc, doc.body, "input"));

    await click(container.querySelectorAll(".source-editor-mode-btn")[0]); // 阅读
    await click(container.querySelectorAll(".source-editor-mode-btn")[1]); // 编辑 again
    const frame = container.querySelector(".source-editor-inplace-frame") as HTMLIFrameElement;
    expect(frame.contentDocument!.querySelector("p")?.textContent).toBe("没保存的修改");
    expect(container.querySelector(".source-editor-dirty")).toBeTruthy();
  });

  it("selecting text floats the style bar and 加粗 bolds in place (then saves that way)", async () => {
    const { doc, saveContent } = await mountHtmlInEdit("<p>要加粗的字</p>");
    const text = doc.querySelector("p")!.firstChild!;
    const selection = (doc.defaultView ?? window).getSelection?.() ?? doc.getSelection();
    expect(selection).toBeTruthy();
    const range = doc.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 2);
    selection!.removeAllRanges();
    selection!.addRange(range);
    await act(async () => fireInFrame(doc, doc, "selectionchange"));

    const bar = container.querySelector(".source-editor-stylebar");
    expect(bar).toBeTruthy();
    await click(bar!.querySelector('[data-style-action="bold"]'));
    expect(doc.querySelector("p")!.innerHTML).toBe("<b>要加</b>粗的字");

    await click(container.querySelector(".source-editor-save"));
    expect(saveContent).toHaveBeenCalledWith("src_html", {
      content: "<p><b>要加</b>粗的字</p>",
      title: undefined
    });
  });
});

// —— routing (readerForSource) ————————————————————————————————————————————————————

describe("readerForSource — authored routes to the editor view, imported stays a plain reader", () => {
  const readerArgs = (source: SourceRecord) => ({
    source,
    anchors: [],
    onSelect: vi.fn(),
    renderedHtml: "",
    annotationMode: "floating" as const
  });

  it("wraps an authored markdown source in the editor chrome", async () => {
    await mount(<>{readerForSource(readerArgs(authoredSource("markdown")))}</>);
    expect(container.querySelector(".source-editor-host")).toBeTruthy();
  });

  it("leaves an imported source on the plain reader with NO editor entry", async () => {
    const imported = {
      id: "src_imported",
      title: "导入的文档",
      sourceType: "markdown",
      path: "x.md",
      contentHash: "sha256:cc",
      origin: "imported",
      revision: 1
    } as unknown as SourceRecord;
    await mount(<>{readerForSource(readerArgs(imported))}</>);
    expect(container.querySelector(".source-editor-host")).toBeNull();
    expect(container.querySelector(".source-editor-mode-btn")).toBeNull();
  });

  it("treats legacy records WITHOUT origin as imported (read-only body)", async () => {
    const legacy = {
      id: "src_legacy",
      title: "老文档",
      sourceType: "html",
      path: "x.html",
      contentHash: "sha256:dd"
    } as unknown as SourceRecord;
    await mount(<>{readerForSource(readerArgs(legacy))}</>);
    expect(container.querySelector(".source-editor-host")).toBeNull();
  });
});
