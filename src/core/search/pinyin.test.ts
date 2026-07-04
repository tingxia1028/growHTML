// SEARCH-2 pinyin matching: the romanization forms (full 全拼 + 首字母), the roman-query
// gate, CJK detection, and matchPinyin's additive RANK_FUZZY result. pinyin-pro is
// already a project dependency (SPEECH-3), so this adds no new bundle cost.
import { describe, expect, it } from "vitest";
import { RANK_FUZZY } from "./rank";
import { hasCjk, isRomanQuery, matchPinyin, pinyinForms } from "./pinyin";

describe("pinyinForms — full + initials over CJK titles", () => {
  it("produces joined full pinyin and first-letter initials", () => {
    const forms = pinyinForms("浮力");
    expect(forms?.full).toBe("fuli");
    expect(forms?.initials).toBe("fl");
  });

  it("drops non-CJK chars from both forms", () => {
    const forms = pinyinForms("浮力 lab");
    expect(forms?.full).toBe("fuli");
    expect(forms?.initials).toBe("fl");
  });

  it("returns null for non-CJK text", () => {
    expect(pinyinForms("buoyancy lab")).toBeNull();
  });
});

describe("hasCjk / isRomanQuery gates", () => {
  it("hasCjk detects ideographs", () => {
    expect(hasCjk("浮力")).toBe(true);
    expect(hasCjk("buoyancy")).toBe(false);
  });

  it("isRomanQuery accepts ascii-letter-only queries", () => {
    expect(isRomanQuery("fuli")).toBe(true);
    expect(isRomanQuery("FL")).toBe(true);
    expect(isRomanQuery("浮力")).toBe(false);
    expect(isRomanQuery("fu li")).toBe(false); // has a space
    expect(isRomanQuery("fu1")).toBe(false); // has a digit
  });
});

describe("matchPinyin — additive RANK_FUZZY on a roman → CJK hit", () => {
  it("matches full pinyin and initials at RANK_FUZZY", () => {
    expect(matchPinyin("fuli", "浮力")?.rank).toBe(RANK_FUZZY);
    expect(matchPinyin("fl", "浮力")?.rank).toBe(RANK_FUZZY);
    expect(matchPinyin("fulidingl", "浮力定律")?.rank).toBe(RANK_FUZZY);
  });

  it("null when the query isn't roman, the text has no CJK, or nothing matches", () => {
    expect(matchPinyin("浮力", "浮力")).toBeNull(); // CJK query
    expect(matchPinyin("fuli", "buoyancy")).toBeNull(); // no CJK text
    expect(matchPinyin("xyz", "浮力")).toBeNull(); // wrong romanization
  });
});
