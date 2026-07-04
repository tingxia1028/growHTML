import { describe, expect, it } from "vitest";
import {
  EMPTY_BUNDLE,
  getBundle,
  hasBundle,
  pruneBundles,
  putBundle,
  type SourceBundle
} from "./sourceBundles";
import type { AnyAnchor, NoteRecord } from "../data/entityClient";

function bundle(over: Partial<SourceBundle>): SourceBundle {
  return { ...EMPTY_BUNDLE, ...over };
}

const anchorA: AnyAnchor = {
  id: "a1",
  sourceId: "s1",
  anchorKind: "html_selection",
  studyId: "sid-1",
  selector: "p",
  quote: "hello"
};
const noteA: NoteRecord = {
  id: "n1",
  sourceId: "s1",
  anchorIds: ["a1"],
  conceptIds: [],
  layerIds: [],
  contentType: "markdown",
  content: "hi",
  visibility: "private"
} as NoteRecord;

describe("sourceBundles — pure per-source cache", () => {
  it("putBundle round-trips a bundle (cache round-trip)", () => {
    const b = bundle({ renderedHtml: "<p>x</p>", anchors: [anchorA], notes: [noteA] });
    const cache = putBundle(new Map(), "s1", b);
    expect(getBundle(cache, "s1")).toBe(b);
    expect(getBundle(cache, "s1")?.anchors).toEqual([anchorA]);
    expect(getBundle(cache, "s1")?.notes).toEqual([noteA]);
  });

  it("getBundle returns null for an unloaded source", () => {
    expect(getBundle(new Map(), "missing")).toBeNull();
  });

  it("putBundle returns a NEW map (referential change drives React re-render)", () => {
    const before = new Map<string, SourceBundle>();
    const after = putBundle(before, "s1", EMPTY_BUNDLE);
    expect(after).not.toBe(before);
    expect(before.has("s1")).toBe(false);
    expect(after.has("s1")).toBe(true);
  });

  it("hasBundle gates the no-refetch-on-refocus path", () => {
    const cache = putBundle(new Map(), "s1", EMPTY_BUNDLE);
    expect(hasBundle(cache, "s1")).toBe(true);
    expect(hasBundle(cache, "s2")).toBe(false);
  });

  it("NO-REFETCH: re-focusing a cached source keeps the SAME bundle (no overwrite)", () => {
    const b1 = bundle({ renderedHtml: "first" });
    const cache = putBundle(new Map(), "s1", b1);
    // Re-focus onto s1: hasBundle is true → the load effect skips the fetch and the
    // cached bundle is reused verbatim.
    expect(hasBundle(cache, "s1")).toBe(true);
    expect(getBundle(cache, "s1")).toBe(b1);
  });

  it("putBundle replaces a stale bundle for the same source", () => {
    const b1 = bundle({ renderedHtml: "old" });
    const b2 = bundle({ renderedHtml: "new" });
    let cache = putBundle(new Map(), "s1", b1);
    cache = putBundle(cache, "s1", b2);
    expect(getBundle(cache, "s1")).toBe(b2);
    expect(cache.size).toBe(1);
  });

  it("pruneBundles drops entries for deleted sources", () => {
    let cache = putBundle(new Map(), "s1", EMPTY_BUNDLE);
    cache = putBundle(cache, "s2", EMPTY_BUNDLE);
    cache = putBundle(cache, "s3", EMPTY_BUNDLE);
    const pruned = pruneBundles(cache, new Set(["s1", "s3"]));
    expect([...pruned.keys()].sort()).toEqual(["s1", "s3"]);
  });
});
