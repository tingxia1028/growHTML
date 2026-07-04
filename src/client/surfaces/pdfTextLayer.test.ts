// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { selectorFromPdfRange, spansForPdfQuote } from "./pdfTextLayer";

function layer(html: string): HTMLElement {
  document.body.innerHTML = `<div class="textLayer">${html}</div>`;
  return document.querySelector(".textLayer") as HTMLElement;
}

function ids(spans: HTMLElement[]): string[] {
  return spans.map((span) => span.id);
}

describe("pdfTextLayer quote mapping", () => {
  it("uses prefix/suffix to choose one repeated Chinese quote, not every matching span", () => {
    const textLayer = layer(
      '<span id="first-a">十进制</span><span id="first-b">计数法</span><span>。</span>' +
        '<span>计数单位</span><span>。</span>' +
        '<span id="second-a">十进制</span><span id="second-b">计数法</span>'
    );

    expect(
      ids(spansForPdfQuote(textLayer, { exact: "十进制计数法", prefix: "计数单位。", suffix: "" }))
    ).toEqual(["second-a", "second-b"]);
  });

  it("does not mark unrelated spans just because their text is contained in the quote", () => {
    const textLayer = layer(
      '<span id="base-a">十进制</span><span id="base-b">计数法</span><span>。</span>' +
        '<span id="unit-a">计数</span><span id="unit-b">单位</span>'
    );

    expect(ids(spansForPdfQuote(textLayer, { exact: "计数单位", prefix: "法。", suffix: "" }))).toEqual([
      "unit-a",
      "unit-b"
    ]);
  });

  it("builds selection context from the actual selected range instead of the first occurrence", () => {
    const textLayer = layer(
      '<span>十进制</span><span>计数法</span><span>。</span>' +
        '<span>计数单位</span><span>。</span>' +
        '<span id="target-a">十进制</span><span id="target-b">计数法</span><span>后面</span>'
    );
    const start = document.getElementById("target-a")!.firstChild!;
    const end = document.getElementById("target-b")!.firstChild!;
    const range = document.createRange();
    range.setStart(start, 0);
    range.setEnd(end, end.textContent!.length);

    const selector = selectorFromPdfRange(textLayer, range, 8);

    expect(selector).toEqual({ exact: "十进制计数法", prefix: "数法。计数单位。", suffix: "后面" });
    expect(ids(spansForPdfQuote(textLayer, selector!))).toEqual(["target-a", "target-b"]);
  });

  it("also accepts range boundaries on span elements", () => {
    const textLayer = layer(
      '<span>十进制</span><span>计数法</span><span>。</span>' +
        '<span>计数单位</span><span>。</span>' +
        '<span id="target-a">十进制</span><span id="target-b">计数法</span>'
    );
    const range = document.createRange();
    range.setStart(document.getElementById("target-a")!, 0);
    range.setEnd(document.getElementById("target-b")!, 1);

    const selector = selectorFromPdfRange(textLayer, range, 8);

    expect(selector?.exact).toBe("十进制计数法");
    expect(ids(spansForPdfQuote(textLayer, selector!))).toEqual(["target-a", "target-b"]);
  });

  it("collapses whitespace consistently across spans", () => {
    const textLayer = layer(
      '<span>Alpha </span><span id="hit-a"> beta</span><span id="hit-b"> gamma</span><span> delta</span>'
    );

    expect(ids(spansForPdfQuote(textLayer, { exact: "beta gamma", prefix: "Alpha ", suffix: " delta" }))).toEqual([
      "hit-a",
      "hit-b"
    ]);
  });
});
