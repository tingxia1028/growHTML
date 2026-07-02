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

// All M-B subject specs — registered by the server (validation) and the client
// (defaults / editors) from the same list, keeping content-shape definition in one place.
export const subjectContentSpecs: NoteContentSpec[] = [
  vocabSpec as NoteContentSpec,
  formulaSpec as NoteContentSpec,
  timelineSpec as NoteContentSpec
];
