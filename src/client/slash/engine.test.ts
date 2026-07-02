// Slash engine unit tests (SC-0; docs/design/slash-composer.md §6) — the PURE
// parse/resolve/rank contract. Entries are synthetic fixtures (the engine never
// touches a registry); the real registry-derived table is covered in adapters.test.
import { describe, expect, it } from "vitest";
import { parseSlashInput, resolveSlashEntries, type SlashEntry } from "./engine";

const entry = (
  id: string,
  title: string,
  aliases: string[] = [],
  extra: Partial<SlashEntry> = {}
): SlashEntry => ({ kind: "noteType", id, title, aliases, ...extra });

// A miniature of the real table (中文 titles + 中文/English aliases).
const ENTRIES: SlashEntry[] = [
  entry("markdown", "文本", ["笔记", "md", "text"]),
  entry("quiz", "小测", ["选择题", "判断题", "测验", "判断"]),
  entry("flashcard", "闪卡", ["卡片", "记忆卡", "card"]),
  entry("markmap", "脑图", ["思维导图", "导图", "mindmap"]),
  entry("textbook.exercise", "练习", ["练习题", "习题", "practice", "exercise"], {
    kitId: "textbook-learning"
  })
];

const ids = (list: SlashEntry[]) => list.map((e) => e.id);

describe("parseSlashInput", () => {
  it("returns null for a non-slash draft (including a leading space)", () => {
    expect(parseSlashInput("quiz 三道题")).toBeNull();
    expect(parseSlashInput("")).toBeNull();
    expect(parseSlashInput(" /quiz")).toBeNull();
    expect(parseSlashInput("hello /quiz")).toBeNull();
  });

  it('bare "/" opens the unfiltered palette: { query: "", instruction: "" }', () => {
    expect(parseSlashInput("/")).toEqual({ query: "", instruction: "" });
  });

  it("bare /type → manual mode (empty instruction)", () => {
    expect(parseSlashInput("/quiz")).toEqual({ query: "quiz", instruction: "" });
    // Trailing whitespace only = still bare.
    expect(parseSlashInput("/quiz  ")).toEqual({ query: "quiz", instruction: "" });
  });

  it("/type + instruction → AI mode (query ends at the FIRST whitespace)", () => {
    expect(parseSlashInput("/quiz 三道关于压强的选择题")).toEqual({
      query: "quiz",
      instruction: "三道关于压强的选择题"
    });
  });

  it("CJK queries parse (the boundary is whitespace, never \\w)", () => {
    expect(parseSlashInput("/判断题")).toEqual({ query: "判断题", instruction: "" });
    expect(parseSlashInput("/判断题 出三道题")).toEqual({ query: "判断题", instruction: "出三道题" });
  });

  it("full-width (U+3000) and newline separators both split query from instruction", () => {
    expect(parseSlashInput("/判断题　出三道题")).toEqual({ query: "判断题", instruction: "出三道题" });
    expect(parseSlashInput("/quiz\n第一行\n第二行")).toEqual({ query: "quiz", instruction: "第一行\n第二行" });
  });

  it("drops the separator run + trailing whitespace but keeps internal spacing", () => {
    expect(parseSlashInput("/quiz   two  words ")).toEqual({ query: "quiz", instruction: "two  words" });
  });
});

describe("resolveSlashEntries — tiers", () => {
  // One query, four entries, one per tier: the FULL ranking asserted as an ordering —
  // exact id beats exact alias beats prefix beats substring, regardless of input order.
  const tiers: SlashEntry[] = [
    entry("my-exercise", "我的练习"), // substring hit
    entry("exercise-set", "题组"), // id-prefix hit
    entry("drill", "训练", ["exercise"]), // exact-ALIAS hit
    entry("exercise", "练习") // exact-ID hit
  ];

  it("ranks exact id → exact alias → prefix → substring (exact beats prefix)", () => {
    expect(ids(resolveSlashEntries("exercise", tiers))).toEqual([
      "exercise",
      "drill",
      "exercise-set",
      "my-exercise"
    ]);
  });

  it("ties inside a tier keep the injected order (stable secondary order)", () => {
    // "xercise" is a SUBSTRING of all four match keys → one tier, input order preserved.
    expect(ids(resolveSlashEntries("xercise", tiers))).toEqual([
      "my-exercise",
      "exercise-set",
      "drill",
      "exercise"
    ]);
    // Both id-prefix matches at the same rank follow the injected order — flipping the
    // input flips the result.
    const pair = [entry("markdown", "文本"), entry("markmap", "脑图")];
    expect(ids(resolveSlashEntries("mark", pair))).toEqual(["markdown", "markmap"]);
    expect(ids(resolveSlashEntries("mark", [...pair].reverse()))).toEqual(["markmap", "markdown"]);
  });
});

describe("resolveSlashEntries — 中文 + case folding", () => {
  it("hits a 中文 alias exactly (/判断题 → quiz)", () => {
    expect(ids(resolveSlashEntries("判断题", ENTRIES))[0]).toBe("quiz");
    expect(ids(resolveSlashEntries("判断", ENTRIES))[0]).toBe("quiz");
  });

  it("matches a 中文 title/alias by prefix as you type", () => {
    expect(ids(resolveSlashEntries("脑", ENTRIES))).toEqual(["markmap"]); // title prefix 脑图
    expect(ids(resolveSlashEntries("思维", ENTRIES))).toEqual(["markmap"]); // alias prefix 思维导图
    expect(ids(resolveSlashEntries("练习题", ENTRIES))).toEqual(["textbook.exercise"]);
  });

  it("English matching is case-insensitive (id and alias)", () => {
    expect(ids(resolveSlashEntries("QUIZ", ENTRIES))[0]).toBe("quiz");
    expect(ids(resolveSlashEntries("Md", ENTRIES))[0]).toBe("markdown");
  });

  it("an exact English alias beats an id substring (exercise → the textbook type first)", () => {
    // "exercise" is an exact alias of textbook.exercise AND a substring of its id —
    // the exact-alias tier wins; nothing else in the table matches.
    expect(ids(resolveSlashEntries("exercise", ENTRIES))).toEqual(["textbook.exercise"]);
  });
});

describe("resolveSlashEntries — edges", () => {
  it("empty query → ALL entries in injected order (a fresh array)", () => {
    const all = resolveSlashEntries("", ENTRIES);
    expect(ids(all)).toEqual(ids([...ENTRIES]));
    expect(all).not.toBe(ENTRIES); // callers may mutate their copy
    // Whitespace-only folds to empty too.
    expect(ids(resolveSlashEntries("  ", ENTRIES))).toEqual(ids([...ENTRIES]));
  });

  it("no match → []", () => {
    expect(resolveSlashEntries("zzz不存在", ENTRIES)).toEqual([]);
  });
});
