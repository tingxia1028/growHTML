// @vitest-environment jsdom
// SRC-4 — the pure DOM logic behind rich HTML editing (richEditor.ts): block insertion
// at the caret (heading/list/quote/callout/divider/table/image) and template application
// (replace an empty page vs insert after the caret). Same jsdom + real-selection idiom as
// htmlInPlace.test.ts; every transform emits SIMPLE HTML that round-trips through the
// SRC-2b serialize/sanitize path unchanged.
import { beforeEach, describe, expect, it } from "vitest";
import { insertRichBlock, applyTemplate, type RichBlockKind, type RichBlockLabels } from "./richEditor";
import { sanitizeEditedDom } from "./htmlInPlace";

const LABELS: RichBlockLabels = {
  heading: "大标题",
  subheading: "小标题",
  paragraph: "正文",
  listItem: "列表项",
  quote: "引用",
  callout: "提示",
  tableCell: "单元格",
  imageAlt: "图片"
};

beforeEach(() => {
  document.body.innerHTML = "";
  document.getSelection()?.removeAllRanges();
});

function setCaret(node: Node, offset: number): void {
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  const range = document.createRange();
  range.setStart(node, offset);
  range.setEnd(node, offset);
  selection.addRange(range);
}

const insert = (kind: RichBlockKind) => insertRichBlock(document, kind, LABELS);

// —— block insertion ————————————————————————————————————————————————————————————————

describe("insertRichBlock — drops a whole block after the caret's block", () => {
  it("a heading lands after the caret's paragraph and carries the placeholder text", () => {
    document.body.innerHTML = "<p>第一段</p>";
    setCaret(document.querySelector("p")!.firstChild!, 1);
    expect(insert("heading")).toBe(true);
    expect(document.body.innerHTML).toBe("<p>第一段</p><h1>大标题</h1>");
  });

  it("a bullet list produces a real <ul> with three items", () => {
    document.body.innerHTML = "<p>x</p>";
    setCaret(document.querySelector("p")!.firstChild!, 0);
    expect(insert("bulletList")).toBe(true);
    const list = document.querySelector("ul")!;
    expect(list.querySelectorAll("li").length).toBe(3);
    expect(list.querySelector("li")!.textContent).toBe("列表项");
  });

  it("a numbered list is an <ol>; a quote is a <blockquote>; a divider is an <hr>", () => {
    document.body.appendChild(document.createElement("p"));
    setCaret(document.body.firstChild!, 0);
    expect(insert("numberList")).toBe(true);
    expect(document.querySelector("ol")).toBeTruthy();
    expect(insert("quote")).toBe(true);
    expect(document.querySelector("blockquote")?.textContent).toBe("引用");
    expect(insert("divider")).toBe(true);
    expect(document.querySelector("hr")).toBeTruthy();
  });

  it("a callout is a styled box; a table is a 2×2 with a header row", () => {
    document.body.innerHTML = "<p>x</p>";
    setCaret(document.querySelector("p")!.firstChild!, 0);
    expect(insert("callout")).toBe(true);
    const callout = document.querySelector("div[style]")!;
    expect(callout.querySelector("p")?.textContent).toBe("提示");

    expect(insert("table")).toBe(true);
    const table = document.querySelector("table")!;
    expect(table.querySelectorAll("th").length).toBe(2);
    expect(table.querySelectorAll("td").length).toBe(2);
  });

  it("an image is an <img> with a keepable (non-javascript:) data-URI src", () => {
    document.body.innerHTML = "<p>x</p>";
    setCaret(document.querySelector("p")!.firstChild!, 0);
    expect(insert("image")).toBe(true);
    const img = document.querySelector("img")!;
    expect(img.getAttribute("src")?.startsWith("data:image/svg+xml")).toBe(true);
    expect(img.getAttribute("alt")).toBe("图片");
  });

  it("with NO selection the block appends at the end of body", () => {
    document.body.innerHTML = "<h1>标题</h1>";
    expect(insert("paragraph")).toBe(true);
    expect(document.body.innerHTML).toBe("<h1>标题</h1><p>正文</p>");
  });

  it("inserted blocks survive the SRC-2b sanitizer unchanged (simple markup by construction)", () => {
    document.body.innerHTML = "<p>x</p>";
    setCaret(document.querySelector("p")!.firstChild!, 0);
    insert("heading");
    insert("callout");
    insert("table");
    const before = document.body.innerHTML;
    const host = document.createElement("div");
    host.innerHTML = before;
    sanitizeEditedDom(host);
    expect(host.innerHTML).toBe(before);
  });
});

// —— templates ————————————————————————————————————————————————————————————————————————

describe("applyTemplate — start-from vs add-a-section", () => {
  const TEMPLATE = "<h1>课堂标题</h1><ul><li>要点一</li><li>要点二</li></ul>";

  it("replace mode swaps the whole body and re-arms contenteditable", () => {
    document.body.innerHTML = "<p><br></p>";
    document.body.removeAttribute("contenteditable");
    expect(applyTemplate(document, TEMPLATE, "replace")).toBe(true);
    expect(document.body.innerHTML).toBe(TEMPLATE);
    expect(document.body.getAttribute("contenteditable")).toBe("true");
  });

  it("insert mode drops the template AFTER the caret's block, keeping existing content", () => {
    document.body.innerHTML = "<p>已有内容</p>";
    setCaret(document.querySelector("p")!.firstChild!, 1);
    expect(applyTemplate(document, TEMPLATE, "insert")).toBe(true);
    expect(document.body.innerHTML).toBe(`<p>已有内容</p>${TEMPLATE}`);
  });

  it("insert with no selection appends the template at the end", () => {
    document.body.innerHTML = "<p>a</p>";
    expect(applyTemplate(document, TEMPLATE, "insert")).toBe(true);
    expect(document.body.innerHTML).toBe(`<p>a</p>${TEMPLATE}`);
  });

  it("only the template's BODY children are imported — a whole-document template is unwrapped", () => {
    document.body.innerHTML = "";
    const full = "<!DOCTYPE html><html><head><title>x</title></head><body><h2>只要这个</h2></body></html>";
    expect(applyTemplate(document, full, "replace")).toBe(true);
    expect(document.body.innerHTML).toBe("<h2>只要这个</h2>");
    expect(document.querySelector("title")).toBeNull();
  });

  it("an empty template is a no-op (false)", () => {
    document.body.innerHTML = "<p>x</p>";
    expect(applyTemplate(document, "   ", "replace")).toBe(false);
    expect(document.body.innerHTML).toBe("<p>x</p>");
  });
});
