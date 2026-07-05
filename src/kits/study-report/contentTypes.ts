// Study Report Kit — the React-free content spec for the 学习报告 (study report). It
// registers into the SAME core NoteContentSpec registry the built-ins use (the iron
// law: a kit adds contentTypes, never core entities), so the API validates
// `study-report.report` note content with zero core schema changes. Mirrors
// `reviewPackSpec` (textbook-learning/contentTypes.ts) — a SOURCE-LESS (vault-level)
// generated + EDITABLE note, its shape assembled deterministically from MEM-2 digests
// + review/mistake stats + profile facts (see ./assemble).
//
// The report DECLARES NO review/mistake capability — it is a summary artifact, not a
// study item (so it never lands in the review queue or the 错题本).

import { z } from "zod";
import type { NoteContentSpec } from "../../core/notes/contentTypes";

/** The kit-prefixed contentType id — the report's home in the registry + the type the
    report.list view filters `allNotes()` to. */
export const STUDY_REPORT_CONTENT_TYPE = "study-report.report";

// A non-negative integer stat, defaulted to 0 so a partial/foreign object still parses
// (the deterministic assembler always fills every field; the default only guards a
// hand-rolled or legacy record).
const stat = z.number().int().min(0).default(0);

const studyReportSchema = z.object({
  // The window this report covers (label = 本周/本月; ISO bounds from `now`).
  period: z
    .object({
      label: z.string().default(""),
      from: z.string().default(""),
      to: z.string().default("")
    })
    .default({ label: "", from: "", to: "" }),
  // AI prose — what stood out this period (the model owns these; the assembler seeds
  // deterministic fallbacks so an offline/mock run is stable).
  highlights: z.array(z.string()).default([]),
  // 弱项: the weak review buckets (bucket name + a human detail line), hidden-fact-
  // excluded by the assembler.
  weakAreas: z
    .array(
      z.object({
        bucket: z.string().default(""),
        detail: z.string().default("")
      })
    )
    .default([]),
  // Deterministic counts (the command overwrites the AI's copy with the assembled truth
  // BEFORE Save — a schema-valid-but-wrong AI stat can never leak; see ./assemble +
  // the generate command's re-merge step).
  stats: z
    .object({
      reviewsDone: stat, // = overall.review.attempts (pass + fail; skips are not attempts)
      reviewPass: stat,
      reviewFail: stat,
      notesCreated: stat, // = overall.counts["note.create"] (includes bookmarks + the report itself)
      mistakesLogged: stat, // = contentType==="mistake" bucket's note.create count
      activeDays: stat, // active days IN the period (correct for 本周)
      streakDays: stat // the learner's GLOBAL current streak (unfiltered) — see ./assemble delta 2
    })
    .default({
      reviewsDone: 0,
      reviewPass: 0,
      reviewFail: 0,
      notesCreated: 0,
      mistakesLogged: 0,
      activeDays: 0,
      streakDays: 0
    }),
  // AI prose — concrete next actions for the coming period.
  nextSteps: z.array(z.string()).default([]),
  // AI prose — a short paragraph tying it together.
  summary: z.string().default("")
});
export type StudyReportContent = z.infer<typeof studyReportSchema>;

export const studyReportSpec: NoteContentSpec<StudyReportContent> = {
  contentType: STUDY_REPORT_CONTENT_TYPE,
  schema: studyReportSchema,
  createDefault: () => ({
    period: { label: "", from: "", to: "" },
    highlights: [],
    weakAreas: [],
    stats: {
      reviewsDone: 0,
      reviewPass: 0,
      reviewFail: 0,
      notesCreated: 0,
      mistakesLogged: 0,
      activeDays: 0,
      streakDays: 0
    },
    nextSteps: [],
    summary: ""
  }),
  toSearchText: (c) =>
    [c.summary, ...c.highlights, ...c.nextSteps, ...c.weakAreas.map((w) => w.detail)].join("\n")
  // NO review / mistake capability: a report is a summary artifact, never a study item.
};

// All Study Report Kit core specs — registered by both the server (validation) and the
// client (defaults / editors), the textbookContentSpecs precedent.
export const studyReportContentSpecs: NoteContentSpec[] = [studyReportSpec as NoteContentSpec];
