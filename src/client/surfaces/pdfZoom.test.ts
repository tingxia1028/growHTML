import { describe, expect, it } from "vitest";
import { clampScale, formatZoomPct, MAX_SCALE, MIN_SCALE, nextZoom, ZOOM_STEP } from "./pdfZoom";

describe("clampScale", () => {
  it("passes through an in-range scale", () => {
    expect(clampScale(1.5)).toBe(1.5);
  });

  it("clamps below MIN_SCALE up to MIN_SCALE", () => {
    expect(clampScale(0.01)).toBe(MIN_SCALE);
  });

  it("clamps above MAX_SCALE down to MAX_SCALE", () => {
    expect(clampScale(99)).toBe(MAX_SCALE);
  });

  it("falls back to MIN_SCALE on non-finite input (NaN/Infinity from an un-laid-out viewer)", () => {
    expect(clampScale(NaN)).toBe(MIN_SCALE);
    expect(clampScale(Infinity)).toBe(MIN_SCALE);
  });
});

describe("nextZoom", () => {
  it("steps in by ZOOM_STEP", () => {
    expect(nextZoom(1, 1)).toBeCloseTo(ZOOM_STEP, 10);
  });

  it("steps out by 1/ZOOM_STEP", () => {
    expect(nextZoom(1, -1)).toBeCloseTo(1 / ZOOM_STEP, 10);
  });

  it("never exceeds MAX_SCALE when zooming in at the top", () => {
    expect(nextZoom(MAX_SCALE, 1)).toBe(MAX_SCALE);
  });

  it("never drops below MIN_SCALE when zooming out at the bottom", () => {
    expect(nextZoom(MIN_SCALE, -1)).toBe(MIN_SCALE);
  });

  it("treats a non-finite current scale as MIN_SCALE", () => {
    expect(nextZoom(NaN, -1)).toBe(MIN_SCALE);
  });
});

describe("formatZoomPct", () => {
  it("renders a scale as a whole-percent label", () => {
    expect(formatZoomPct(1)).toBe("100%");
    expect(formatZoomPct(1.2)).toBe("120%");
    expect(formatZoomPct(0.5)).toBe("50%");
  });

  it("rounds to the nearest whole percent", () => {
    expect(formatZoomPct(1.234)).toBe("123%");
  });
});
