import { describe, expect, it } from "vitest";
import { selectionRectToPageRect } from "./pdfSelectionRect";

describe("selectionRectToPageRect (转为区域 geometry)", () => {
  it("maps a centered half-size selection to ~[.25,.25,.5,.5] of the page", () => {
    // 400x300 page at viewport origin (100,50); selection is the centered half box.
    const page = { left: 100, top: 50, width: 400, height: 300 };
    const sel = { left: 100 + 400 * 0.25, top: 50 + 300 * 0.25, width: 400 * 0.5, height: 300 * 0.5 };
    expect(selectionRectToPageRect(page, sel)).toEqual([0.25, 0.25, 0.5, 0.5]);
  });

  it("maps a full-page selection to [0,0,1,1]", () => {
    const page = { left: 0, top: 0, width: 200, height: 100 };
    const sel = { left: 0, top: 0, width: 200, height: 100 };
    expect(selectionRectToPageRect(page, sel)).toEqual([0, 0, 1, 1]);
  });

  it("maps an in-page partial selection to its page-relative fractions", () => {
    // A real text selection sits inside the page's text layer; a 4-line block near the
    // top-left → a small rect offset from the page origin.
    const page = { left: 100, top: 100, width: 200, height: 200 };
    const sel = { left: 120, top: 140, width: 100, height: 40 };
    // start = (20,40), current = (120,80) → [20/200, 40/200, 100/200, 40/200].
    expect(selectionRectToPageRect(page, sel)).toEqual([0.1, 0.2, 0.5, 0.2]);
  });

  it("clamps a selection that runs past the page's far edge (current point clamped)", () => {
    // A selection that ends beyond the page's right/bottom edge clamps to the edge.
    const page = { left: 0, top: 0, width: 200, height: 200 };
    const sel = { left: 100, top: 100, width: 400, height: 400 };
    // start = (100,100), current clamped to (200,200) → [0.5, 0.5, 0.5, 0.5].
    expect(selectionRectToPageRect(page, sel)).toEqual([0.5, 0.5, 0.5, 0.5]);
  });
});
