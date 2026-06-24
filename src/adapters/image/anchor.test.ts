import { describe, expect, it } from "vitest";
import { fixtureAnchor } from "../../core/fixtures/golden";
import { createImageRegionAnchor } from "./anchor";

const sourceId = fixtureAnchor.sourceId;

describe("image region anchor", () => {
  it("creates a schema-valid geometric anchor with no text required", () => {
    const anchor = createImageRegionAnchor({
      sourceId,
      rect: [0.1, 0.2, 0.3, 0.4],
      createdAt: "2026-06-24T00:00:00.000Z"
    });

    expect(anchor.anchorKind).toBe("image_region");
    expect(anchor.rect).toEqual([0.1, 0.2, 0.3, 0.4]);
    expect(anchor.quote).toBe(""); // geometric anchors locate by rect, not text
    expect(anchor.id).toMatch(/^anchor_/);
  });

  it("preserves an optional caption / OCR snippet as the quote", () => {
    const anchor = createImageRegionAnchor({
      sourceId,
      rect: [0, 0, 1, 1],
      quote: "Figure 2: the render loop"
    });
    expect(anchor.quote).toBe("Figure 2: the render loop");
  });
});
