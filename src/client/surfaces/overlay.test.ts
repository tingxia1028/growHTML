// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { isRealRegion, normalizeDragRect, placeRegionBox } from "./overlay";

describe("normalizeDragRect", () => {
  it("normalizes a top-left → bottom-right drag to [x,y,w,h] in 0..1", () => {
    // 200x100 element, drag from (40,20) to (140,70).
    expect(normalizeDragRect({ width: 200, height: 100 }, { x: 40, y: 20 }, { x: 140, y: 70 })).toEqual([
      0.2,
      0.2,
      0.5,
      0.5
    ]);
  });

  it("handles a reversed (bottom-right → top-left) drag the same", () => {
    expect(normalizeDragRect({ width: 200, height: 100 }, { x: 140, y: 70 }, { x: 40, y: 20 })).toEqual([
      0.2,
      0.2,
      0.5,
      0.5
    ]);
  });

  it("clamps the current point inside the element bounds", () => {
    // End point drags far past the bottom-right corner; result stays within [0,1].
    const rect = normalizeDragRect({ width: 100, height: 100 }, { x: 0, y: 0 }, { x: 500, y: 500 });
    expect(rect).toEqual([0, 0, 1, 1]);
  });
});

describe("isRealRegion", () => {
  it("accepts a drag past the minimum extent in both axes", () => {
    expect(isRealRegion({ width: 100, height: 100 }, { x: 0, y: 0 }, { x: 20, y: 20 })).toBe(true);
  });

  it("rejects a stray click (sub-threshold drag)", () => {
    expect(isRealRegion({ width: 100, height: 100 }, { x: 10, y: 10 }, { x: 13, y: 13 })).toBe(false);
  });

  it("rejects when the element has no layout (zero size)", () => {
    expect(isRealRegion({ width: 0, height: 0 }, { x: 0, y: 0 }, { x: 50, y: 50 })).toBe(false);
  });
});

describe("placeRegionBox", () => {
  it("positions the box at the normalized rect (percent) and wires the note card", () => {
    const box = document.createElement("div");
    placeRegionBox(box, [0.1, 0.2, 0.3, 0.4], "a note", "anchor-1");
    expect(box.style.left).toBe("10%");
    expect(box.style.top).toBe("20%");
    expect(box.style.width).toBe("30%");
    expect(box.style.height).toBe("40%");
    expect(box.getAttribute("data-anchor-id")).toBe("anchor-1");
    // applyHighlight stamps the shared note-card hooks.
    expect(box.classList.contains("sv-annotated")).toBe(true);
    expect(box.getAttribute("data-sv-note")).toBe("a note");
    expect(box.getAttribute("data-sv-key")).toBe("anchor-1");
  });

  it("forwards rich annotation payloads to the shared note-card hooks", () => {
    const box = document.createElement("div");
    placeRegionBox(box, [0, 0, 1, 1], "fallback", "anchor-2", {
      noteCount: 3,
      noteHtml: '<div class="sv-artifact-card">Region card</div>'
    });
    expect(box.getAttribute("data-sv-note-count")).toBe("3");
  });
});
