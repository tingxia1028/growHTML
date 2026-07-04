// Teach-back Kit — core (React-free) content specs (PRO-2, proactive-learning.md §2:
// 教回/口语 "AI 装不懂" Feynman mode). Two NEW contentTypes register into the SAME core
// NoteContentSpec registry the built-ins use, so the API validates `teachback.*` note
// content with ZERO core schema changes (the iron law: kits add contentTypes, never
// core entities).
//
//   • teachback.summary — the wrap-up note the runner persists at session end (the
//     declared form for "what you explained well / what you dodged"). Rides the
//     adaptive-note contract: getNoteType("teachback.summary").render is the ONE path
//     the review queue / note list / preview card display it through.
//   • teachback.turn — ONE transcript turn (an AI pose/probe OR a student explanation).
//     hidden:true (machine-produced/consumed by the runner reducer — never authored from
//     the generic composer / slash palette, like the review-grade verdict shape). It is
//     a REAL type so the prompt pack can validate its structured pose/probe output and
//     the session reducer can round-trip it, but it is not a user-facing note form.
//
// NEW types are warranted: the semantics (a Feynman teach-back transcript + its wrap-up)
// are distinct from mistake (a wrong answer) and review-pack (a chapter revision pack).

import { z } from "zod";
import type { NoteContentSpec } from "../../core/notes/contentTypes";

// —— Teach-back Turn (teachback.turn, hidden) ————————————————————————————————
// role: who spoke. kind (AI turns only): whether this is the opening pose or a
// follow-up probe. text: the utterance. topic: which topic the turn belongs to (so a
// stored turn is self-describing). round: the probe round index (0 = pose, 1..N probes).
const turnSchema = z.object({
  role: z.enum(["ai", "student"]),
  kind: z.enum(["pose", "probe", "explain"]).default("explain"),
  text: z.string(),
  topic: z.string().default(""),
  round: z.number().int().min(0).default(0)
});
export type TeachbackTurnContent = z.infer<typeof turnSchema>;

export const teachbackTurnSpec: NoteContentSpec<TeachbackTurnContent> = {
  contentType: "teachback.turn",
  schema: turnSchema,
  createDefault: () => ({ role: "ai", kind: "pose", text: "", topic: "", round: 0 }),
  toSearchText: (c) => [c.topic, c.text].filter(Boolean).join("\n")
};

// —— Teach-back Summary (teachback.summary) ——————————————————————————————————
// The wrap-up note: the topic taught + what the student explained well + the gaps the
// AISTUDENT still didn't understand + a short prose summary. `transcript` keeps the
// turns so the note is a self-contained record of the session.
const summarySchema = z.object({
  topic: z.string(),
  explainedWell: z.array(z.string()).default([]),
  gaps: z.array(z.string()).default([]),
  summary: z.string().default(""),
  transcript: z.array(turnSchema).default([])
});
export type TeachbackSummaryContent = z.infer<typeof summarySchema>;

export const teachbackSummarySpec: NoteContentSpec<TeachbackSummaryContent> = {
  contentType: "teachback.summary",
  schema: summarySchema,
  createDefault: () => ({ topic: "", explainedWell: [], gaps: [], summary: "", transcript: [] }),
  toSearchText: (c) => [c.topic, c.summary, ...c.explainedWell, ...c.gaps].filter(Boolean).join("\n")
};

// Both Teach-back Kit core specs — registered by both the server (validation) and the
// client (defaults / editors), keeping content-shape definition in one place.
export const teachbackContentSpecs: NoteContentSpec[] = [
  teachbackSummarySpec as NoteContentSpec,
  teachbackTurnSpec as NoteContentSpec
];
