import { describe, expect, it } from "vitest";
import { denormalizeRect, isMeaningfulRegion, normalizeRect } from "./regionSelect";

describe("normalizeRect", () => {
  it("normalizes a drag to 0..1 coordinates relative to the box", () => {
    expect(normalizeRect(50, 30, 150, 90, 200, 120)).toEqual([0.25, 0.25, 0.5, 0.5]);
  });

  it("is direction-agnostic (drag up-left == drag down-right)", () => {
    expect(normalizeRect(150, 90, 50, 30, 200, 120)).toEqual(normalizeRect(50, 30, 150, 90, 200, 120));
  });

  it("clamps points that fall outside the box", () => {
    expect(normalizeRect(-40, -40, 400, 400, 200, 100)).toEqual([0, 0, 1, 1]);
  });

  it("returns a zero rect for a degenerate box", () => {
    expect(normalizeRect(0, 0, 10, 10, 0, 0)).toEqual([0, 0, 0, 0]);
  });
});

describe("denormalizeRect", () => {
  it("round-trips back to pixels for the rendered size", () => {
    expect(denormalizeRect([0.25, 0.25, 0.5, 0.5], 200, 120)).toEqual({ left: 50, top: 30, width: 100, height: 60 });
  });
});

describe("isMeaningfulRegion", () => {
  it("rejects an accidental click-sized drag but accepts a real region", () => {
    expect(isMeaningfulRegion([0.5, 0.5, 0.0001, 0.0001])).toBe(false);
    expect(isMeaningfulRegion([0.1, 0.1, 0.3, 0.2])).toBe(true);
  });
});
