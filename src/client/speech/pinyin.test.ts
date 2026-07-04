// SPEECH-3 注音 engine tests — the pure pinyin.ts helpers: context-aware 多音字 (the
// whole point of riding pinyin-pro's word-level segmentation instead of naive per-char
// lookups), tone-marked output, verbatim per-char mapping over mixed zh/latin/punct
// text, and the containsCjk affordance gate.
import { describe, expect, it } from "vitest";
import { annotate, containsCjk } from "./pinyin";

describe("annotate — context-aware 多音字", () => {
  it("resolves 长 differently in 长大 (zhǎng) vs 长度 (cháng)", () => {
    expect(annotate("我长大了").map((c) => c.pinyin)).toEqual(["wǒ", "zhǎng", "dà", "le"]);
    expect(annotate("这条路的长度").map((c) => c.pinyin)).toEqual([
      "zhè",
      "tiáo",
      "lù",
      "de",
      "cháng",
      "dù"
    ]);
  });

  it("resolves 行 differently in 银行 (háng) vs 行走 (xíng)", () => {
    expect(annotate("去银行").map((c) => c.pinyin)).toEqual(["qù", "yín", "háng"]);
    expect(annotate("行走").map((c) => c.pinyin)).toEqual(["xíng", "zǒu"]);
  });

  it("resolves both readings of a 多音字 inside ONE sentence", () => {
    const result = annotate("他长大了，测量长度。");
    const readings = result.filter((c) => c.char === "长").map((c) => c.pinyin);
    expect(readings).toEqual(["zhǎng", "cháng"]);
  });
});

describe("annotate — tone marks and shape", () => {
  it("emits tone-MARKED pinyin (symbols, not numbers)", () => {
    expect(annotate("你好").map((c) => c.pinyin)).toEqual(["nǐ", "hǎo"]);
    expect(annotate("中国").map((c) => c.pinyin)).toEqual(["zhōng", "guó"]);
  });

  it("maps mixed zh/latin/punct per character, null for non-CJK, preserving the text", () => {
    const input = "A班的小明 likes 数学!";
    const result = annotate(input);
    // Verbatim: concatenating chars reproduces the input exactly.
    expect(result.map((c) => c.char).join("")).toBe(input);
    // CJK chars carry pinyin; latin/space/punct carry null.
    expect(result.map((c) => c.pinyin)).toEqual([
      null, // A
      "bān",
      "de",
      "xiǎo",
      "míng",
      null, // space
      ...Array(5).fill(null), // likes
      null, // space
      "shù",
      "xué",
      null // !
    ]);
  });

  it("CJK punctuation renders as plain (null), not annotated", () => {
    const result = annotate("好，好。");
    expect(result.map((c) => c.pinyin)).toEqual(["hǎo", null, "hǎo", null]);
  });

  it("empty input → empty output", () => {
    expect(annotate("")).toEqual([]);
  });
});

describe("containsCjk — the 注音 affordance gate", () => {
  it("true for Chinese text (and mixed text with any CJK char)", () => {
    expect(containsCjk("中文")).toBe(true);
    expect(containsCjk("abc 中 def")).toBe(true);
    expect(containsCjk("二〇二六年")).toBe(true);
  });

  it("false for latin/digits/punctuation-only text and empty strings", () => {
    expect(containsCjk("hello world 123!?")).toBe(false);
    expect(containsCjk("")).toBe(false);
    // CJK punctuation alone is not annotatable — no 注音 to offer.
    expect(containsCjk("，。！")).toBe(false);
  });
});
