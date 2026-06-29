import { describe, it, expect } from "vitest";
import { parseRange } from "./httpRange";

// parseRange (adaptive note forms · Phase 2, HTTP Range for long local video). Covers
// the edge cases the asset route relies on: closed/open-ended/suffix ranges, clamping,
// out-of-range (→ 416), and malformed/multi/inverted (→ ignore, full 200).

const TOTAL = 1000;

describe("parseRange — no/ignored header → full 200", () => {
  it("absent or empty header", () => {
    expect(parseRange(undefined, TOTAL)).toEqual({ kind: "none" });
    expect(parseRange("", TOTAL)).toEqual({ kind: "none" });
  });
  it("non-bytes unit, multi-range, missing dash, inverted, malformed numbers", () => {
    expect(parseRange("items=0-10", TOTAL)).toEqual({ kind: "none" });
    expect(parseRange("bytes=0-10,20-30", TOTAL)).toEqual({ kind: "none" });
    expect(parseRange("bytes=100", TOTAL)).toEqual({ kind: "none" });
    expect(parseRange("bytes=500-100", TOTAL)).toEqual({ kind: "none" });
    expect(parseRange("bytes=abc-def", TOTAL)).toEqual({ kind: "none" });
    expect(parseRange("bytes=-", TOTAL)).toEqual({ kind: "none" });
  });
});

describe("parseRange — satisfiable", () => {
  it("explicit closed range bytes=START-END (inclusive)", () => {
    expect(parseRange("bytes=0-499", TOTAL)).toEqual({ kind: "satisfiable", start: 0, end: 499 });
    expect(parseRange("bytes=200-300", TOTAL)).toEqual({ kind: "satisfiable", start: 200, end: 300 });
  });
  it("open-ended bytes=START- → to EOF", () => {
    expect(parseRange("bytes=500-", TOTAL)).toEqual({ kind: "satisfiable", start: 500, end: 999 });
  });
  it("suffix bytes=-N → last N bytes", () => {
    expect(parseRange("bytes=-200", TOTAL)).toEqual({ kind: "satisfiable", start: 800, end: 999 });
  });
  it("suffix larger than the file clamps to the whole file", () => {
    expect(parseRange("bytes=-5000", TOTAL)).toEqual({ kind: "satisfiable", start: 0, end: 999 });
  });
  it("an over-long END clamps to the last byte", () => {
    expect(parseRange("bytes=900-5000", TOTAL)).toEqual({ kind: "satisfiable", start: 900, end: 999 });
  });
  it("tolerates surrounding whitespace", () => {
    expect(parseRange("  bytes=0-9  ", TOTAL)).toEqual({ kind: "satisfiable", start: 0, end: 9 });
  });
});

describe("parseRange — unsatisfiable → 416", () => {
  it("start beyond EOF", () => {
    expect(parseRange("bytes=1000-1100", TOTAL)).toEqual({ kind: "unsatisfiable" });
    expect(parseRange("bytes=2000-", TOTAL)).toEqual({ kind: "unsatisfiable" });
  });
  it("suffix of 0 bytes", () => {
    expect(parseRange("bytes=-0", TOTAL)).toEqual({ kind: "unsatisfiable" });
  });
  it("any range against an empty file", () => {
    expect(parseRange("bytes=0-0", 0)).toEqual({ kind: "unsatisfiable" });
  });
});
