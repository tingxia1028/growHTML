import { describe, expect, it } from "vitest";
import {
  canSplitConcurrently,
  clampSplitRatio,
  normalizeSourceSplit,
  sourceSplitKey,
  SOURCE_SPLIT_DEFAULT_RATIO,
  SOURCE_SPLIT_MAX_RATIO,
  SOURCE_SPLIT_MIN_RATIO
} from "./sourceSplit";

describe("sourceSplit — pure split helpers + the host-realm gate (delta 3)", () => {
  it("clampSplitRatio bounds to [0.2, 0.8]; NaN → default", () => {
    expect(clampSplitRatio(0.5)).toBe(0.5);
    expect(clampSplitRatio(0.01)).toBe(SOURCE_SPLIT_MIN_RATIO);
    expect(clampSplitRatio(0.99)).toBe(SOURCE_SPLIT_MAX_RATIO);
    expect(clampSplitRatio(Number.NaN)).toBe(SOURCE_SPLIT_DEFAULT_RATIO);
  });

  it("sourceSplitKey namespaces by layout, falling back to default", () => {
    expect(sourceSplitKey("study-vault")).toBe("sv-source-split:study-vault");
    expect(sourceSplitKey(undefined)).toBe("sv-source-split:default");
    expect(sourceSplitKey("")).toBe("sv-source-split:default");
  });

  it("normalizeSourceSplit drops a stale sidePaneId + clamps ratio", () => {
    const valid = ["pane:a", "pane:b"];
    expect(normalizeSourceSplit({ sidePaneId: "pane:b", ratio: 0.6 }, valid)).toEqual({
      sidePaneId: "pane:b",
      ratio: 0.6
    });
    // Unknown pane id → no split.
    expect(normalizeSourceSplit({ sidePaneId: "pane:gone", ratio: 0.6 }, valid)).toEqual({
      sidePaneId: null,
      ratio: 0.6
    });
    // Junk → default no-split.
    expect(normalizeSourceSplit(null, valid)).toEqual({ sidePaneId: null, ratio: SOURCE_SPLIT_DEFAULT_RATIO });
  });

  // The GATE: two HOST-REALM sources (pdf / image) must NOT split concurrently; any pairing
  // with at least one iframe/webview-realm source is allowed.
  it("HOST-REALM GATE: pdf + pdf is refused", () => {
    expect(canSplitConcurrently("pdf", "pdf")).toBe(false);
  });

  it("HOST-REALM GATE: pdf + image is refused (both host-realm)", () => {
    expect(canSplitConcurrently("pdf", "image")).toBe(false);
    expect(canSplitConcurrently("image", "pdf")).toBe(false);
  });

  it("HOST-REALM GATE: pdf + html is allowed (one iframe-realm side)", () => {
    expect(canSplitConcurrently("pdf", "html")).toBe(true);
    expect(canSplitConcurrently("html", "pdf")).toBe(true);
  });

  it("HOST-REALM GATE: image + webpage is allowed", () => {
    expect(canSplitConcurrently("image", "webpage")).toBe(true);
  });

  it("HOST-REALM GATE: two iframe/webview sources are always allowed", () => {
    expect(canSplitConcurrently("html", "html")).toBe(true);
    expect(canSplitConcurrently("webpage", "web_live")).toBe(true);
    expect(canSplitConcurrently("markdown", "html")).toBe(true);
  });
});
