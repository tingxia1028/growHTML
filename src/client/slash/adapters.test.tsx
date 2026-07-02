// @vitest-environment jsdom
// Adapter mapping tests (SC-0) — the REAL registries → SlashEntry derivation:
// every visible built-in + textbook kit type appears with its 中文 title/aliases,
// hidden types are skipped, titles fall back to the contentType, and the kit badge
// (kitId) is threaded from the owning registration.
import { describe, expect, it, vi } from "vitest";
import { parseSlashInput, resolveSlashEntries } from "./engine";
import { registerNoteType } from "../notes/noteTypeRegistry";
import { slashEntriesFromNoteTypes } from "./adapters";

// Stub DiagramNote so importing the built-ins doesn't pull mermaid/markmap-view
// (they need a real browser) into jsdom — same stub the registry test uses.
vi.mock("../DiagramNote", () => ({
  DiagramNote: () => <div className="mock-diagram" />
}));

// Side effects: register the 13 built-ins + install the Product Kits (textbook).
import "../notes/builtinNoteTypes";
import "../../kits/clientKits";

const byId = (id: string) => slashEntriesFromNoteTypes().find((e) => e.id === id);
const hasChinese = (s: string) => /[一-鿿]/.test(s);

describe("slashEntriesFromNoteTypes — registry-derived palette entries", () => {
  it("maps every VISIBLE built-in (kind=noteType, no kit badge)", () => {
    const visibleBuiltins = [
      "markdown",
      "mermaid",
      "markmap",
      "flashcard",
      "quiz",
      "code-snippet",
      "image",
      "audio",
      "video",
      "html-sandbox"
    ];
    for (const id of visibleBuiltins) {
      const entry = byId(id);
      expect(entry, `missing entry for ${id}`).toBeTruthy();
      expect(entry!.kind).toBe("noteType");
      expect(entry!.kitId).toBeUndefined();
    }
  });

  it("skips HIDDEN registrations (bookmark / plain-text / mindmap are not composer entries)", () => {
    for (const id of ["bookmark", "plain-text", "mindmap"]) {
      expect(byId(id), `${id} must not appear in the palette`).toBeUndefined();
    }
  });

  it("every visible entry carries a title and at least one 中文 match key", () => {
    for (const entry of slashEntriesFromNoteTypes()) {
      expect(entry.title, `${entry.id} needs a title`).toBeTruthy();
      const keys = [entry.title, ...entry.aliases];
      expect(keys.some(hasChinese), `${entry.id} needs a 中文 title or alias (${keys.join(", ")})`).toBe(true);
    }
  });

  it("spot-checks the built-in 中文 table", () => {
    expect(byId("markdown")).toMatchObject({ title: "文本" });
    expect(byId("markdown")!.aliases).toEqual(expect.arrayContaining(["笔记", "md"]));
    expect(byId("quiz")).toMatchObject({ title: "小测" });
    expect(byId("quiz")!.aliases).toEqual(expect.arrayContaining(["判断题", "选择题"]));
    expect(byId("flashcard")).toMatchObject({ title: "闪卡" });
    expect(byId("mermaid")).toMatchObject({ title: "图表" });
    expect(byId("markmap")).toMatchObject({ title: "脑图" });
    expect(byId("markmap")!.aliases).toContain("mindmap"); // retired type's name lands on markmap
    expect(byId("image")).toMatchObject({ title: "图片" });
    expect(byId("html-sandbox")!.aliases).toContain("html");
  });

  it("textbook kit types appear with 中文 titles + their owning kitId (the badge)", () => {
    expect(byId("textbook.explanation")).toMatchObject({ title: "讲解", kitId: "textbook-learning" });
    expect(byId("textbook.exercise")).toMatchObject({ title: "练习", kitId: "textbook-learning" });
    expect(byId("textbook.mistake")).toMatchObject({ title: "错题", kitId: "textbook-learning" });
    expect(byId("textbook.review-pack")).toMatchObject({ title: "复习包", kitId: "textbook-learning" });
  });

  it("a registration without title/aliases falls back to contentType + [] (never dropped)", () => {
    registerNoteType({ contentType: "test.slash-fallback", render: () => null, edit: () => null });
    const entry = byId("test.slash-fallback");
    expect(entry).toMatchObject({ title: "test.slash-fallback", aliases: [], kitId: undefined });
  });
});

describe("engine × adapter integration — the real table resolves", () => {
  it('"/判断题 出三道" parses and resolves to quiz first', () => {
    const parsed = parseSlashInput("/判断题 出三道")!;
    expect(parsed).toEqual({ query: "判断题", instruction: "出三道" });
    const ranked = resolveSlashEntries(parsed.query, slashEntriesFromNoteTypes());
    expect(ranked[0]?.id).toBe("quiz");
  });

  it('"/练习 五道压强题" resolves to the textbook exercise type first', () => {
    const parsed = parseSlashInput("/练习 五道压强题")!;
    const ranked = resolveSlashEntries(parsed.query, slashEntriesFromNoteTypes());
    expect(ranked[0]?.id).toBe("textbook.exercise");
  });

  it('bare "/" enumerates the whole visible palette', () => {
    const parsed = parseSlashInput("/")!;
    const all = resolveSlashEntries(parsed.query, slashEntriesFromNoteTypes());
    expect(all.length).toBe(slashEntriesFromNoteTypes().length);
    expect(all.length).toBeGreaterThanOrEqual(14); // 10 visible built-ins + 4 textbook types
  });
});
