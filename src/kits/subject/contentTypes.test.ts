import { describe, expect, it } from "vitest";
import { getNoteContentSpec, parseNoteContent } from "../../core/notes/contentTypes";
import { installServerKits } from "../server";
import { formulaSpec, timelineSpec, vocabSpec } from "./contentTypes";
import { subjectPrompts } from "./prompts";

// installServerKits registers the subject specs into the core registry — the same
// path the API uses for validation (kits/index.ts aggregation, M-B).
installServerKits();

const TYPES = ["subject.vocab", "subject.formula", "subject.timeline"];

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
});
