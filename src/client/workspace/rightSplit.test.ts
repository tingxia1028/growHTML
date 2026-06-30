import { afterEach, describe, expect, it } from "vitest";
import {
  clampRatio,
  DEFAULT_RIGHT_SPLIT,
  loadRightSplit,
  normalizeSplit,
  remainingTabs,
  rightSplitKey,
  RIGHT_SPLIT_MAX_RATIO,
  RIGHT_SPLIT_MIN_RATIO,
  saveRightSplit,
  type RightSplitState
} from "./rightSplit";

const KINDS = ["anchor.excerpt", "note.list", "layer.switcher", "study"];
const TABS = KINDS.map((kind) => ({ kind }));

describe("rightSplit — clampRatio", () => {
  it("clamps to the 0.2–0.8 band", () => {
    expect(clampRatio(0.05)).toBe(RIGHT_SPLIT_MIN_RATIO);
    expect(clampRatio(0.95)).toBe(RIGHT_SPLIT_MAX_RATIO);
    expect(clampRatio(0.5)).toBe(0.5);
  });
  it("falls back to default for non-finite input", () => {
    expect(clampRatio(Number.NaN)).toBe(DEFAULT_RIGHT_SPLIT.ratio);
    expect(clampRatio(Number.POSITIVE_INFINITY)).toBe(DEFAULT_RIGHT_SPLIT.ratio);
  });
});

describe("rightSplit — remainingTabs", () => {
  it("returns every tab when nothing is popped", () => {
    expect(remainingTabs(TABS, null).map((t) => t.kind)).toEqual(KINDS);
  });
  it("excludes the popped kind", () => {
    expect(remainingTabs(TABS, "note.list").map((t) => t.kind)).toEqual([
      "anchor.excerpt",
      "layer.switcher",
      "study"
    ]);
  });
  it("is a copy, not the original array", () => {
    expect(remainingTabs(TABS, null)).not.toBe(TABS);
  });
});

describe("rightSplit — normalizeSplit", () => {
  it("returns default for non-objects", () => {
    expect(normalizeSplit(null, KINDS)).toEqual(DEFAULT_RIGHT_SPLIT);
    expect(normalizeSplit("x", KINDS)).toEqual(DEFAULT_RIGHT_SPLIT);
  });
  it("accepts a valid popped kind + side + ratio", () => {
    const s = normalizeSplit({ poppedKind: "study", side: "bottom", ratio: 0.3 }, KINDS);
    expect(s).toEqual({ poppedKind: "study", side: "bottom", ratio: 0.3 });
  });
  it("drops an unknown popped kind to null", () => {
    expect(normalizeSplit({ poppedKind: "ghost", side: "top", ratio: 0.5 }, KINDS).poppedKind).toBeNull();
  });
  it("defaults side to top and clamps ratio", () => {
    const s = normalizeSplit({ poppedKind: "study", side: "weird", ratio: 9 }, KINDS);
    expect(s.side).toBe("top");
    expect(s.ratio).toBe(RIGHT_SPLIT_MAX_RATIO);
  });
});

describe("rightSplit — key + persistence", () => {
  afterEach(() => {
    globalThis.localStorage?.clear?.();
  });

  it("keys by layout id, falling back to default", () => {
    expect(rightSplitKey("study-vault")).toBe("sv-right-split:study-vault");
    expect(rightSplitKey(undefined)).toBe("sv-right-split:default");
    expect(rightSplitKey("")).toBe("sv-right-split:default");
  });

  it("round-trips through save/load when storage exists", () => {
    const hasStorage = typeof globalThis.localStorage !== "undefined";
    const state: RightSplitState = { poppedKind: "layer.switcher", side: "bottom", ratio: 0.7 };
    saveRightSplit("study-vault", state);
    const loaded = loadRightSplit("study-vault", KINDS);
    if (hasStorage) {
      expect(loaded).toEqual(state);
    } else {
      // No jsdom/localStorage in this runner → graceful default.
      expect(loaded).toEqual(DEFAULT_RIGHT_SPLIT);
    }
  });

  it("returns the default when nothing is persisted", () => {
    expect(loadRightSplit("never-saved", KINDS)).toEqual(DEFAULT_RIGHT_SPLIT);
  });
});
