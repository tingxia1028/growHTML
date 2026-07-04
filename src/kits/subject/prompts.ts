// Subject kit prompt pack (React-free — the server registers these like the textbook
// prompts). One KitPrompt per M-B exemplar type, wording per subject-kits.md PART 1.
// Every mockContent is deterministic + schema-valid so offline/e2e runs are stable and
// the generation preview always has something to render.

import type { KitPrompt } from "../types";
import type {
  ArgumentContent,
  CauseEffectContent,
  DerivationContent,
  ExcerptContent,
  ExperimentContent,
  FigureContent,
  FormulaContent,
  GrammarContent,
  TheoremContent,
  TimelineContent,
  VocabContent
} from "./contentTypes";

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

// ═══════════════════════════════════════════════════════════════════════════
// M-C prompts — one KitPrompt per remaining type (subject-kits.md §1.2–1.11),
// each with a deterministic, schema-valid mockContent.
// ═══════════════════════════════════════════════════════════════════════════

// —— 推导步骤 (doc §1.2) ————————————————————————————————————————————————————————
export const generateDerivationPrompt: KitPrompt<AnchorInput & { subject?: string }> = {
  id: "subject.generate-derivation",
  outputType: "subject.derivation",
  params: [{ name: "subject", label: "学科", kind: "text" }],
  build: (input) =>
    [
      `You are a ${input.subject ?? "math"} tutor.`,
      "Produce the step-by-step derivation reaching the goal in the passage.",
      "Return a JSON object with: title, goal (what we derive), steps[] —",
      "{ expr (one LaTeX expression), rationale (a short why) } — and result (the final",
      "LaTeX expression). Keep each step to a single expression.",
      "",
      "Passage:",
      input.anchorText ?? ""
    ].join("\n"),
  mockContent: (input): DerivationContent => ({
    title: snippet(input.anchorText, 24) || "推导",
    goal: "由功的定义推出动能定理",
    steps: [
      { expr: "W = F \\cdot s", rationale: "功 = 力 × 位移" },
      { expr: "F = m a", rationale: "牛顿第二定律" },
      { expr: "W = m a s = \\frac{1}{2} m v^2", rationale: "结合匀加速运动学公式" }
    ],
    result: "E_k = \\frac{1}{2} m v^2"
  })
};

// —— 定理卡 (doc §1.3) ——————————————————————————————————————————————————————————
export const generateTheoremPrompt: KitPrompt<AnchorInput & { subject?: string }> = {
  id: "subject.generate-theorem",
  outputType: "subject.theorem",
  params: [{ name: "subject", label: "学科", kind: "text" }],
  build: (input) =>
    [
      `You are a ${input.subject ?? "math"} tutor.`,
      "State the theorem in the passage, its preconditions, an optional proof sketch,",
      "and 1–2 worked uses.",
      "Return a JSON object with: name, statement (LaTeX-aware), conditions[],",
      "proof (a short sketch), usage, examples[].",
      "",
      "Passage:",
      input.anchorText ?? ""
    ].join("\n"),
  mockContent: (input): TheoremContent => ({
    name: snippet(input.anchorText, 24) || "勾股定理",
    statement: "a^2 + b^2 = c^2",
    conditions: ["直角三角形", "c 为斜边"],
    proof: "以斜边为边作正方形,四个全等直角三角形拼合即得。",
    usage: "已知两边求第三边,或判定直角。",
    examples: ["3-4-5 三角形", "5-12-13 三角形"]
  })
};

// —— 语法点 (doc §1.5) ——————————————————————————————————————————————————————————
export const generateGrammarPrompt: KitPrompt<AnchorInput & { language?: string }> = {
  id: "subject.generate-grammar",
  outputType: "subject.grammar",
  params: [{ name: "language", label: "讲解语言", kind: "language" }],
  build: (input) =>
    [
      "You are a language tutor. Describe the grammar pattern in the passage:",
      `explain in ${input.language ?? "中文"}.`,
      "Return a JSON object with: pattern (the structure), meaning, structure (a",
      "formula-like template), examples[] — { sentence, note } (2–3) — and pitfalls[]",
      "(common mistakes).",
      "",
      "Passage:",
      input.anchorText ?? ""
    ].join("\n"),
  mockContent: (input): GrammarContent => ({
    pattern: snippet(input.anchorText, 24) || "would rather + 动词原形",
    meaning: "表示宁愿做某事",
    structure: "would rather + do (+ than do)",
    examples: [
      { sentence: "I would rather stay home tonight.", note: "than 后接原形" },
      { sentence: "She would rather read than watch TV.", note: "对比两个动作" }
    ],
    pitfalls: ["would rather 后不加 to", "过去愿望用 would rather have done"]
  })
};

// —— 摘抄赏析 (doc §1.6) ————————————————————————————————————————————————————————
export const generateExcerptPrompt: KitPrompt<AnchorInput & { language?: string }> = {
  id: "subject.generate-excerpt",
  outputType: "subject.excerpt",
  params: [{ name: "language", label: "赏析语言", kind: "language" }],
  build: (input) =>
    [
      "You are a literature tutor. Given the excerpt, identify rhetorical devices",
      `(修辞手法), the theme, and write a short appreciation in ${input.language ?? "中文"}.`,
      "Return a JSON object with: quote (the excerpt), author, work, comment",
      "(the appreciation), devices[] (修辞手法), theme.",
      "",
      "Excerpt:",
      input.anchorText ?? ""
    ].join("\n"),
  mockContent: (input): ExcerptContent => ({
    quote: snippet(input.anchorText, 40) || "落霞与孤鹜齐飞,秋水共长天一色。",
    author: "王勃",
    work: "滕王阁序",
    comment: "以动衬静,色彩明丽,勾勒出秋日水天一色的壮阔意境。",
    devices: ["对偶", "动静结合"],
    theme: "自然壮美与人生感慨"
  })
};

// —— 论证结构 (doc §1.7) ————————————————————————————————————————————————————————
export const generateArgumentPrompt: KitPrompt<AnchorInput> = {
  id: "subject.generate-argument",
  outputType: "subject.argument",
  build: (input) =>
    [
      "You are a critical-reading tutor. Extract the argument in the passage:",
      "the main claim, supporting grounds, the warrant linking them, evidence,",
      "counter-arguments, and the conclusion.",
      "Return a JSON object with: claim, grounds[], warrant, evidence[], counter[],",
      "conclusion.",
      "",
      "Passage:",
      input.anchorText ?? ""
    ].join("\n"),
  mockContent: (input): ArgumentContent => ({
    claim: snippet(input.anchorText, 32) || "科技进步扩大而非缩小了教育差距",
    grounds: ["优质数字资源集中在发达地区", "使用门槛依赖家庭条件"],
    warrant: "获取渠道的不平等会放大而非弥合原有差距",
    evidence: ["城乡在线课程完成率相差显著"],
    counter: ["开放课程理论上人人可用"],
    conclusion: "需配套政策才能让技术真正促进公平"
  })
};

// —— 人物卡 (doc §1.9) ——————————————————————————————————————————————————————————
export const generateFigurePrompt: KitPrompt<AnchorInput> = {
  id: "subject.generate-figure",
  outputType: "subject.figure",
  build: (input) =>
    [
      "You are a history/literature tutor. Summarize the figure in the passage:",
      "era, role, key facts, works, significance, and notable relations.",
      "Return a JSON object with: name, era, role, facts[], works[], significance,",
      "relations[] — { name, relation }.",
      "",
      "Passage:",
      input.anchorText ?? ""
    ].join("\n"),
  mockContent: (input): FigureContent => ({
    name: snippet(input.anchorText, 20) || "商鞅",
    era: "战国",
    role: "政治家 / 改革家",
    facts: ["主持秦国变法", "奖励耕战", "推行郡县制雏形"],
    works: ["商君书"],
    significance: "为秦国强盛与统一奠定制度基础",
    relations: [{ name: "秦孝公", relation: "君主/支持者" }]
  })
};

// —— 因果链 (doc §1.10) —————————————————————————————————————————————————————————
export const generateCauseEffectPrompt: KitPrompt<AnchorInput> = {
  id: "subject.generate-cause-effect",
  outputType: "subject.cause-effect",
  build: (input) =>
    [
      "You are a history/geography tutor. For the central event in the passage, list",
      "contributing causes (each with a category) and resulting effects (tag each as",
      "短期 or 长期).",
      "Return a JSON object with: title, event, causes[] — { factor, category } — and",
      "effects[] — { outcome, term (短期|长期) }.",
      "",
      "Passage:",
      input.anchorText ?? ""
    ].join("\n"),
  mockContent: (input): CauseEffectContent => ({
    title: snippet(input.anchorText, 24) || "商鞅变法",
    event: "商鞅变法",
    causes: [
      { factor: "秦国国力相对落后", category: "政治" },
      { factor: "各国竞争加剧", category: "外部" }
    ],
    effects: [
      { outcome: "秦国国力迅速上升", term: "短期" },
      { outcome: "为统一六国奠定基础", term: "长期" }
    ]
  })
};

// —— 实验记录 (doc §1.11) ————————————————————————————————————————————————————————
export const generateExperimentPrompt: KitPrompt<AnchorInput & { subject?: string }> = {
  id: "subject.generate-experiment",
  outputType: "subject.experiment",
  params: [{ name: "subject", label: "学科", kind: "text" }],
  build: (input) =>
    [
      `You are a ${input.subject ?? "science"} tutor.`,
      "Structure the experiment in the passage: purpose, materials, a numbered",
      "procedure, expected observations, conclusion, and safety notes.",
      "Return a JSON object with: title, purpose, materials[], procedure[],",
      "observations[], conclusion, safety[].",
      "",
      "Passage:",
      input.anchorText ?? ""
    ].join("\n"),
  mockContent: (input): ExperimentContent => ({
    title: snippet(input.anchorText, 24) || "测量金属的密度",
    purpose: "测定一块金属的密度",
    materials: ["天平", "量筒", "金属块", "水"],
    procedure: ["用天平称量金属块的质量", "量筒装水记录初始体积", "放入金属块记录末体积并计算差值", "密度 = 质量 ÷ 体积差"],
    observations: ["水面上升,体积差即金属体积"],
    conclusion: "由 ρ = m/V 得金属密度",
    safety: ["小心量筒易碎", "金属块避免砸伤"]
  })
};

export const subjectPrompts: KitPrompt[] = [
  // M-B
  generateVocabPrompt as KitPrompt,
  generateFormulaPrompt as KitPrompt,
  generateTimelinePrompt as KitPrompt,
  // M-C
  generateDerivationPrompt as KitPrompt,
  generateTheoremPrompt as KitPrompt,
  generateGrammarPrompt as KitPrompt,
  generateExcerptPrompt as KitPrompt,
  generateArgumentPrompt as KitPrompt,
  generateFigurePrompt as KitPrompt,
  generateCauseEffectPrompt as KitPrompt,
  generateExperimentPrompt as KitPrompt
];
