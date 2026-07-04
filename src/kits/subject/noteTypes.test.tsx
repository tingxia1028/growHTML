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

const MC_TYPES = [
  "subject.derivation",
  "subject.theorem",
  "subject.grammar",
  "subject.excerpt",
  "subject.argument",
  "subject.figure",
  "subject.cause-effect",
  "subject.experiment"
];

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

  // N4-D7: the FULL vocab is now an INTERACTIVE flip card (front word/phonetic shows first;
  // the back senses/examples/chips appear only after a flip — one face at a time). Was
  // static (both faces rendered at once). Deck nav across siblings stays deferred.
  it("full: flip card — front (word + phonetic) first; back (senses + chips) only after a flip", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(getNoteType("subject.vocab")!.render({ content, mode: "full" }) as React.ReactElement));

    expect(container.innerHTML).toContain("sv-flashcard-face"); // the flashcard layout, reused not reinvented
    const card = container.querySelector(".sv-flip") as HTMLElement;
    expect(card.getAttribute("data-face")).toBe("front");
    expect(container.textContent).toContain("/ɪˈfemərəl/"); // front phonetic visible
    expect(container.textContent).not.toContain("Fame is ephemeral."); // back example hidden
    expect(container.textContent).not.toContain("transient");

    act(() => card.click());
    expect(card.getAttribute("data-face")).toBe("back");
    expect(container.textContent).toContain("Fame is ephemeral."); // back example revealed
    expect(container.textContent).toContain("transient");
    expect(container.textContent).toContain("permanent");

    act(() => root.unmount());
    container.remove();
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
  it("string / null / number content degrade gracefully for every type (M-B + M-C)", () => {
    for (const t of [...TYPES, ...MC_TYPES]) {
      expect(() => renderToHtml(getNoteType(t)!.render({ content: "oops" })), t).not.toThrow();
      expect(() => renderToHtml(getNoteType(t)!.render({ content: null })), t).not.toThrow();
      expect(() => renderToHtml(getNoteType(t)!.render({ content: 42, mode: "card" })), t).not.toThrow();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// M-C — the remaining 8 types. Registration + card/full render + math parse-error
// fallback (derivation/theorem) + registry dispatch under jsdom + editor round-trips.
// ═══════════════════════════════════════════════════════════════════════════

describe("M-C client install — one plugin per remaining type, owned by its member id", () => {
  it("registers a client plugin for each M-C type under its member plugin id", () => {
    for (const [ct, pluginId] of [
      ["subject.derivation", "subject-derivation"],
      ["subject.theorem", "subject-theorem"],
      ["subject.grammar", "subject-grammar"],
      ["subject.excerpt", "subject-excerpt"],
      ["subject.argument", "subject-argument"],
      ["subject.figure", "subject-figure"],
      ["subject.cause-effect", "subject-cause-effect"],
      ["subject.experiment", "subject-experiment"]
    ] as const) {
      expect(getNoteType(ct), ct).toMatchObject({ pluginId, hidden: false });
    }
  });

  it("每 registration carries 中文 title + icon (SC-0)", () => {
    expect(getNoteType("subject.derivation")).toMatchObject({ title: "推导步骤", icon: "list-ordered" });
    expect(getNoteType("subject.theorem")).toMatchObject({ title: "定理卡", icon: "scroll-text" });
    expect(getNoteType("subject.grammar")).toMatchObject({ title: "语法点", icon: "languages" });
    expect(getNoteType("subject.excerpt")).toMatchObject({ title: "摘抄赏析", icon: "quote" });
    expect(getNoteType("subject.argument")).toMatchObject({ title: "论证结构", icon: "scale" });
    expect(getNoteType("subject.figure")).toMatchObject({ title: "人物卡", icon: "user-round" });
    expect(getNoteType("subject.cause-effect")).toMatchObject({ title: "因果链", icon: "waypoints" });
    expect(getNoteType("subject.experiment")).toMatchObject({ title: "实验记录", icon: "flask-conical" });
  });

  it("focusable threads through for the rich full views (derivation/argument/cause-effect/experiment)", () => {
    expect(getNoteType("subject.derivation")!.focusable).toBe(true);
    expect(getNoteType("subject.argument")!.focusable).toBe(true);
    expect(getNoteType("subject.cause-effect")!.focusable).toBe(true);
    expect(getNoteType("subject.experiment")!.focusable).toBe(true);
    // theorem/grammar/excerpt/figure stay non-focusable (fact-sheet fulls).
    expect(getNoteType("subject.theorem")!.focusable).toBeUndefined();
    expect(getNoteType("subject.figure")!.focusable).toBeUndefined();
  });
});

describe("推导步骤 render — LaTeX steps through the shared <Latex> seam", () => {
  const content = {
    title: "动能定理推导",
    goal: "由功推出 E_k",
    steps: [{ expr: "W = F s", rationale: "功的定义" }, { expr: "E_k = \\frac{1}{2} m v^2" }],
    result: "E_k = \\frac{1}{2} m v^2"
  };
  it("card: goal + step count, no typeset math / no interaction", () => {
    const html = renderToHtml(getNoteType("subject.derivation")!.render({ content, mode: "card" }));
    expect(html).toContain("2 步推导");
    expect(html).not.toContain("katex-display");
  });
  it("full: numbered steps render KaTeX; rationale sits in a <details>; result boxed", () => {
    const html = renderToHtml(getNoteType("subject.derivation")!.render({ content, mode: "full" }));
    expect(html).toContain("katex"); // steps typeset through <Latex>
    expect(html).toContain("<details");
    expect(html).toContain("功的定义");
    expect(html).toContain("sv-derivation-result");
  });
  it("bad TeX degrades inside the note (throwOnError:false) — never throws", () => {
    const html = renderToHtml(
      getNoteType("subject.derivation")!.render({ content: { title: "T", steps: [{ expr: "\\frac{" }] } })
    );
    expect(html).toContain("katex-error");
  });
});

describe("定理卡 render — statement LaTeX-aware + sectioned full", () => {
  const content = {
    name: "勾股定理",
    statement: "a^2 + b^2 = c^2",
    conditions: ["直角三角形"],
    proof: "面积法证明",
    usage: "求第三边",
    examples: ["3-4-5"]
  };
  it("card: first statement line, no proof", () => {
    const html = renderToHtml(getNoteType("subject.theorem")!.render({ content, mode: "card" }));
    expect(html).toContain("a"); // statement text present
    expect(html).not.toContain("面积法证明"); // proof is full-mode only
  });
  it("full: statement typesets · conditions · proof (details) · usage · examples", () => {
    const html = renderToHtml(getNoteType("subject.theorem")!.render({ content, mode: "full" }));
    expect(html).toContain("katex"); // statement through <Latex inline>
    expect(html).toContain("直角三角形");
    expect(html).toContain("<details");
    expect(html).toContain("面积法证明");
    expect(html).toContain("用法:");
    expect(html).toContain("3-4-5");
  });
  it("bad TeX in the statement degrades (throwOnError:false)", () => {
    const html = renderToHtml(getNoteType("subject.theorem")!.render({ content: { name: "T", statement: "\\frac{" } }));
    expect(html).toContain("katex-error");
  });
});

describe("语法点 render — pattern + examples + pitfalls warn", () => {
  const content = {
    pattern: "would rather + 动词原形",
    meaning: "宁愿",
    structure: "would rather + do",
    examples: [{ sentence: "I would rather stay.", note: "原形" }],
    pitfalls: ["不加 to"]
  };
  it("card: pattern line, no examples", () => {
    const html = renderToHtml(getNoteType("subject.grammar")!.render({ content, mode: "card" }));
    expect(html).toContain("would rather");
    expect(html).not.toContain("I would rather stay."); // examples are full-mode only
  });
  it("full: examples + pitfalls in warn styling", () => {
    const html = renderToHtml(getNoteType("subject.grammar")!.render({ content, mode: "full" }));
    expect(html).toContain("I would rather stay.");
    expect(html).toContain("sv-warn");
    expect(html).toContain("不加 to");
  });
});

describe("摘抄赏析 render — blockquote + attribution + devices", () => {
  const content = {
    quote: "落霞与孤鹜齐飞",
    author: "王勃",
    work: "滕王阁序",
    comment: "对偶工整",
    devices: ["对偶"],
    theme: "壮美"
  };
  it("card: the quote in a blockquote, no comment/devices", () => {
    const html = renderToHtml(getNoteType("subject.excerpt")!.render({ content, mode: "card" }));
    expect(html).toContain("落霞与孤鹜齐飞");
    expect(html).toContain("<blockquote");
    expect(html).not.toContain("对偶工整"); // comment full-mode only
  });
  it("full: quote + author/work + comment + device chips + theme", () => {
    const html = renderToHtml(getNoteType("subject.excerpt")!.render({ content, mode: "full" }));
    expect(html).toContain("王勃");
    expect(html).toContain("滕王阁序");
    expect(html).toContain("对偶工整");
    expect(html).toContain("sv-excerpt-device");
  });
});

describe("论证结构 render — Toulmin indent tree", () => {
  const content = {
    claim: "科技扩大差距",
    grounds: ["资源集中"],
    warrant: "获取不平等放大差距",
    evidence: ["完成率差异"],
    counter: ["理论人人可用"],
    conclusion: "需政策配套"
  };
  it("card: claim line only", () => {
    const html = renderToHtml(getNoteType("subject.argument")!.render({ content, mode: "card" }));
    expect(html).toContain("科技扩大差距");
    expect(html).not.toContain("资源集中"); // grounds full-mode only
  });
  it("full: claim → grounds → warrant → evidence → counter → conclusion", () => {
    const html = renderToHtml(getNoteType("subject.argument")!.render({ content, mode: "full" }));
    for (const s of ["资源集中", "获取不平等放大差距", "完成率差异", "理论人人可用", "需政策配套"]) {
      expect(html, s).toContain(s);
    }
  });
});

describe("人物卡 render — fact sheet", () => {
  const content = {
    name: "商鞅",
    era: "战国",
    role: "改革家",
    facts: ["主持变法"],
    works: ["商君书"],
    significance: "奠定统一基础",
    relations: [{ name: "秦孝公", relation: "君主" }]
  };
  it("card: role + era (name comes via noteCardMeta)", () => {
    const html = renderToHtml(getNoteType("subject.figure")!.render({ content, mode: "card" }));
    expect(html).toContain("改革家");
    expect(html).not.toContain("主持变法"); // facts full-mode only
  });
  it("full: facts + works + significance + relations", () => {
    const html = renderToHtml(getNoteType("subject.figure")!.render({ content, mode: "full" }));
    expect(html).toContain("主持变法");
    expect(html).toContain("商君书");
    expect(html).toContain("奠定统一基础");
    expect(html).toContain("秦孝公");
  });
});

describe("因果链 render — cause → event → effect", () => {
  const content = {
    title: "商鞅变法",
    event: "商鞅变法",
    causes: [{ factor: "国力落后", category: "政治" }],
    effects: [{ outcome: "国力上升", term: "短期" }, { outcome: "为统一奠基", term: "长期" }]
  };
  it("card: event + cause/effect counts", () => {
    const html = renderToHtml(getNoteType("subject.cause-effect")!.render({ content, mode: "card" }));
    expect(html).toContain("1 因 · 2 果");
  });
  it("full: causes (with category) · pivot event · effects (with term)", () => {
    const html = renderToHtml(getNoteType("subject.cause-effect")!.render({ content, mode: "full" }));
    expect(html).toContain("国力落后");
    expect(html).toContain("[政治]");
    expect(html).toContain("[短期]");
    expect(html).toContain("[长期]");
    expect(html).toContain("为统一奠基");
  });
});

describe("实验记录 render — sectioned sheet + safety warn", () => {
  const content = {
    title: "测密度",
    purpose: "测定密度",
    materials: ["天平"],
    procedure: ["称质量", "测体积"],
    observations: ["水面上升"],
    conclusion: "ρ = m/V",
    safety: ["小心量筒"]
  };
  it("card: conclusion or purpose line", () => {
    const html = renderToHtml(getNoteType("subject.experiment")!.render({ content, mode: "card" }));
    expect(html).toContain("ρ = m/V"); // conclusion preferred
    expect(html).not.toContain("称质量"); // procedure full-mode only
  });
  it("full: purpose · materials · numbered procedure · observations · conclusion · safety warn", () => {
    const html = renderToHtml(getNoteType("subject.experiment")!.render({ content, mode: "full" }));
    expect(html).toContain("<ol"); // numbered procedure
    expect(html).toContain("称质量");
    expect(html).toContain("水面上升");
    expect(html).toContain("sv-warn"); // safety callout
    expect(html).toContain("小心量筒");
  });
});

describe("M-C editors emit content the core schema accepts (registry dispatch under jsdom)", () => {
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

  it("derivation editor: title + step expr emit a schema-valid value", () => {
    const value = driveEditor("subject.derivation", (c) => {
      setValue(c.querySelector(".sv-derivation-edit-title")!, "推导");
      setValue(c.querySelector(".sv-derivation-edit-expr")!, "W = F s");
    });
    expect(value).toMatchObject({ title: "推导", steps: [{ expr: "W = F s" }] });
    expect(() => spec("subject.derivation").schema.parse(value)).not.toThrow();
  });

  it("theorem editor: name + statement emit a schema-valid value", () => {
    const value = driveEditor("subject.theorem", (c) => {
      setValue(c.querySelector(".sv-theorem-edit-name")!, "勾股定理");
      setValue(c.querySelector(".sv-theorem-edit-statement")!, "a^2+b^2=c^2");
    });
    expect(value).toMatchObject({ name: "勾股定理", statement: "a^2+b^2=c^2" });
    expect(() => spec("subject.theorem").schema.parse(value)).not.toThrow();
  });

  it("grammar editor: pattern + meaning + example emit a schema-valid value", () => {
    const value = driveEditor("subject.grammar", (c) => {
      setValue(c.querySelector(".sv-grammar-edit-pattern")!, "would rather");
      setValue(c.querySelector(".sv-grammar-edit-meaning")!, "宁愿");
      setValue(c.querySelector(".sv-grammar-edit-sentence")!, "I would rather stay.");
    });
    expect(value).toMatchObject({ pattern: "would rather", meaning: "宁愿" });
    expect(() => spec("subject.grammar").schema.parse(value)).not.toThrow();
  });

  it("excerpt editor: quote + comment emit a schema-valid value", () => {
    const value = driveEditor("subject.excerpt", (c) => {
      setValue(c.querySelector(".sv-excerpt-edit-quote")!, "落霞与孤鹜齐飞");
      setValue(c.querySelector(".sv-excerpt-edit-comment")!, "对偶工整");
      setValue(c.querySelector(".sv-excerpt-edit-devices")!, "对偶, 借景");
    });
    expect(value).toMatchObject({ quote: "落霞与孤鹜齐飞", comment: "对偶工整", devices: ["对偶", "借景"] });
    expect(() => spec("subject.excerpt").schema.parse(value)).not.toThrow();
  });

  it("argument editor: claim + grounds emit a schema-valid value", () => {
    const value = driveEditor("subject.argument", (c) => {
      setValue(c.querySelector(".sv-argument-edit-claim")!, "论点");
      setValue(c.querySelector(".sv-argument-edit-grounds")!, "论据一\n论据二");
    });
    expect(value).toMatchObject({ claim: "论点", grounds: ["论据一", "论据二"] });
    expect(() => spec("subject.argument").schema.parse(value)).not.toThrow();
  });

  it("figure editor: name + facts emit a schema-valid value", () => {
    const value = driveEditor("subject.figure", (c) => {
      setValue(c.querySelector(".sv-figure-edit-name")!, "商鞅");
      setValue(c.querySelector(".sv-figure-edit-facts")!, "主持变法\n奖励耕战");
    });
    expect(value).toMatchObject({ name: "商鞅", facts: ["主持变法", "奖励耕战"] });
    expect(() => spec("subject.figure").schema.parse(value)).not.toThrow();
  });

  it("cause-effect editor: title + event + factor + outcome emit a schema-valid value", () => {
    const value = driveEditor("subject.cause-effect", (c) => {
      setValue(c.querySelector(".sv-cause-effect-edit-title")!, "变法");
      setValue(c.querySelector(".sv-cause-effect-edit-event")!, "商鞅变法");
      setValue(c.querySelector(".sv-cause-effect-edit-factor")!, "国力落后");
      setValue(c.querySelector(".sv-cause-effect-edit-outcome")!, "国力上升");
    });
    expect(value).toMatchObject({
      title: "变法",
      event: "商鞅变法",
      causes: [{ factor: "国力落后" }],
      effects: [{ outcome: "国力上升" }]
    });
    expect(() => spec("subject.cause-effect").schema.parse(value)).not.toThrow();
  });

  it("experiment editor: title + purpose + procedure emit a schema-valid value", () => {
    const value = driveEditor("subject.experiment", (c) => {
      setValue(c.querySelector(".sv-experiment-edit-title")!, "测密度");
      setValue(c.querySelector(".sv-experiment-edit-purpose")!, "测定密度");
      setValue(c.querySelector(".sv-experiment-edit-procedure")!, "称质量\n测体积");
    });
    expect(value).toMatchObject({ title: "测密度", purpose: "测定密度", procedure: ["称质量", "测体积"] });
    expect(() => spec("subject.experiment").schema.parse(value)).not.toThrow();
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
