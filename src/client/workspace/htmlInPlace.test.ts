// @vitest-environment jsdom
// SRC-2b — the pure DOM logic behind HTML 所见即改 (htmlInPlace.ts): shape detection,
// the editing-document round trip (prepare → serialize strips EVERY editing artifact
// and keeps user formatting + data-study-id), the light blacklist sanitizer, and the
// floating style bar's actions as deterministic DOM transforms (built on real
// selections over the jsdom document, the DomReader.test idiom).
import { beforeEach, describe, expect, it } from "vitest";
import {
  applyInPlaceStyle,
  detectHtmlShape,
  EDITING_MARKER_ATTR,
  prepareEditingDocument,
  sanitizeEditedDom,
  serializeEditingDocument,
  type InPlaceStyleAction
} from "./htmlInPlace";

beforeEach(() => {
  document.body.innerHTML = "";
  document.getSelection()?.removeAllRanges();
});

// A standalone full document (no browsing context needed for prepare/serialize).
function freshDoc(): Document {
  return document.implementation.createHTMLDocument("");
}

function setSelection(startNode: Node, startOffset: number, endNode: Node, endOffset: number): void {
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  selection.addRange(range);
}

function setCaret(node: Node, offset: number): void {
  setSelection(node, offset, node, offset);
}

const apply = (action: InPlaceStyleAction) => applyInPlaceStyle(document, action);

// —— shape detection ————————————————————————————————————————————————————————————————

describe("detectHtmlShape", () => {
  it("bare markup is a fragment", () => {
    expect(detectHtmlShape("<h1>Hi</h1><p>Body</p>")).toEqual({ kind: "fragment", hasDoctype: false });
  });

  it("an <html> wrapper makes it a document; a doctype is remembered", () => {
    expect(detectHtmlShape("<html><body>x</body></html>")).toEqual({ kind: "document", hasDoctype: false });
    expect(detectHtmlShape("<!DOCTYPE html>\n<html><body>x</body></html>")).toEqual({
      kind: "document",
      hasDoctype: true
    });
    expect(detectHtmlShape("  <!doctype html><html><body>x</body></html>")).toEqual({
      kind: "document",
      hasDoctype: true
    });
  });
});

// —— prepare → serialize round trip ————————————————————————————————————————————————

describe("prepareEditingDocument → serializeEditingDocument round trip", () => {
  it("arms the document for editing (contenteditable body + marked editing style)", () => {
    const doc = freshDoc();
    prepareEditingDocument(doc, "<p>正文</p>");
    expect(doc.body.getAttribute("contenteditable")).toBe("true");
    expect(doc.head.querySelector(`style[${EDITING_MARKER_ATTR}]`)).toBeTruthy();
    expect(doc.body.innerHTML).toBe("<p>正文</p>");
  });

  it("a fragment round-trips VERBATIM minus artifacts — study ids and formatting kept", () => {
    const doc = freshDoc();
    const source =
      '<h1 data-study-id="html-1">标题</h1>' +
      '<p data-study-id="html-2"><b>粗</b>体和<span style="color: red">红字</span></p>';
    prepareEditingDocument(doc, source);
    const out = serializeEditingDocument(doc, detectHtmlShape(source));
    expect(out).toBe(source);
  });

  it("a full document keeps its head, html wrapper and doctype", () => {
    const source = "<!DOCTYPE html>\n<html><head><title>练习页</title></head><body><p>x</p></body></html>";
    const doc = freshDoc();
    prepareEditingDocument(doc, source);
    const out = serializeEditingDocument(doc, detectHtmlShape(source));
    expect(out.startsWith("<!DOCTYPE html>\n<html>")).toBe(true);
    expect(out).toContain("<title>练习页</title>");
    expect(out).toContain("<p>x</p>");
    expect(out).not.toContain("contenteditable");
    expect(out).not.toContain(EDITING_MARKER_ATTR);
  });

  it("an empty source seeds an editable empty paragraph", () => {
    const doc = freshDoc();
    prepareEditingDocument(doc, "   ");
    expect(doc.body.innerHTML).toBe("<p><br></p>");
  });

  it("edits made to the live DOM come out serialized and sanitized", () => {
    const doc = freshDoc();
    prepareEditingDocument(doc, '<p data-study-id="html-1">原文</p>');
    doc.querySelector("p")!.textContent = "改过的文字";
    const out = serializeEditingDocument(doc, { kind: "fragment", hasDoctype: false });
    expect(out).toBe('<p data-study-id="html-1">改过的文字</p>');
  });
});

// —— the light sanitizer (blacklist: artifacts out, user markup stays) ————————————————

describe("sanitizeEditedDom", () => {
  function sanitized(html: string): string {
    const host = document.createElement("div");
    host.innerHTML = html;
    sanitizeEditedDom(host);
    return host.innerHTML;
  }

  it("strips contenteditable and inline event handlers everywhere", () => {
    expect(
      sanitized('<div contenteditable="true"><p onclick="alert(1)" onmouseover="x()">hi</p></div>')
    ).toBe("<div><p>hi</p></div>");
    expect(sanitized('<img src="a.png" onerror="steal()">')).toBe('<img src="a.png">');
  });

  it("drops javascript:/vbscript: URLs but keeps normal links", () => {
    expect(sanitized('<a href="javascript:alert(1)">x</a>')).toBe("<a>x</a>");
    expect(sanitized('<a href=" JAVASCRIPT:alert(1)">x</a>')).toBe("<a>x</a>");
    expect(sanitized('<a href="https://example.com/a">x</a>')).toBe('<a href="https://example.com/a">x</a>');
  });

  it("removes ANY element carrying our editing marker wholesale (only we create them)", () => {
    expect(
      sanitized(`<style ${EDITING_MARKER_ATTR}="">body{}</style><div ${EDITING_MARKER_ATTR}="">bar</div><p>t</p>`)
    ).toBe("<p>t</p>");
  });

  it("keeps user <script>/<style> elements (never destroy the user's own source)", () => {
    expect(sanitized("<style>p{color:red}</style><script>var x=1;</script><p>t</p>")).toBe(
      "<style>p{color:red}</style><script>var x=1;</script><p>t</p>"
    );
  });

  it("cleans residue: empty style attrs go, attribute-less spans unwrap", () => {
    expect(sanitized('<p style="">a<span>b</span>c</p>')).toBe("<p>abc</p>");
    // A span still carrying meaning stays.
    expect(sanitized('<p><span style="color: blue">b</span></p>')).toBe(
      '<p><span style="color: blue">b</span></p>'
    );
  });

  it("keeps data-study-id (the anchor pipeline's binding attribute)", () => {
    expect(sanitized('<p data-study-id="html-3" contenteditable="true">t</p>')).toBe(
      '<p data-study-id="html-3">t</p>'
    );
  });
});

// —— style-bar actions ————————————————————————————————————————————————————————————————

describe("applyInPlaceStyle — bold/italic", () => {
  it("bold wraps the selection in <b> and a second press unwraps it", () => {
    document.body.innerHTML = "<p>细胞是生命的单位</p>";
    const text = document.querySelector("p")!.firstChild!;
    setSelection(text, 0, text, 2);
    expect(apply({ kind: "bold" })).toBe(true);
    expect(document.querySelector("p")!.innerHTML).toBe("<b>细胞</b>是生命的单位");
    // The selection was re-set onto the wrapped contents — press again to toggle off.
    expect(apply({ kind: "bold" })).toBe(true);
    expect(document.querySelector("p")!.innerHTML).toBe("细胞是生命的单位");
  });

  it("italic wraps in <i>; a caret inside <em> also toggles it off", () => {
    document.body.innerHTML = "<p>a<em>斜体</em>b</p>";
    setCaret(document.querySelector("em")!.firstChild!, 1);
    expect(apply({ kind: "italic" })).toBe(true);
    expect(document.querySelector("p")!.innerHTML).toBe("a斜体b");
  });

  it("a collapsed caret with nothing to unwrap is a no-op", () => {
    document.body.innerHTML = "<p>纯文本</p>";
    setCaret(document.querySelector("p")!.firstChild!, 1);
    expect(apply({ kind: "bold" })).toBe(false);
    expect(document.querySelector("p")!.innerHTML).toBe("纯文本");
  });
});

describe("applyInPlaceStyle — headings", () => {
  it("retags the caret's block to <h1> KEEPING its attributes, and toggles back to <p>", () => {
    document.body.innerHTML = '<p data-study-id="s1">标题行</p>';
    setCaret(document.querySelector("p")!.firstChild!, 1);
    expect(apply({ kind: "block", tag: "h1" })).toBe(true);
    const h1 = document.querySelector("h1")!;
    expect(h1.getAttribute("data-study-id")).toBe("s1");
    expect(h1.textContent).toBe("标题行");

    setCaret(h1.firstChild!, 1);
    expect(apply({ kind: "block", tag: "h1" })).toBe(true);
    expect(document.querySelector("h1")).toBeNull();
    expect(document.querySelector('p[data-study-id="s1"]')!.textContent).toBe("标题行");
  });

  it("h2 on an h1 block re-levels it", () => {
    document.body.innerHTML = "<h1>题</h1>";
    setCaret(document.querySelector("h1")!.firstChild!, 0);
    expect(apply({ kind: "block", tag: "h2" })).toBe(true);
    expect(document.body.innerHTML).toBe("<h2>题</h2>");
  });

  it("bare text directly under body gets wrapped in the heading", () => {
    document.body.appendChild(document.createTextNode("裸文本"));
    setCaret(document.body.firstChild!, 1);
    expect(apply({ kind: "block", tag: "h1" })).toBe(true);
    expect(document.body.innerHTML).toBe("<h1>裸文本</h1>");
  });
});

describe("applyInPlaceStyle — font size and color (simple inline spans)", () => {
  it("大字 wraps a span with font-size and pressing it again removes the span", () => {
    document.body.innerHTML = "<p>要变大的字</p>";
    const text = document.querySelector("p")!.firstChild!;
    setSelection(text, 0, text, 3);
    expect(apply({ kind: "fontSize", value: "large" })).toBe(true);
    const span = document.querySelector("span")!;
    expect(span.style.fontSize).toBe("1.25em");
    expect(span.textContent).toBe("要变大");

    setCaret(span.firstChild!, 1);
    expect(apply({ kind: "fontSize", value: "large" })).toBe(true);
    expect(document.querySelector("span")).toBeNull();
    expect(document.querySelector("p")!.textContent).toBe("要变大的字");
  });

  it("小字 over an existing size span just re-sizes it (no nesting)", () => {
    document.body.innerHTML = '<p><span style="font-size: 1.25em">字</span></p>';
    setCaret(document.querySelector("span")!.firstChild!, 0);
    expect(apply({ kind: "fontSize", value: "small" })).toBe(true);
    expect(document.querySelectorAll("span").length).toBe(1);
    expect(document.querySelector("span")!.style.fontSize).toBe("0.85em");
  });

  it("a color swatch wraps a span; 默认颜色 removes it", () => {
    document.body.innerHTML = "<p>有颜色的字</p>";
    const text = document.querySelector("p")!.firstChild!;
    setSelection(text, 0, text, 3);
    expect(apply({ kind: "color", value: "#d0342c" })).toBe(true);
    const span = document.querySelector("span")!;
    expect(span.style.color).toBeTruthy();

    setCaret(span.firstChild!, 1);
    expect(apply({ kind: "color", value: null })).toBe(true);
    expect(document.querySelector("span")).toBeNull();
  });

  it("pressing the SAME color again toggles it off", () => {
    document.body.innerHTML = "<p>字</p>";
    const text = document.querySelector("p")!.firstChild!;
    setSelection(text, 0, text, 1);
    expect(apply({ kind: "color", value: "#2456c9" })).toBe(true);
    const span = document.querySelector("span")!;
    setCaret(span.firstChild!, 0);
    expect(apply({ kind: "color", value: "#2456c9" })).toBe(true);
    expect(document.querySelector("span")).toBeNull();
  });

  it("默认颜色 with no color span in scope is a no-op", () => {
    document.body.innerHTML = "<p>字</p>";
    setCaret(document.querySelector("p")!.firstChild!, 0);
    expect(apply({ kind: "color", value: null })).toBe(false);
  });
});

describe("applyInPlaceStyle — alignment", () => {
  it("sets text-align on the caret's block and toggles it off (style attr removed)", () => {
    document.body.innerHTML = "<p>居中的段落</p>";
    setCaret(document.querySelector("p")!.firstChild!, 2);
    expect(apply({ kind: "align", value: "center" })).toBe(true);
    expect(document.querySelector("p")!.style.textAlign).toBe("center");

    expect(apply({ kind: "align", value: "center" })).toBe(true);
    expect(document.querySelector("p")!.hasAttribute("style")).toBe(false);
  });

  it("switching alignment replaces the previous one", () => {
    document.body.innerHTML = '<p style="text-align: center">段落</p>';
    setCaret(document.querySelector("p")!.firstChild!, 0);
    expect(apply({ kind: "align", value: "right" })).toBe(true);
    expect(document.querySelector("p")!.style.textAlign).toBe("right");
  });
});
