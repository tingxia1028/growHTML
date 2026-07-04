// Textbook Learning Kit — core (React-free) content specs for the 3 MVP Study
// Block types. These register into the SAME core NoteContentSpec registry the
// built-ins use, so the API validates `textbook.*` note content with zero core
// schema changes (the iron law: kits add contentTypes, never core entities).
//
// Schemas follow the user spec §4 verbatim.

import { z } from "zod";
import type { NoteContentSpec } from "../../core/notes/contentTypes";

// —— Explanation Block (textbook.explanation) ————————————————————————————————
const explanationSchema = z.object({
  title: z.string(),
  level: z.enum(["simple", "standard", "advanced"]),
  explanation: z.string(),
  analogy: z.string().optional(),
  keyPoints: z.array(z.string()).default([]),
  commonMisunderstandings: z.array(z.string()).default([])
});
export type ExplanationContent = z.infer<typeof explanationSchema>;

export const explanationSpec: NoteContentSpec<ExplanationContent> = {
  contentType: "textbook.explanation",
  schema: explanationSchema,
  createDefault: () => ({
    title: "",
    level: "standard",
    explanation: "",
    keyPoints: [],
    commonMisunderstandings: []
  }),
  toSearchText: (c) => [c.title, c.explanation, ...c.keyPoints].join("\n")
};

// —— Exercise Block (textbook.exercise) ——————————————————————————————————————
const exerciseSchema = z.object({
  question: z.string(),
  type: z.enum(["single-choice", "multiple-choice", "fill-blank", "short-answer"]),
  options: z.array(z.string()).optional(),
  answer: z.union([z.string(), z.array(z.string())]),
  explanation: z.string(),
  difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
  relatedKnowledgePoints: z.array(z.string()).default([])
});
export type ExerciseContent = z.infer<typeof exerciseSchema>;

export const exerciseSpec: NoteContentSpec<ExerciseContent> = {
  contentType: "textbook.exercise",
  schema: exerciseSchema,
  createDefault: () => ({
    question: "",
    type: "single-choice",
    options: [],
    answer: "",
    explanation: "",
    difficulty: "medium",
    relatedKnowledgePoints: []
  }),
  toSearchText: (c) => [c.question, c.explanation].join("\n")
};

// —— Mistake Block ————————————————————————————————————————————————————————————
// REV-CORE (kit-flatten-and-core-review.md §1): 错题 is CORE now — the spec lives in
// src/core/notes/contentTypes.ts as contentType `"mistake"`, and the old persisted
// `"textbook.mistake"` id resolves to it through the registry ALIAS (zero data
// migration). Re-exported here so kit code/tests keep one import path.
export { MISTAKE_CONTENT_TYPE, mistakeSpec, type MistakeContent } from "../../core/notes/contentTypes";

// —— Review Pack (textbook.review-pack) ——————————————————————————————————————
// A chapter-level study summary synthesized from a source's Explanation + Mistake
// blocks (user spec §4). Unlike the other three it is SOURCE-level, not anchored to
// one passage — its `scope` records which source/chapter it covers.
const reviewPackSchema = z.object({
  title: z.string(),
  scope: z.object({
    sourceId: z.string(),
    chapterIds: z.array(z.string()).optional(),
    anchorIds: z.array(z.string()).optional()
  }),
  summary: z.string(),
  keyPoints: z.array(z.string()).default([]),
  weakPoints: z.array(z.string()).default([]),
  flashcards: z.array(z.object({ front: z.string(), back: z.string() })).default([]),
  exercises: z.array(z.string()).default([])
});
export type ReviewPackContent = z.infer<typeof reviewPackSchema>;

export const reviewPackSpec: NoteContentSpec<ReviewPackContent> = {
  contentType: "textbook.review-pack",
  schema: reviewPackSchema,
  createDefault: () => ({
    title: "",
    scope: { sourceId: "" },
    summary: "",
    keyPoints: [],
    weakPoints: [],
    flashcards: [],
    exercises: []
  }),
  toSearchText: (c) => [c.title, c.summary, ...c.keyPoints, ...c.weakPoints].join("\n"),
  // REV-CORE: the kit EXTENDS the core review loop by DECLARING the capability in its
  // own spec — the queue's rule 2 picks review packs up with zero core/kit imports
  // (the proof the reviewable contract works; kit-flatten-and-core-review.md §1).
  review: { reviewable: true }
};

// All Textbook Kit core specs — registered by both the server (validation) and the
// client (defaults / editors), keeping content-shape definition in one place.
// (mistake is a CORE built-in since REV-CORE — no longer defined or registered here.)
export const textbookContentSpecs: NoteContentSpec[] = [
  explanationSpec as NoteContentSpec,
  exerciseSpec as NoteContentSpec,
  reviewPackSpec as NoteContentSpec
];
