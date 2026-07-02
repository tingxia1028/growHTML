// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { getNoteType, spec } from "../../client/notes/noteTypeRegistry";
import { noteCardMeta } from "../../client/notes/noteCardMeta";
import { slashEntriesFromNoteTypes } from "../../client/slash/adapters";
import { resolveSlashEntries } from "../../client/slash/engine";
import { resetInstallState, syncInstallState } from "../installState";

// Side-effect: installs the Product Kits (subject kits included — registers the
// subject.* specs + plugins through the REAL member-install path).
import "../clientKits";

function renderToHtml(node: React.ReactNode): string {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(node as React.ReactElement));
  const html = container.innerHTML;
  act(() => root.unmount());
  return html;
}

function setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

afterEach(() => resetInstallState());

const TYPES = ["subject.vocab", "subject.formula", "subject.timeline"];

describe("subject kit client install (M-B)", () => {
  it("registers a client plugin for each exemplar type, owned by its MEMBER plugin id", () => {
    expect(getNoteType("subject.vocab")).toMatchObject({ pluginId: "subject-vocab", hidden: false });
    expect(getNoteType("subject.formula")).toMatchObject({ pluginId: "subject-formula", hidden: false });
    expect(getNoteType("subject.timeline")).toMatchObject({ pluginId: "subject-timeline", hidden: false });
  });

  it("every registration carries 中文 title + aliases + icon (SC-0)", () => {
    expect(getNoteType("subject.vocab")).toMatchObject({ title: "生词卡", icon: "spell-check" });
    expect(getNoteType("subject.vocab")!.aliases).toEqual(expect.arrayContaining(["生词", "单词"]));
    expect(getNoteType("subject.formula")).toMatchObject({ title: "公式卡", icon: "sigma" });
    expect(getNoteType("subject.formula")!.aliases).toContain("公式");
    expect(getNoteType("subject.timeline")).toMatchObject({ title: "时间线", icon: "history" });
    expect(getNoteType("subject.timeline")!.aliases).toContain("年表");
  });

  it("focusable threads through the kit seam (formula/timeline per the doc; vocab not)", () => {
    expect(getNoteType("subject.formula")!.focusable).toBe(true);
    expect(getNoteType("subject.timeline")!.focusable).toBe(true);
    expect(getNoteType("subject.vocab")!.focusable).toBeUndefined();
  });
});

describe("公式卡 render — KaTeX through the shared <Latex> seam (the M-B gate, in the real render path)", () => {
  const content = {
    latex: "E_k = \\frac{1}{2} m v^2",
    name: "动能定理",
    variables: [
      { symbol: "E_k", meaning: "动能", unit: "J" },
      { symbol: "m", meaning: "质量", unit: "kg" }
    ],
    usage: "由功计算速度变化",
    derivationRef: "note_123"
  };

  it("card: one line of TYPESET math (.katex present, no error span, no legend)", () => {
    const html = renderToHtml(getNoteType("subject.formula")!.render({ content, mode: "card" }));
    expect(html).toContain("katex"); // KaTeX really rendered under jsdom
    expect(html).not.toContain("katex-error");
    expect(html).not.toContain("sv-formula-variables"); // legend is full-mode only
  });

  it("full: block math + variable table + usage + the derivation affordance", () => {
    const html = renderToHtml(getNoteType("subject.formula")!.render({ content, mode: "full" }));
    expect(html).toContain("katex-display"); // displayMode block
    expect(html).toContain("sv-formula-variables");
    expect(html).toContain("动能");
    expect(html).toContain("kg");
    expect(html).toContain("用法:");
    expect(html).toContain('data-note-id="note_123"');
  });

  it("bad TeX degrades inside the note (throwOnError:false) — never throws", () => {
    const html = renderToHtml(
      getNoteType("subject.formula")!.render({ content: { latex: "\\frac{", variables: [] } })
    );
    expect(html).toContain("katex-error");
  });
});

describe("生词卡 render — flashcard-isomorphic front/back", () => {
  const content = {
    word: "ephemeral",
    phonetic: "/ɪˈfemərəl/",
    pos: "adj.",
    senses: [{ definition: "短暂的", example: "Fame is ephemeral." }],
    synonyms: ["transient"],
    antonyms: ["permanent"]
  };

  it("card: word + first definition + the flip hint; the back stays hidden", () => {
    const html = renderToHtml(getNoteType("subject.vocab")!.render({ content, mode: "card" }));
    expect(html).toContain("ephemeral");
    expect(html).toContain("短暂的");
    expect(html).toContain("点击翻开查看背面");
    expect(html).not.toContain("transient"); // chips are full-mode only
  });

  it("full: front (word + phonetic/pos) and back (senses + examples) + synonym/antonym chips", () => {
    const html = renderToHtml(getNoteType("subject.vocab")!.render({ content, mode: "full" }));
    expect(html).toContain("/ɪˈfemərəl/");
    expect(html).toContain("Fame is ephemeral.");
    expect(html).toContain("transient");
    expect(html).toContain("permanent");
    expect(html).toContain("sv-flashcard-face"); // the flashcard layout, reused not reinvented
  });
});

describe("时间线 render — vertical track with expandable nodes", () => {
  const content = {
    title: "战国到统一",
    events: [
      { date: "前356", title: "商鞅变法" },
      { date: "前221", title: "秦统一六国", detail: "建立中央集权", significance: "结束分裂局面" }
    ]
  };

  it("card: compact event lines (≤3), no interaction", () => {
    const html = renderToHtml(getNoteType("subject.timeline")!.render({ content, mode: "card" }));
    expect(html).toContain("前356");
    expect(html).toContain("商鞅变法");
    expect(html).not.toContain("<details"); // expansion is full-mode only
  });

  it("full: the track renders every node; detail/significance sit in a <details> expander", () => {
    const html = renderToHtml(getNoteType("subject.timeline")!.render({ content, mode: "full" }));
    expect(html).toContain("sv-timeline-track");
    expect(html).toContain("<details");
    expect(html).toContain("建立中央集权");
    expect(html).toContain("结束分裂局面");
  });
});

describe("renders NEVER throw on foreign/mis-shaped content", () => {
  it("string / null / number content degrade gracefully for every type", () => {
    for (const t of TYPES) {
      expect(() => renderToHtml(getNoteType(t)!.render({ content: "oops" })), t).not.toThrow();
      expect(() => renderToHtml(getNoteType(t)!.render({ content: null })), t).not.toThrow();
      expect(() => renderToHtml(getNoteType(t)!.render({ content: 42, mode: "card" })), t).not.toThrow();
    }
  });
});

describe("editors emit content the core schema accepts", () => {
  function driveEditor(contentType: string, drive: (container: HTMLElement) => void): unknown {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    let current: unknown = spec(contentType).createDefault();
    const onChange = (next: unknown) => {
      current = next;
      root.render(getNoteType(contentType)!.edit({ content: current, onChange }) as React.ReactElement);
    };
    act(() => root.render(getNoteType(contentType)!.edit({ content: current, onChange }) as React.ReactElement));
    act(() => drive(container));
    act(() => root.unmount());
    container.remove();
    return current;
  }

  it("vocab editor: word + sense rows emit a schema-valid value", () => {
    const value = driveEditor("subject.vocab", (c) => {
      setValue(c.querySelector(".sv-vocab-edit-word")!, "ephemeral");
      setValue(c.querySelector(".sv-vocab-edit-definition")!, "短暂的");
      setValue(c.querySelector(".sv-vocab-edit-synonyms")!, "transient, fleeting");
    });
    expect(value).toMatchObject({ word: "ephemeral", synonyms: ["transient", "fleeting"] });
    expect(() => spec("subject.vocab").schema.parse(value)).not.toThrow();
  });

  it("formula editor: latex + variable row emit a schema-valid value AND show a live KaTeX preview", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    let current: unknown = spec("subject.formula").createDefault();
    const onChange = (next: unknown) => {
      current = next;
      root.render(getNoteType("subject.formula")!.edit({ content: current, onChange }) as React.ReactElement);
    };
    act(() => root.render(getNoteType("subject.formula")!.edit({ content: current, onChange }) as React.ReactElement));
    act(() => {
      setValue(container.querySelector(".sv-formula-edit-latex")!, "a^2 + b^2 = c^2");
      setValue(container.querySelector(".sv-formula-edit-name")!, "勾股定理");
    });
    // The edit seam renders the SAME <Latex> the display uses — live preview typesets.
    expect(container.querySelector(".sv-formula-edit-preview .katex")).toBeTruthy();
    expect(current).toMatchObject({ latex: "a^2 + b^2 = c^2", name: "勾股定理" });
    expect(() => spec("subject.formula").schema.parse(current)).not.toThrow();
    act(() => root.unmount());
    container.remove();
  });

  it("timeline editor: title + event rows emit a schema-valid value", () => {
    const value = driveEditor("subject.timeline", (c) => {
      setValue(c.querySelector(".sv-timeline-edit-title")!, "战国大事记");
      setValue(c.querySelector(".sv-timeline-edit-date")!, "前356");
      setValue(c.querySelector(".sv-timeline-edit-event-title")!, "商鞅变法");
    });
    expect(value).toMatchObject({ title: "战国大事记", events: [{ date: "前356", title: "商鞅变法" }] });
    expect(() => spec("subject.timeline").schema.parse(value)).not.toThrow();
  });
});

describe("noteCardMeta — the M-B debt: title fallbacks for the no-title-key subject types", () => {
  it("vocab → word; grammar → pattern; excerpt → quote; argument → claim", () => {
    expect(noteCardMeta("subject.vocab", { word: "ephemeral", senses: [] }).title).toBe("ephemeral");
    expect(noteCardMeta("subject.grammar", { pattern: "would rather + 动词原形" }).title).toBe(
      "would rather + 动词原形"
    );
    expect(noteCardMeta("subject.excerpt", { quote: "落霞与孤鹜齐飞" }).title).toBe("落霞与孤鹜齐飞");
    expect(noteCardMeta("subject.argument", { claim: "科技进步扩大而非缩小了教育差距" }).title).toBe(
      "科技进步扩大而非缩小了教育差距"
    );
  });

  it("formula titles from `name`, timeline from `title` (the generic scan) + the event-count extra", () => {
    expect(noteCardMeta("subject.formula", { latex: "E=mc^2", name: "质能方程", variables: [] }).title).toBe(
      "质能方程"
    );
    const timeline = noteCardMeta("subject.timeline", {
      title: "战国到统一",
      events: [{ date: "前356", title: "商鞅变法" }, { date: "前221", title: "秦统一" }]
    });
    expect(timeline.title).toBe("战国到统一");
    expect(timeline.extra).toBe("2 事件");
  });
});

describe("slash palette (SC-0 adapter) × effective-installed (M1)", () => {
  it("NOT default-installed: subject types stay out of the palette until their kit installs", () => {
    resetInstallState(); // null state = default-installed set — subject kits are opt-in
    const ids = slashEntriesFromNoteTypes().map((e) => e.id);
    for (const t of TYPES) expect(ids, `${t} must be gated pre-install`).not.toContain(t);
  });

  it("installing 英语 Kit lights up 生词卡 in the palette — with 中文 title + provider badge (PART 5 M-B)", () => {
    syncInstallState({
      catalogState: { installedPlugins: [], installedKits: ["subject-english"] },
      userKits: []
    });
    const entry = slashEntriesFromNoteTypes().find((e) => e.id === "subject.vocab");
    expect(entry).toMatchObject({ title: "生词卡", kitId: "subject-vocab", icon: "spell-check" });
    // `/生词` resolves to the vocab type through the real engine.
    expect(resolveSlashEntries("生词", slashEntriesFromNoteTypes())[0]?.id).toBe("subject.vocab");
    // The other kits stay uninstalled → their types stay gated.
    expect(slashEntriesFromNoteTypes().find((e) => e.id === "subject.formula")).toBeUndefined();
  });
});
