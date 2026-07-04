// @vitest-environment jsdom
// Adapter mapping tests (SC-0 + M1/F4) — the REAL registries → SlashEntry derivation:
// every visible built-in + textbook kit type appears with its 中文 title/aliases,
// hidden types are skipped, titles fall back to the contentType, the provider badge
// (kitId) is threaded from the owning registration — and (M1) the marketplace
// effective-installed set GATES the list: an uninstalled provider's types drop out
// while core primitives always stay.
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseSlashInput, resolveSlashEntries } from "./engine";
import { registerNoteType } from "../notes/noteTypeRegistry";
import { slashEntriesFromNoteTypes, slashEntries, rankByActiveKit } from "./adapters";
import { registerCatalogEntry } from "../../kits/catalog";
import { resetInstallState, syncInstallState } from "../../kits/installState";
import type { SlashEntry } from "./engine";

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

afterEach(() => resetInstallState());

describe("slashEntriesFromNoteTypes — registry-derived palette entries", () => {
  it("maps every VISIBLE built-in; core primitives carry NO provider badge, cataloged plugins carry theirs (F5)", () => {
    // True core primitives: no owning plugin (always available, §8.1).
    for (const id of ["markdown", "code-snippet", "image", "audio", "video", "html-sandbox"]) {
      const entry = byId(id);
      expect(entry, `missing entry for ${id}`).toBeTruthy();
      expect(entry!.kind).toBe("noteType");
      expect(entry!.kitId, `${id} must have no provider badge`).toBeUndefined();
    }
    // Reclassified built-ins: their REAL plugin id (the F5 seedCorePlugin fix).
    expect(byId("flashcard")!.kitId).toBe("flashcard");
    expect(byId("quiz")!.kitId).toBe("quiz");
    expect(byId("mermaid")!.kitId).toBe("diagrams");
    expect(byId("markmap")!.kitId).toBe("diagrams");
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

  it("textbook kit types appear with 中文 titles + their owning MEMBER plugin id (F5 split)", () => {
    expect(byId("textbook.explanation")).toMatchObject({ title: "讲解", kitId: "explanation" });
    expect(byId("textbook.exercise")).toMatchObject({ title: "练习", kitId: "practice" });
    expect(byId("textbook.review-pack")).toMatchObject({ title: "复习包", kitId: "review-pack" });
  });

  it("SHELL-PRIM: 链接文件 is the CORE `file-link` type — visible, no provider badge", () => {
    const entry = byId("file-link");
    expect(entry).toMatchObject({ title: "链接文件" });
    expect(entry!.kitId).toBeUndefined(); // core primitive — never gated
    expect(entry!.aliases).toEqual(expect.arrayContaining(["链接", "文件", "file", "link"]));
  });

  it("REV-CORE: 错题 is the CORE `mistake` type — no provider badge, legacy id not listed", () => {
    expect(byId("mistake")).toMatchObject({ title: "错题" });
    expect(byId("mistake")!.kitId).toBeUndefined(); // core — never gated
    expect(byId("textbook.mistake")).toBeUndefined(); // an ALIAS, not a palette entry
  });

  it("a registration without title/aliases falls back to contentType + [] (never dropped)", () => {
    registerNoteType({ contentType: "test.slash-fallback", render: () => null, edit: () => null });
    const entry = byId("test.slash-fallback");
    expect(entry).toMatchObject({ title: "test.slash-fallback", aliases: [], kitId: undefined });
  });
});

describe("M1/F4 — effective-installed gates the palette list (slash-composer §1)", () => {
  it("an uninstalled provider's types drop out; core primitives + installed providers stay", () => {
    // Uninstall everything except the flashcard plugin (a direct hold).
    syncInstallState({ catalogState: { installedPlugins: ["flashcard"], installedKits: [] }, userKits: [] });
    expect(byId("quiz")).toBeUndefined(); // provider `quiz` uninstalled → create entry gone
    expect(byId("textbook.explanation")).toBeUndefined(); // kit uninstalled → member gone
    expect(byId("flashcard")).toBeTruthy(); // directly installed → stays
    expect(byId("markdown")).toBeTruthy(); // core primitive → ALWAYS available
    expect(byId("mistake")).toBeTruthy(); // REV-CORE: the mission-loop type is core → never gated
  });

  it("a kit install brings its members' types back (union semantics)", () => {
    syncInstallState({
      catalogState: { installedPlugins: [], installedKits: ["textbook-learning"] },
      userKits: []
    });
    expect(byId("textbook.exercise")).toBeTruthy(); // via the kit's members
    expect(byId("quiz")).toBeUndefined(); // not in the kit, not direct
  });

  it("types of an UNCATALOGED provider are never gated (test/core registrations)", () => {
    registerCatalogEntry({
      id: "gated-plugin",
      kind: "plugin",
      name: "Gated",
      description: "",
      provides: ["test.gated"],
      defaultInstalled: true,
      source: "bundled"
    });
    registerNoteType({ contentType: "test.gated", pluginId: "gated-plugin", title: "受控", render: () => null, edit: () => null });
    registerNoteType({ contentType: "test.free", title: "自由", render: () => null, edit: () => null });
    syncInstallState({ catalogState: { installedPlugins: [], installedKits: [] }, userKits: [] });
    expect(byId("test.gated")).toBeUndefined(); // cataloged + uninstalled → gated
    expect(byId("test.free")).toBeTruthy(); // uncataloged → always listed
  });
});

describe("engine × adapter integration — the real table resolves", () => {
  it('"/判断题 出三道" parses and resolves to quiz first', () => {
    const parsed = parseSlashInput("/判断题 出三道")!;
    expect(parsed).toEqual({ query: "判断题", instruction: "出三道" });
    const ranked = resolveSlashEntries(parsed.query, slashEntriesFromNoteTypes());
    expect(ranked[0]?.id).toBe("quiz");
  });

  it('"/链接 我的讲义" resolves to file-link first (SHELL-PRIM)', () => {
    const parsed = parseSlashInput("/链接 我的讲义")!;
    expect(parsed).toEqual({ query: "链接", instruction: "我的讲义" });
    const ranked = resolveSlashEntries(parsed.query, slashEntriesFromNoteTypes());
    expect(ranked[0]?.id).toBe("file-link");
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

describe("rankByActiveKit — active-kit-first, stable (SC-3)", () => {
  const nt = (id: string, kitId?: string): SlashEntry => ({ kind: "noteType", id, title: id, aliases: [], kitId });

  it("floats an active kit's entries to the front, keeping each group's order", () => {
    const list = [nt("a"), nt("kitA-1", "kitA"), nt("b"), nt("kitA-2", "kitA"), nt("kitB-1", "kitB")];
    const ranked = rankByActiveKit(list, ["kitA"]);
    expect(ranked.map((e) => e.id)).toEqual(["kitA-1", "kitA-2", "a", "b", "kitB-1"]);
  });

  it("is a no-op (fresh array, unchanged order) when no kit is foregrounded", () => {
    const list = [nt("a", "kitA"), nt("b")];
    const ranked = rankByActiveKit(list, []);
    expect(ranked.map((e) => e.id)).toEqual(["a", "b"]);
    expect(ranked).not.toBe(list);
    expect(rankByActiveKit(list, undefined).map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("foregrounds a kit's MEMBER-owned entries too (member id ∈ the active kit)", () => {
    // textbook-learning's members own textbook.* types; activating the kit floats them.
    const nts = slashEntriesFromNoteTypes();
    const ranked = rankByActiveKit(nts, ["textbook-learning"]);
    const firstNonTextbook = ranked.findIndex((e) => !e.id.startsWith("textbook."));
    const lastTextbook = ranked.map((e) => e.id.startsWith("textbook.")).lastIndexOf(true);
    // Every textbook.* entry precedes the first non-textbook entry (they were floated).
    expect(lastTextbook).toBeLessThan(firstNonTextbook);
  });
});

describe("slashEntries — note types + operations, active-kit-first (SC-3)", () => {
  it("still produces the note-type entries unchanged (regression) when no ops are passed", () => {
    const combined = slashEntries();
    const noteTypeIds = combined.filter((e) => e.kind === "noteType").map((e) => e.id);
    // The note-type slice is byte-identical to the SC-1 note-types-only adapter output.
    expect(noteTypeIds).toEqual(slashEntriesFromNoteTypes().map((e) => e.id));
    // Even with no custom-op argument, the STATIC built-in kit actions (textbook
    // prompts) still surface as operation entries — that's the SC-3 breadth.
    expect(combined.some((e) => e.kind === "operation")).toBe(true);
    expect(combined.some((e) => e.id === "textbook.explain-concept")).toBe(true);
  });

  it("merges custom operations after note types and both resolve", () => {
    const combined = slashEntries({ operations: [{ id: "op_S", name: "我的总结", scope: "anchor" }] });
    expect(combined.some((e) => e.kind === "operation" && e.id === "op_S")).toBe(true);
    // The op resolves by its 中文 name…
    expect(resolveSlashEntries("我的总结", combined)[0]?.id).toBe("op_S");
    // …and the note types still resolve (quiz by 中文 alias).
    expect(resolveSlashEntries("判断题", combined)[0]?.id).toBe("quiz");
  });

  it("active-kit-first: an active kit's note types AND its built-in operations lead", () => {
    const combined = slashEntries({ foregroundKitIds: ["textbook-learning"] });
    const firstId = combined[0]?.id ?? "";
    expect(firstId.startsWith("textbook.")).toBe(true);
  });
});
