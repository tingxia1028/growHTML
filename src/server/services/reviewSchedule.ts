// server-only — REV-3 review schedule persistence (review-loop.md §4 "SRS policy
// option"). The DURABLE half of the scheduler: per-note SM-2 records in ONE small
// vault JSON (the memory-settings.json / operation-prefs.json idiom), because the
// raw note.review event stream is COMPACTED after 14 days (memory.ts §2) and can
// never carry a 30-day interval. All math is the pure core engine
// (src/core/review/schedule.ts); this file only reads/writes the document and
// stamps the clock (injectable — tests and the e2e harness pin grade times via the
// optional `at`, the memory-events `ts` idiom).
//
// Transport-agnostic service functions in the X0b shape ((deps, input) → data): the
// express routes in app.ts and the electron direct adapter
// (services/directTransport.ts) wrap the SAME functions + zod schema.
//
// Zero migration by construction: absent/corrupt file ⇒ {} ⇒ every note "due now"
// (exactly the pre-REV-3 queue); the first pass/fail grade materializes a row.

import path from "node:path";
import { z } from "zod";
import {
  applyReviewOutcome,
  reviewScheduleStateSchema,
  type ReviewScheduleRecord,
  type ReviewScheduleState
} from "../../core/review/schedule";
import { isoDateTimeSchema } from "../../core/schema";
import type { StudyVault } from "../../core/vault";

export const REVIEW_SCHEDULE_FILE_NAME = "review-schedule.json";

export type ReviewScheduleDeps = {
  vault: StudyVault;
  /** Injectable wall clock for grade times (tests pin sequences). */
  now?: () => number;
};

/** POST /api/review/grade body — one grade outcome for one note. */
export const recordReviewGradeSchema = z.object({
  noteId: z.string().min(1),
  result: z.enum(["pass", "fail", "skip"]),
  /** Optional grade-time override (the memory-events `ts` idiom; e2e pins clocks). */
  at: isoDateTimeSchema.optional()
});
export type RecordReviewGradeInput = z.infer<typeof recordReviewGradeSchema>;

function schedulePathFor(vault: StudyVault): string {
  return path.join(vault.paths.studyDir, REVIEW_SCHEDULE_FILE_NAME);
}

/**
 * Read the whole schedule document. Absent file ⇒ {} (legacy vault: everything due).
 * Corrupt/invalid ⇒ {} too — schedule rows are derived-pace data, and degrading to
 * "review everything now" is the safe direction (the next grades re-materialize).
 */
export async function readReviewSchedule({ vault }: ReviewScheduleDeps): Promise<ReviewScheduleState> {
  const text = await vault.storage.readText(schedulePathFor(vault));
  if (!text) return {};
  try {
    return reviewScheduleStateSchema.parse(JSON.parse(text));
  } catch {
    return {};
  }
}

/**
 * Apply ONE grade outcome to a note's schedule row and persist. Takes the raw body
 * (parsed against the exported schema — one validation source of truth with the
 * direct adapter). `skip` is not a grade: nothing is written, and the current row
 * (or null) is echoed back. Returns the row the caller should display as
 * "next due" — the panel shows it verbatim after grading.
 */
export async function recordReviewGrade(
  deps: ReviewScheduleDeps,
  body: unknown
): Promise<{ noteId: string; schedule: ReviewScheduleRecord | null }> {
  const { vault } = deps;
  const clock = deps.now ?? (() => Date.now());
  const input = recordReviewGradeSchema.parse(body);
  const state = await readReviewSchedule(deps);
  const previous = state[input.noteId];
  const at = input.at ?? new Date(clock()).toISOString();
  const next = applyReviewOutcome(previous, input.result, at);
  if (next === previous) return { noteId: input.noteId, schedule: previous ?? null }; // skip ⇒ no write
  const written: ReviewScheduleState = { ...state, [input.noteId]: next as ReviewScheduleRecord };
  await vault.storage.writeTextAtomic(schedulePathFor(vault), `${JSON.stringify(written, null, 2)}\n`);
  return { noteId: input.noteId, schedule: next as ReviewScheduleRecord };
}
