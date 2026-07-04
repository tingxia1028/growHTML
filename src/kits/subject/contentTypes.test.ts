import { describe, expect, it } from "vitest";
import { getNoteContentSpec, parseNoteContent } from "../../core/notes/contentTypes";
import { installServerKits } from "../server";
import {
  argumentSpec,
  causeEffectSpec,
  derivationSpec,
  excerptSpec,
  experimentSpec,
  figureSpec,
  formulaSpec,
  grammarSpec,
  theoremSpec,
  timelineSpec,
  vocabSpec,
  subjectContentSpecs
} from "./contentTypes";
import { subjectPrompts } from "./prompts";

// installServerKits registers the subject specs into the core registry — the same
// path the API uses for validation (kits/index.ts aggregation, M-B/M-C).
installServerKits();

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

describe("subject kit content specs (M-B exemplars)", () => {
  it("registers all 3 exemplar content types into the core registry via installServerKits", () => {
    for (const t of TYPES) expect(getNoteContentSpec(t), `missing spec ${t}`).toBeTruthy();
  });

  it("each createDefault round-trips through its own schema", () => {
    for (const spec of [vocabSpec, formulaSpec, timelineSpec]) {
      expect(() => spec.schema.parse(spec.createDefault())).not.toThrow();
    }
  });

  it("vocab: word + senses required; senses carry definition (+ optional example); srs is reserved but valid", () => {
    expect(() =>
      parseNoteContent("subject.vocab", {
        word: "ephemeral",
        phonetic: "/ɪˈfemərəl/",
        pos: "adj.",
        senses: [{ definition: "短暂的", example: "Fame is ephemeral." }],
        synonyms: ["transient"],
        srs: { ease: 2.5, intervalDays: 3, due: "2026-07-05T00:00:00Z", reps: 2 }
      })
    ).not.toThrow();
    // missing senses → reject
    expect(() => parseNoteContent("subject.vocab", { word: "x" })).toThrow();
    // a sense without a definition → reject
    expect(() => parseNoteContent("subject.vocab", { word: "x", senses: [{ example: "no def" }] })).toThrow();
  });

  it("formula: latex + variables required (variables may be []); legend rows need symbol+meaning", () => {
    expect(() =>
      parseNoteContent("subject.formula", {
        latex: "E_k = \\frac{1}{2} m v^2",
        name: "动能定理",
        variables: [{ symbol: "E_k", meaning: "动能", unit: "J" }],
        usage: "由功求速度变化"
      })
    ).not.toThrow();
    expect(() => parseNoteContent("subject.formula", { latex: "a^2+b^2=c^2", variables: [] })).not.toThrow();
    expect(() => parseNoteContent("subject.formula", { latex: "x" })).toThrow(); // variables required
    expect(() =>
      parseNoteContent("subject.formula", { latex: "x", variables: [{ symbol: "m" }] })
    ).toThrow(); // meaning required
  });

  it("timeline: title + events required; events need date + title", () => {
    expect(() =>
      parseNoteContent("subject.timeline", {
        title: "战国到统一",
        events: [
          { date: "前356", title: "商鞅变法", significance: "国力上升" },
          { date: "前221", title: "秦统一六国", detail: "建立中央集权" }
        ]
      })
    ).not.toThrow();
    expect(() => parseNoteContent("subject.timeline", { title: "T" })).toThrow(); // events required
    expect(() => parseNoteContent("subject.timeline", { title: "T", events: [{ date: "前356" }] })).toThrow();
  });

  it("reduces content to searchable text without structural noise", () => {
    expect(
      vocabSpec.toSearchText({
        word: "ephemeral",
        phonetic: "/ɪˈfemərəl/",
        senses: [{ definition: "短暂的", example: "Fame is ephemeral." }],
        synonyms: ["transient"]
      })
    ).toBe("ephemeral\n/ɪˈfemərəl/\n短暂的\nFame is ephemeral.\ntransient");
    expect(
      formulaSpec.toSearchText({
        latex: "E_k = \\frac{1}{2} m v^2",
        name: "动能定理",
        variables: [{ symbol: "m", meaning: "质量", unit: "kg" }],
        usage: "求动能"
      })
    ).toContain("动能定理");
    expect(
      timelineSpec.toSearchText({
        title: "年表",
        events: [{ date: "前221", title: "秦统一", significance: "结束分裂" }]
      })
    ).toBe("年表\n前221\n秦统一\n结束分裂");
  });
});

describe("subject kit content specs (M-C — the remaining 8 types)", () => {
  it("registers all 8 M-C content types into the core registry via installServerKits", () => {
    for (const t of MC_TYPES) expect(getNoteContentSpec(t), `missing spec ${t}`).toBeTruthy();
  });

  it("all 11 specs are exported from subjectContentSpecs (server + client single source)", () => {
    const ids = subjectContentSpecs.map((s) => s.contentType);
    expect(ids).toEqual(expect.arrayContaining([...TYPES, ...MC_TYPES]));
    expect(new Set(ids).size).toBe(ids.length); // no dup
  });

  it("each createDefault round-trips through its own schema", () => {
    for (const spec of [
      derivationSpec,
      theoremSpec,
      grammarSpec,
      excerptSpec,
      argumentSpec,
      figureSpec,
      causeEffectSpec,
      experimentSpec
    ]) {
      expect(() => spec.schema.parse(spec.createDefault()), spec.contentType).not.toThrow();
    }
  });

  it("derivation: title + steps required; steps carry expr (+ optional rationale)", () => {
    expect(() =>
      parseNoteContent("subject.derivation", {
        title: "动能定理推导",
        goal: "由功推出 E_k",
        steps: [{ expr: "W = F s", rationale: "功的定义" }, { expr: "W = \\frac{1}{2} m v^2" }],
        result: "E_k = \\frac{1}{2} m v^2"
      })
    ).not.toThrow();
    expect(() => parseNoteContent("subject.derivation", { title: "T" })).toThrow(); // steps required
    expect(() => parseNoteContent("subject.derivation", { title: "T", steps: [{ rationale: "no expr" }] })).toThrow();
  });

  it("theorem: name + statement required; conditions/proof/examples optional", () => {
    expect(() =>
      parseNoteContent("subject.theorem", {
        name: "勾股定理",
        statement: "a^2 + b^2 = c^2",
        conditions: ["直角三角形"],
        proof: "面积法",
        examples: ["3-4-5"]
      })
    ).not.toThrow();
    expect(() => parseNoteContent("subject.theorem", { name: "x" })).toThrow(); // statement required
    expect(() => parseNoteContent("subject.theorem", { statement: "x" })).toThrow(); // name required
  });

  it("grammar: pattern + meaning + examples required; examples need a sentence", () => {
    expect(() =>
      parseNoteContent("subject.grammar", {
        pattern: "would rather + 动词原形",
        meaning: "宁愿",
        structure: "would rather + do",
        examples: [{ sentence: "I would rather stay.", note: "原形" }],
        pitfalls: ["不加 to"]
      })
    ).not.toThrow();
    expect(() => parseNoteContent("subject.grammar", { pattern: "p", meaning: "m" })).toThrow(); // examples required
    expect(() =>
      parseNoteContent("subject.grammar", { pattern: "p", meaning: "m", examples: [{ note: "no sentence" }] })
    ).toThrow();
  });

  it("excerpt: quote + comment required; author/work/devices/theme optional", () => {
    expect(() =>
      parseNoteContent("subject.excerpt", {
        quote: "落霞与孤鹜齐飞",
        author: "王勃",
        work: "滕王阁序",
        comment: "对偶工整",
        devices: ["对偶"],
        theme: "壮美"
      })
    ).not.toThrow();
    expect(() => parseNoteContent("subject.excerpt", { quote: "q" })).toThrow(); // comment required
    expect(() => parseNoteContent("subject.excerpt", { comment: "c" })).toThrow(); // quote required
  });

  it("argument: claim + grounds required (grounds may be []); rest optional", () => {
    expect(() =>
      parseNoteContent("subject.argument", {
        claim: "科技扩大差距",
        grounds: ["资源集中"],
        warrant: "获取不平等放大差距",
        evidence: ["完成率差异"],
        counter: ["理论人人可用"],
        conclusion: "需政策配套"
      })
    ).not.toThrow();
    expect(() => parseNoteContent("subject.argument", { claim: "c", grounds: [] })).not.toThrow();
    expect(() => parseNoteContent("subject.argument", { claim: "c" })).toThrow(); // grounds required
  });

  it("figure: name + facts required; relations need name + relation", () => {
    expect(() =>
      parseNoteContent("subject.figure", {
        name: "商鞅",
        era: "战国",
        role: "改革家",
        facts: ["主持变法"],
        works: ["商君书"],
        significance: "奠定统一基础",
        relations: [{ name: "秦孝公", relation: "君主" }]
      })
    ).not.toThrow();
    expect(() => parseNoteContent("subject.figure", { name: "x" })).toThrow(); // facts required
    expect(() =>
      parseNoteContent("subject.figure", { name: "x", facts: [], relations: [{ name: "y" }] })
    ).toThrow(); // relation missing
  });

  it("cause-effect: title + event + causes + effects required; effect.term is 短期|长期", () => {
    expect(() =>
      parseNoteContent("subject.cause-effect", {
        title: "商鞅变法",
        event: "商鞅变法",
        causes: [{ factor: "国力落后", category: "政治" }],
        effects: [{ outcome: "国力上升", term: "短期" }, { outcome: "为统一奠基", term: "长期" }]
      })
    ).not.toThrow();
    expect(() => parseNoteContent("subject.cause-effect", { title: "t", event: "e", causes: [] })).toThrow(); // effects required
    expect(() =>
      parseNoteContent("subject.cause-effect", {
        title: "t",
        event: "e",
        causes: [{ factor: "f" }],
        effects: [{ outcome: "o", term: "中期" }] // invalid enum
      })
    ).toThrow();
  });

  it("experiment: title + purpose + procedure required; rest optional", () => {
    expect(() =>
      parseNoteContent("subject.experiment", {
        title: "测密度",
        purpose: "测定密度",
        materials: ["天平", "量筒"],
        procedure: ["称质量", "测体积"],
        observations: ["水面上升"],
        conclusion: "ρ = m/V",
        safety: ["小心量筒"]
      })
    ).not.toThrow();
    expect(() => parseNoteContent("subject.experiment", { title: "t", purpose: "p" })).toThrow(); // procedure required
    expect(() => parseNoteContent("subject.experiment", { title: "t", procedure: ["s"] })).toThrow(); // purpose required
  });

  it("reduces M-C content to searchable text without structural noise", () => {
    expect(
      excerptSpec.toSearchText({ quote: "落霞与孤鹜齐飞", author: "王勃", work: "滕王阁序", comment: "对偶", devices: ["对偶"] })
    ).toBe("落霞与孤鹜齐飞\n王勃\n滕王阁序\n对偶\n对偶");
    expect(
      argumentSpec.toSearchText({ claim: "论点", grounds: ["论据一", "论据二"], conclusion: "结论" })
    ).toBe("论点\n论据一\n论据二\n结论");
    expect(
      causeEffectSpec.toSearchText({
        title: "链",
        event: "事件",
        causes: [{ factor: "起因" }],
        effects: [{ outcome: "结果", term: "长期" }]
      })
    ).toBe("链\n事件\n起因\n结果\n长期");
  });
});

describe("subject prompt pack — deterministic, schema-valid mocks (the offline/e2e contract)", () => {
  it("every prompt's mockContent validates against its outputType's registered schema", () => {
    for (const prompt of subjectPrompts) {
      const mock = prompt.mockContent?.({ anchorText: "范例段落 example passage" });
      expect(mock, `${prompt.id} needs a mockContent`).toBeTruthy();
      expect(() => parseNoteContent(prompt.outputType, mock), `${prompt.id} mock must validate`).not.toThrow();
    }
  });

  it("build() embeds the passage and the doc-prescribed instruction", () => {
    const vocab = subjectPrompts.find((p) => p.id === "subject.generate-vocab")!;
    expect(vocab.build({ anchorText: "serendipity" })).toContain("serendipity");
    expect(vocab.build({ anchorText: "w" })).toMatch(/synonyms/i);
    const formula = subjectPrompts.find((p) => p.id === "subject.generate-formula")!;
    expect(formula.build({ anchorText: "动能" })).toMatch(/LaTeX/);
    expect(formula.build({ anchorText: "动能" })).toMatch(/SI unit/i);
    const timeline = subjectPrompts.find((p) => p.id === "subject.generate-timeline")!;
    expect(timeline.build({ anchorText: "战国" })).toMatch(/chronological/i);
  });

  it("M-C build() embeds the passage + the doc-prescribed instruction, one prompt per type", () => {
    const byOutput = (t: string) => subjectPrompts.find((p) => p.outputType === t)!;
    for (const t of MC_TYPES) {
      const prompt = byOutput(t);
      expect(prompt, `${t} needs a prompt`).toBeTruthy();
      expect(prompt.build({ anchorText: "范例段落 SENTINEL" }), t).toContain("SENTINEL");
    }
    expect(byOutput("subject.derivation").build({ anchorText: "x" })).toMatch(/derivation/i);
    expect(byOutput("subject.theorem").build({ anchorText: "x" })).toMatch(/theorem/i);
    expect(byOutput("subject.grammar").build({ anchorText: "x" })).toMatch(/grammar pattern/i);
    expect(byOutput("subject.excerpt").build({ anchorText: "x" })).toMatch(/修辞手法/);
    expect(byOutput("subject.argument").build({ anchorText: "x" })).toMatch(/claim/i);
    expect(byOutput("subject.figure").build({ anchorText: "x" })).toMatch(/figure/i);
    expect(byOutput("subject.cause-effect").build({ anchorText: "x" })).toMatch(/短期|长期/);
    expect(byOutput("subject.experiment").build({ anchorText: "x" })).toMatch(/procedure/i);
  });
});
