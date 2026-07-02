// Subject kit prompt pack (React-free — the server registers these like the textbook
// prompts). One KitPrompt per M-B exemplar type, wording per subject-kits.md PART 1.
// Every mockContent is deterministic + schema-valid so offline/e2e runs are stable and
// the generation preview always has something to render.

import type { KitPrompt } from "../types";
import type { FormulaContent, TimelineContent, VocabContent } from "./contentTypes";

type AnchorInput = { anchorText?: string };

const snippet = (text: string | undefined, n = 40) => {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  return clean.length > n ? `${clean.slice(0, n)}…` : clean;
};

// —— 生词卡 (doc §1.4: phonetic, POS, 1–3 senses w/ examples, synonyms/antonyms) ————
export const generateVocabPrompt: KitPrompt<AnchorInput & { language?: string }> = {
  id: "subject.generate-vocab",
  outputType: "subject.vocab",
  params: [{ name: "language", label: "释义语言", kind: "language" }],
  build: (input) =>
    [
      "You are a vocabulary tutor. For the selected word or phrase, produce a vocab card.",
      `Gloss definitions in ${input.language ?? "中文"}.`,
      "Return a JSON object with: word, phonetic (IPA), pos (part of speech),",
      "senses[] — 1–3 entries of { definition, example (a natural sentence) } —",
      "plus synonyms[] and antonyms[] when they exist. Stay faithful to the passage's sense.",
      "",
      "Word / passage:",
      input.anchorText ?? ""
    ].join("\n"),
  mockContent: (input): VocabContent => ({
    word: snippet(input.anchorText, 24) || "example",
    phonetic: "/ɪɡˈzɑːmpəl/",
    pos: "n.",
    senses: [
      { definition: "例子;实例 — a thing characteristic of its kind.", example: "This card is an example." },
      { definition: "榜样 — a person or pattern to be imitated.", example: "She set an example for us." }
    ],
    synonyms: ["instance", "sample"],
    antonyms: []
  })
};

// —— 公式卡 (doc §1.1: LaTeX + variable legend w/ SI units + one-line usage) ————————
export const generateFormulaPrompt: KitPrompt<AnchorInput & { grade?: string; subject?: string }> = {
  id: "subject.generate-formula",
  outputType: "subject.formula",
  params: [
    { name: "grade", label: "学段/年级", kind: "grade" },
    { name: "subject", label: "学科", kind: "text" }
  ],
  build: (input) =>
    [
      `You are a ${input.subject ?? "math/science"} tutor for ${input.grade ?? "secondary-school"} students.`,
      "Extract the passage's formula as LaTeX. List each variable with its meaning and SI unit.",
      "Add a one-line usage note (when to reach for this formula).",
      "Return a JSON object with: latex (the formula, LaTeX), name (its common name),",
      "variables[] — { symbol, meaning, unit } — and usage.",
      "",
      "Passage:",
      input.anchorText ?? ""
    ].join("\n"),
  mockContent: (): FormulaContent => ({
    latex: "E_k = \\frac{1}{2} m v^2",
    name: "动能定理",
    variables: [
      { symbol: "E_k", meaning: "动能", unit: "J" },
      { symbol: "m", meaning: "质量", unit: "kg" },
      { symbol: "v", meaning: "速度", unit: "m/s" }
    ],
    usage: "由做功计算速度变化,或由速度求动能。"
  })
};

// —— 时间线 (doc §1.8: chronological events as {date,title,detail,significance}) ————
export const generateTimelinePrompt: KitPrompt<AnchorInput> = {
  id: "subject.generate-timeline",
  outputType: "subject.timeline",
  build: (input) =>
    [
      "You are a history/geography tutor. List the chronological events in the passage.",
      "Return a JSON object with: title (what the timeline covers) and events[] —",
      "{ date, title, detail, significance } — ordered earliest first. Keep dates as",
      "they appear in the passage (公元前/年 forms are fine).",
      "",
      "Passage:",
      input.anchorText ?? ""
    ].join("\n"),
  mockContent: (input): TimelineContent => ({
    title: snippet(input.anchorText, 24) || "时间线",
    events: [
      { date: "前356", title: "商鞅变法", significance: "秦国国力上升" },
      { date: "前221", title: "秦统一六国", detail: "建立中央集权", significance: "结束分裂局面" }
    ]
  })
};

export const subjectPrompts: KitPrompt[] = [
  generateVocabPrompt as KitPrompt,
  generateFormulaPrompt as KitPrompt,
  generateTimelinePrompt as KitPrompt
];
