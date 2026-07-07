import { describe, expect, it } from "vitest";
import {
  canSplitConcurrently,
  clampSplitRatio,
  isSourceSplitActive,
  movePaneToSourceGroup,
  normalizeSourceSplit,
  paneIdsForSourceGroup,
  reconcileSourceSplitPaneIds,
  sourceSplitKey,
  SOURCE_SPLIT_DEFAULT_RATIO,
  SOURCE_SPLIT_MAX_RATIO,
  SOURCE_SPLIT_MIN_RATIO
} from "./sourceSplit";

describe("sourceSplit - pure split helpers", () => {
  it("clampSplitRatio bounds to [0.2, 0.8]; NaN falls back to default", () => {
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

  it("normalizeSourceSplit migrates old sidePaneId, drops stale ids, and clamps ratio", () => {
    const valid = ["pane:a", "pane:b"];
    expect(normalizeSourceSplit({ sidePaneId: "pane:b", ratio: 0.6 }, valid)).toEqual({
      rightPaneIds: ["pane:b"],
      ratio: 0.6
    });
    expect(normalizeSourceSplit({ rightPaneIds: ["pane:b", "pane:b", "pane:gone"], ratio: 0.6 }, valid)).toEqual({
      rightPaneIds: ["pane:b"],
      ratio: 0.6
    });
    expect(normalizeSourceSplit(null, valid)).toEqual({ rightPaneIds: [], ratio: SOURCE_SPLIT_DEFAULT_RATIO });
  });

  it("derives left/right groups and prevents an empty left group", () => {
    const valid = ["pane:a", "pane:b", "pane:c"];
    const split = normalizeSourceSplit({ rightPaneIds: ["pane:b", "pane:c"], ratio: 0.5 }, valid);
    expect(paneIdsForSourceGroup(valid, split, "left")).toEqual(["pane:a"]);
    expect(paneIdsForSourceGroup(valid, split, "right")).toEqual(["pane:b", "pane:c"]);
    expect(isSourceSplitActive(split, valid)).toBe(true);

    expect(normalizeSourceSplit({ rightPaneIds: valid, ratio: 0.5 }, valid)).toEqual({
      rightPaneIds: ["pane:b", "pane:c"],
      ratio: 0.5
    });
    expect(normalizeSourceSplit({ rightPaneIds: ["pane:b"], ratio: 0.5 }, ["pane:b"])).toEqual({
      rightPaneIds: [],
      ratio: 0.5
    });
  });

  it("moves panes between source groups", () => {
    const valid = ["pane:a", "pane:b", "pane:c"];
    let split = normalizeSourceSplit({ rightPaneIds: ["pane:b"], ratio: 0.5 }, valid);
    split = movePaneToSourceGroup(split, "pane:c", "right", valid);
    expect(split.rightPaneIds).toEqual(["pane:b", "pane:c"]);
    split = movePaneToSourceGroup(split, "pane:b", "left", valid);
    expect(split.rightPaneIds).toEqual(["pane:c"]);
    split = movePaneToSourceGroup(split, "pane:c", "left", valid);
    expect(split.rightPaneIds).toEqual([]);
    expect(isSourceSplitActive(split, valid)).toBe(false);
  });

  it("reconciles pane replacements without losing the editor group", () => {
    const split = normalizeSourceSplit({ rightPaneIds: ["pane:b"], ratio: 0.5 }, ["pane:a", "pane:b"]);

    expect(
      reconcileSourceSplitPaneIds(split, ["pane:a", "pane:b"], ["pane:c", "pane:b"], "right")
    ).toEqual({
      rightPaneIds: ["pane:b"],
      ratio: 0.5
    });
    expect(
      reconcileSourceSplitPaneIds(split, ["pane:a", "pane:b"], ["pane:a", "pane:c"], "left")
    ).toEqual({
      rightPaneIds: ["pane:c"],
      ratio: 0.5
    });
  });

  it("puts newly added panes into the active editor group", () => {
    const split = normalizeSourceSplit({ rightPaneIds: ["pane:b"], ratio: 0.5 }, ["pane:a", "pane:b"]);
    expect(
      reconcileSourceSplitPaneIds(split, ["pane:a", "pane:b"], ["pane:a", "pane:b", "pane:c"], "right")
    ).toEqual({
      rightPaneIds: ["pane:b", "pane:c"],
      ratio: 0.5
    });
  });

  it("allows any concrete source type pairing, including PDF/PDF and PDF/image", () => {
    expect(canSplitConcurrently("pdf", "pdf")).toBe(true);
    expect(canSplitConcurrently("pdf", "image")).toBe(true);
    expect(canSplitConcurrently("image", "pdf")).toBe(true);
    expect(canSplitConcurrently("pdf", "html")).toBe(true);
    expect(canSplitConcurrently("webpage", "web_live")).toBe(true);
    expect(canSplitConcurrently("markdown", "html")).toBe(true);
  });

  it("refuses an incomplete pairing", () => {
    expect(canSplitConcurrently(undefined, "pdf")).toBe(false);
    expect(canSplitConcurrently("pdf", undefined)).toBe(false);
  });
});
