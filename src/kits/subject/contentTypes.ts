// Subject kits — core (React-free) content specs for the M-B exemplar types
// (docs/design/subject-kits.md PART 1 · PART 5 "exemplars first"): 生词卡 subject.vocab,
// 公式卡 subject.formula, 时间线 subject.timeline. Schemas follow the design doc
// verbatim. They register into the SAME core NoteContentSpec registry the built-ins
// use (server: src/kits/index.ts → installServerKits; client: the kit member installs),
// so the API validates `subject.*` content with zero core-schema change — the iron law.
// The remaining 8 types land in M-C the same way.

import { z } from "zod";
import type { NoteContentSpec } from "../../core/notes/contentTypes";

// —— 生词卡 subject.vocab (doc §1.4) ————————————————————————————————————————
// Flashcard-shaped: front = word (+phonetic/pos), back = senses. `srs` is RESERVED
// (carried now so no migration later); the scheduler itself stays deferred.
const vocabSenseSchema = z.object({
  definition: z.string(),
  example: z.string().optional()
});
const vocabSchema = z.object({
  word: z.string(),
  phonetic: z.string().optional(),
  pos: z.string().optional(),
  senses: z.array(vocabSenseSchema),
  synonyms: z.array(z.string()).optional(),
  antonyms: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  srs: z
    .object({
      ease: z.number().optional(),
      intervalDays: z.number().optional(),
      due: z.string().optional(), // ISO
      reps: z.number().optional()
    })
    .optional()
});
export type VocabContent = z.infer<typeof vocabSchema>;

export const vocabSpec: NoteContentSpec<VocabContent> = {
  contentType: "subject.vocab",
  schema: vocabSchema,
  // Seed one empty sense row so the editor opens with a fillable back face.
  createDefault: () => ({ word: "", senses: [{ definition: "" }] }),
  toSearchText: (c) =>
    [
      c.word,
      c.phonetic ?? "",
      ...c.senses.flatMap((s) => [s.definition, s.example ?? ""]),
      ...(c.synonyms ?? []),
      ...(c.antonyms ?? [])
    ]
      .filter(Boolean)
      .join("\n")
};

// —— 公式卡 subject.formula (doc §1.1) ———————————————————————————————————————
// A named formula + its symbol legend, linkable to a subject.derivation note (M-C).
const formulaVariableSchema = z.object({
  symbol: z.string(),
  meaning: z.string(),
  unit: z.string().optional()
});
const formulaSchema = z.object({
  latex: z.string(),
  name: z.string().optional(),
  variables: z.array(formulaVariableSchema), // required, may be []
  derivationRef: z.string().optional(), // note id of a subject.derivation
  usage: z.string().optional()
});
export type FormulaContent = z.infer<typeof formulaSchema>;

export const formulaSpec: NoteContentSpec<FormulaContent> = {
  contentType: "subject.formula",
  schema: formulaSchema,
  createDefault: () => ({ latex: "", variables: [] }),
  toSearchText: (c) =>
    [c.name ?? "", c.latex, ...c.variables.flatMap((v) => [v.symbol, v.meaning, v.unit ?? ""]), c.usage ?? ""]
      .filter(Boolean)
      .join("\n")
};

// —— 时间线 subject.timeline (doc §1.8) ——————————————————————————————————————
// Self-contained and visually distinct — the no-new-dep exemplar.
const timelineEventSchema = z.object({
  date: z.string(),
  title: z.string(),
  detail: z.string().optional(),
  significance: z.string().optional()
});
const timelineSchema = z.object({
  title: z.string(),
  events: z.array(timelineEventSchema)
});
export type TimelineContent = z.infer<typeof timelineSchema>;

export const timelineSpec: NoteContentSpec<TimelineContent> = {
  contentType: "subject.timeline",
  schema: timelineSchema,
  // Seed one empty event row so the editor opens with a fillable node.
  createDefault: () => ({ title: "", events: [{ date: "", title: "" }] }),
  toSearchText: (c) =>
    [c.title, ...c.events.flatMap((e) => [e.date, e.title, e.detail ?? "", e.significance ?? ""])]
      .filter(Boolean)
      .join("\n")
};

// ═══════════════════════════════════════════════════════════════════════════
// M-C — the remaining 8 subject content types (subject-kits.md PART 1 §1.2–1.11).
// Same shape as the M-B trio above: React-free NoteContentSpec, registered
// server (validation) + client (defaults/editors) from `subjectContentSpecs`.
// Schemas follow the design doc verbatim; required fields are non-optional zod.
// ═══════════════════════════════════════════════════════════════════════════

// —— 推导步骤 subject.derivation (doc §1.2) ————————————————————————————————————
// A goal-directed chain of LaTeX steps, each with an optional rationale; linkable
// from a subject.formula's derivationRef.
const derivationStepSchema = z.object({
  expr: z.string(), // latex
  rationale: z.string().optional()
});
const derivationSchema = z.object({
  title: z.string(),
  goal: z.string().optional(),
  steps: z.array(derivationStepSchema),
  result: z.string().optional() // latex
});
export type DerivationContent = z.infer<typeof derivationSchema>;

export const derivationSpec: NoteContentSpec<DerivationContent> = {
  contentType: "subject.derivation",
  schema: derivationSchema,
  createDefault: () => ({ title: "", steps: [{ expr: "" }] }),
  toSearchText: (c) =>
    [c.title, c.goal ?? "", ...c.steps.flatMap((s) => [s.expr, s.rationale ?? ""]), c.result ?? ""]
      .filter(Boolean)
      .join("\n")
};

// —— 定理卡 subject.theorem (doc §1.3) ——————————————————————————————————————
// A named theorem: statement (LaTeX-aware), preconditions, optional proof + uses.
const theoremSchema = z.object({
  name: z.string(),
  statement: z.string(),
  conditions: z.array(z.string()).optional(),
  proof: z.string().optional(),
  usage: z.string().optional(),
  examples: z.array(z.string()).optional()
});
export type TheoremContent = z.infer<typeof theoremSchema>;

export const theoremSpec: NoteContentSpec<TheoremContent> = {
  contentType: "subject.theorem",
  schema: theoremSchema,
  createDefault: () => ({ name: "", statement: "" }),
  toSearchText: (c) =>
    [c.name, c.statement, ...(c.conditions ?? []), c.proof ?? "", c.usage ?? "", ...(c.examples ?? [])]
      .filter(Boolean)
      .join("\n")
};

// —— 语法点 subject.grammar (doc §1.5) ——————————————————————————————————————
// A grammar pattern: meaning, structural template, examples, and pitfalls (warn).
const grammarExampleSchema = z.object({
  sentence: z.string(),
  note: z.string().optional()
});
const grammarSchema = z.object({
  pattern: z.string(),
  meaning: z.string(),
  structure: z.string().optional(),
  examples: z.array(grammarExampleSchema),
  pitfalls: z.array(z.string()).optional()
});
export type GrammarContent = z.infer<typeof grammarSchema>;

export const grammarSpec: NoteContentSpec<GrammarContent> = {
  contentType: "subject.grammar",
  schema: grammarSchema,
  createDefault: () => ({ pattern: "", meaning: "", examples: [{ sentence: "" }] }),
  toSearchText: (c) =>
    [
      c.pattern,
      c.meaning,
      c.structure ?? "",
      ...c.examples.flatMap((e) => [e.sentence, e.note ?? ""]),
      ...(c.pitfalls ?? [])
    ]
      .filter(Boolean)
      .join("\n")
};

// —— 摘抄赏析 subject.excerpt (doc §1.6) ————————————————————————————————————
// A quote with attribution + appreciation; devices = 修辞手法 chips.
const excerptSchema = z.object({
  quote: z.string(),
  author: z.string().optional(),
  work: z.string().optional(),
  comment: z.string(),
  devices: z.array(z.string()).optional(), // 修辞手法
  theme: z.string().optional()
});
export type ExcerptContent = z.infer<typeof excerptSchema>;

export const excerptSpec: NoteContentSpec<ExcerptContent> = {
  contentType: "subject.excerpt",
  schema: excerptSchema,
  createDefault: () => ({ quote: "", comment: "" }),
  toSearchText: (c) =>
    [c.quote, c.author ?? "", c.work ?? "", c.comment, ...(c.devices ?? []), c.theme ?? ""]
      .filter(Boolean)
      .join("\n")
};

// —— 论证结构 subject.argument (doc §1.7) ————————————————————————————————————
// Toulmin-style: claim ← grounds (req) ← warrant, evidence, counter, conclusion.
const argumentSchema = z.object({
  claim: z.string(),
  grounds: z.array(z.string()),
  warrant: z.string().optional(),
  evidence: z.array(z.string()).optional(),
  counter: z.array(z.string()).optional(),
  conclusion: z.string().optional()
});
export type ArgumentContent = z.infer<typeof argumentSchema>;

export const argumentSpec: NoteContentSpec<ArgumentContent> = {
  contentType: "subject.argument",
  schema: argumentSchema,
  createDefault: () => ({ claim: "", grounds: [] }),
  toSearchText: (c) =>
    [
      c.claim,
      ...c.grounds,
      c.warrant ?? "",
      ...(c.evidence ?? []),
      ...(c.counter ?? []),
      c.conclusion ?? ""
    ]
      .filter(Boolean)
      .join("\n")
};

// —— 人物卡 subject.figure (doc §1.9) ————————————————————————————————————————
// A figure fact sheet: era/role header, facts (req), works, significance, relations.
const figureRelationSchema = z.object({
  name: z.string(),
  relation: z.string()
});
const figureSchema = z.object({
  name: z.string(),
  era: z.string().optional(),
  role: z.string().optional(),
  facts: z.array(z.string()),
  works: z.array(z.string()).optional(),
  significance: z.string().optional(),
  relations: z.array(figureRelationSchema).optional()
});
export type FigureContent = z.infer<typeof figureSchema>;

export const figureSpec: NoteContentSpec<FigureContent> = {
  contentType: "subject.figure",
  schema: figureSchema,
  createDefault: () => ({ name: "", facts: [] }),
  toSearchText: (c) =>
    [
      c.name,
      c.era ?? "",
      c.role ?? "",
      ...c.facts,
      ...(c.works ?? []),
      c.significance ?? "",
      ...(c.relations ?? []).flatMap((r) => [r.name, r.relation])
    ]
      .filter(Boolean)
      .join("\n")
};

// —— 因果链 subject.cause-effect (doc §1.10) —————————————————————————————————
// causes (grouped by category) → the pivot event → effects (tagged 短期/长期).
const causeSchema = z.object({
  factor: z.string(),
  category: z.string().optional()
});
const effectSchema = z.object({
  outcome: z.string(),
  term: z.enum(["短期", "长期"]).optional()
});
const causeEffectSchema = z.object({
  title: z.string(),
  event: z.string(),
  causes: z.array(causeSchema),
  effects: z.array(effectSchema)
});
export type CauseEffectContent = z.infer<typeof causeEffectSchema>;

export const causeEffectSpec: NoteContentSpec<CauseEffectContent> = {
  contentType: "subject.cause-effect",
  schema: causeEffectSchema,
  createDefault: () => ({ title: "", event: "", causes: [], effects: [] }),
  toSearchText: (c) =>
    [
      c.title,
      c.event,
      ...c.causes.flatMap((x) => [x.factor, x.category ?? ""]),
      ...c.effects.flatMap((x) => [x.outcome, x.term ?? ""])
    ]
      .filter(Boolean)
      .join("\n")
};

// —— 实验记录 subject.experiment (doc §1.11) ————————————————————————————————
// purpose (req) · materials · numbered procedure (req) · observations · conclusion · safety (warn).
const experimentSchema = z.object({
  title: z.string(),
  purpose: z.string(),
  materials: z.array(z.string()).optional(),
  procedure: z.array(z.string()),
  observations: z.array(z.string()).optional(),
  conclusion: z.string().optional(),
  safety: z.array(z.string()).optional()
});
export type ExperimentContent = z.infer<typeof experimentSchema>;

export const experimentSpec: NoteContentSpec<ExperimentContent> = {
  contentType: "subject.experiment",
  schema: experimentSchema,
  createDefault: () => ({ title: "", purpose: "", procedure: [] }),
  toSearchText: (c) =>
    [
      c.title,
      c.purpose,
      ...(c.materials ?? []),
      ...c.procedure,
      ...(c.observations ?? []),
      c.conclusion ?? "",
      ...(c.safety ?? [])
    ]
      .filter(Boolean)
      .join("\n")
};

// All subject specs (M-B trio + M-C eight) — registered by the server (validation)
// and the client (defaults / editors) from the same list, keeping content-shape
// definition in one place.
export const subjectContentSpecs: NoteContentSpec[] = [
  // M-B
  vocabSpec as NoteContentSpec,
  formulaSpec as NoteContentSpec,
  timelineSpec as NoteContentSpec,
  // M-C
  derivationSpec as NoteContentSpec,
  theoremSpec as NoteContentSpec,
  grammarSpec as NoteContentSpec,
  excerptSpec as NoteContentSpec,
  argumentSpec as NoteContentSpec,
  figureSpec as NoteContentSpec,
  causeEffectSpec as NoteContentSpec,
  experimentSpec as NoteContentSpec
];
