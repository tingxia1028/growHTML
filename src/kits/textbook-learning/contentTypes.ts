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

// —— Mistake Block (textbook.mistake) ————————————————————————————————————————
const mistakeSchema = z.object({
  exerciseNoteId: z.string().optional(),
  question: z.string(),
  wrongAnswer: z.string(),
  correctAnswer: z.string(),
  mistakeReason: z.string().optional(),
  correction: z.string().optional(),
  retryCount: z.number().default(0),
  mastery: z.enum(["unknown", "weak", "improving", "mastered"]).default("weak")
});
export type MistakeContent = z.infer<typeof mistakeSchema>;

export const mistakeSpec: NoteContentSpec<MistakeContent> = {
  contentType: "textbook.mistake",
  schema: mistakeSchema,
  createDefault: () => ({
    question: "",
    wrongAnswer: "",
    correctAnswer: "",
    retryCount: 0,
    mastery: "weak"
  }),
  toSearchText: (c) => [c.question, c.mistakeReason ?? "", c.correction ?? ""].join("\n")
};

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
  toSearchText: (c) => [c.title, c.summary, ...c.keyPoints, ...c.weakPoints].join("\n")
};

// All Textbook Kit core specs — registered by both the server (validation) and the
// client (defaults / editors), keeping content-shape definition in one place.
export const textbookContentSpecs: NoteContentSpec[] = [
  explanationSpec as NoteContentSpec,
  exerciseSpec as NoteContentSpec,
  mistakeSpec as NoteContentSpec,
  reviewPackSpec as NoteContentSpec
];
