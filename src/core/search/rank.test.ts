// SEARCH-1 pure ranking core: tier order pinned (exact > prefix > word-boundary >
// substring), case folding, CJK substring correctness, multi-field best-match with
// the matched-field report (bare anchor hits "show as their quote"), snippet
// extraction, and the shared rank-sort (tier → recency → stable order, capped).
import { describe, expect, it } from "vitest";
import {
  matchFields,
  matchText,
  rankMatches,
  RANK_EXACT,
  RANK_FUZZY,
  RANK_PREFIX,
  RANK_SUBSTRING,
  RANK_WORD,
  snippetAround
} from "./rank";

describe("matchText — tiers", () => {
  it("pins the four tiers: exact > prefix > word-boundary > substring", () => {
    expect(matchText("buoyancy", "buoyancy")?.rank).toBe(RANK_EXACT);
    expect(matchText("buoy", "buoyancy lab")?.rank).toBe(RANK_PREFIX);
    expect(matchText("lab", "buoyancy lab")?.rank).toBe(RANK_WORD);
    expect(matchText("ancy", "buoyancy lab")?.rank).toBe(RANK_SUBSTRING);
    expect(RANK_EXACT < RANK_PREFIX && RANK_PREFIX < RANK_WORD && RANK_WORD < RANK_SUBSTRING).toBe(true);
  });

  it("case-folds both sides (English case-insensitive)", () => {
    expect(matchText("BUOY", "Buoyancy")?.rank).toBe(RANK_PREFIX);
    expect(matchText("Lab", "buoyancy LAB")?.rank).toBe(RANK_WORD);
  });

  it("no occurrence → null; empty/blank query → null", () => {
    expect(matchText("pressure", "buoyancy")).toBeNull();
    expect(matchText("", "buoyancy")).toBeNull();
    expect(matchText("   ", "buoyancy")).toBeNull();
  });

  it("CJK: plain substring is correct (design §2) — start = prefix, middle = substring", () => {
    expect(matchText("浮力", "浮力定律")?.rank).toBe(RANK_PREFIX);
    expect(matchText("定律", "浮力定律")?.rank).toBe(RANK_SUBSTRING);
    // After whitespace/punctuation a CJK hit is a word-boundary hit.
    expect(matchText("定律", "浮力 定律")?.rank).toBe(RANK_WORD);
    expect(matchText("压强", "浮力定律")).toBeNull();
  });

  it("reports the first occurrence index (for snippets)", () => {
    expect(matchText("力", "浮力定律的力学")?.index).toBe(1);
  });
});

describe("matchText — the fuzzy tier (SEARCH-2, additive, below substring)", () => {
  it("a literal hit ALWAYS beats fuzzy: the four SEARCH-1 tiers are untouched", () => {
    // Every literal tier still ranks above RANK_FUZZY, so SEARCH-1 order is byte-stable.
    expect(matchText("buoyancy", "buoyancy")?.rank).toBe(RANK_EXACT);
    expect(matchText("ancy", "buoyancy lab")?.rank).toBe(RANK_SUBSTRING);
    expect(RANK_SUBSTRING < RANK_FUZZY).toBe(true);
  });

  it("tolerates a transposition/typo via bounded edit distance", () => {
    // "buoancy" (dropped y) and "buoyanci" (final swap) have no substring in the text.
    expect(matchText("buoancy", "buoyancy")?.rank).toBe(RANK_FUZZY);
    expect(matchText("buoyanci", "the buoyancy lab")?.rank).toBe(RANK_FUZZY);
  });

  it("matches a subsequence (skipped letters) as fuzzy", () => {
    expect(matchText("bync", "buoyancy")?.rank).toBe(RANK_FUZZY);
    expect(matchText("gsrch", "global search")?.rank).toBe(RANK_FUZZY);
  });

  it("does NOT fuzz too-short queries, non-matches, or CJK (design §2)", () => {
    expect(matchText("bo", "buoyancy")).toBeNull(); // < 3 chars
    expect(matchText("zzzz", "buoyancy")).toBeNull(); // unrelated
    expect(matchText("浮定", "浮力定律")).toBeNull(); // CJK stays substring-only
  });

  it("reports a word-anchored index for the snippet", () => {
    const match = matchText("buoancy", "the buoyancy lab");
    expect(match?.rank).toBe(RANK_FUZZY);
    expect(match?.index).toBe(4); // start of "buoyancy"
  });
});

describe("matchFields — best field wins, field reported", () => {
  it("returns the best tier across fields and which field produced it", () => {
    const match = matchFields("阿基米德", ["一条关于浮力的笔记", "阿基米德原理指出…"]);
    expect(match?.fieldIndex).toBe(1);
    expect(match?.rank).toBe(RANK_PREFIX);
  });

  it("earlier field wins a tier tie", () => {
    const match = matchFields("浮力", ["浮力 A", "浮力 B"]);
    expect(match?.fieldIndex).toBe(0);
  });

  it("null when no field matches", () => {
    expect(matchFields("压强", ["浮力", "定律"])).toBeNull();
  });
});

describe("snippetAround", () => {
  it("windows around the match with ellipses and collapsed whitespace", () => {
    const text = `${"甲".repeat(60)}浮力\n\n定律${"乙".repeat(60)}`;
    const index = text.indexOf("浮力");
    const snippet = snippetAround(text, index, "浮力".length, 10);
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
    expect(snippet).toContain("浮力 定律"); // newlines collapsed to one space
    expect(snippet.length).toBeLessThan(40);
  });

  it("no ellipses when the whole text fits", () => {
    expect(snippetAround("浮力定律", 0, 2, 40)).toBe("浮力定律");
  });
});

describe("rankMatches — tier, then recency, then stable order; capped", () => {
  const entry = (id: string, rank: number, updatedAt: string) => ({ item: id, rank, updatedAt });

  it("sorts by tier first, recency (updatedAt desc) inside a tier", () => {
    const out = rankMatches(
      [
        entry("old-substring", RANK_SUBSTRING, "2026-01-01T00:00:00Z"),
        entry("old-prefix", RANK_PREFIX, "2026-01-01T00:00:00Z"),
        entry("new-prefix", RANK_PREFIX, "2026-07-01T00:00:00Z")
      ],
      10
    );
    expect(out).toEqual(["new-prefix", "old-prefix", "old-substring"]);
  });

  it("keeps input order on full ties (stable) and applies the cap", () => {
    const ties = ["a", "b", "c", "d"].map((id) => entry(id, RANK_PREFIX, "2026-07-01T00:00:00Z"));
    expect(rankMatches(ties, 3)).toEqual(["a", "b", "c"]);
  });
});
