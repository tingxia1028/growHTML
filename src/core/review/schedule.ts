// Core review — REV-3 SRS scheduling (review-loop.md §4 "SRS policy option"). PURE,
// clock-injected functions: one grade outcome + the previous per-note record → the
// next record. The algorithm is SM-2-minimal over the repo's OWN grading scale
// (`pass | fail | skip` — the note.review payload enum; REV-2's AI grade maps
// correct→pass, incorrect→fail), because the loop never produces a 4-way
// again/hard/good/easy signal:
//   pass — streak+1; interval 1d → 6d → round(prev × ease), capped at 365d;
//          ease unchanged (SM-2's q=4 keeps EF flat — binary grading has no "easy").
//   fail — streak reset, ease −0.2 (floor 1.3), due NOW: a failed item returns
//          every session until passed — the SRS generalization of REV-1's literal
//          "mistake failed last time re-queues" law.
//   skip — NOT a grade: the schedule is untouched (and never materializes).
//
// Persistence note (why records, not event replay): MEM-2 consolidation PRUNES raw
// note.review events after 14 days (memory.ts §2 compaction), so any schedule
// derived by replaying the event stream would collapse past two weeks. The durable
// record is a tiny per-note row in the vault's review-schedule.json
// (src/server/services/reviewSchedule.ts — the memory-settings.json idiom).
// Schema-additive: an absent file / absent row means "due now" — legacy vaults need
// zero migration, and the first grade materializes the row.

import { z } from "zod";
import { isoDateTimeSchema } from "../schema";

/** The grading scale — identical to the note.review payload result enum. */
export type ReviewOutcome = "pass" | "fail" | "skip";

export const REVIEW_INITIAL_EASE = 2.5;
export const REVIEW_MIN_EASE = 1.3;
/** Ease penalty per fail (SM-2's q=2 step, simplified to one constant). */
export const REVIEW_EASE_FAIL_STEP = 0.2;
export const REVIEW_FIRST_INTERVAL_DAYS = 1;
export const REVIEW_SECOND_INTERVAL_DAYS = 6;
/** Interval ceiling — a local study vault has no use for multi-year gaps. */
export const REVIEW_MAX_INTERVAL_DAYS = 365;

const DAY_MS = 86_400_000;

/** One per-note schedule row (the review-schedule.json value shape). */
export const reviewScheduleRecordSchema = z.object({
  /** When the note is next due (ISO). due ≤ now ⇒ queue-eligible. */
  due: isoDateTimeSchema,
  /** The interval that produced `due` (0 after a fail — due immediately). */
  intervalDays: z.number().min(0),
  /** SM-2 ease factor; only fails move it (down, floored at REVIEW_MIN_EASE). */
  ease: z.number().min(1),
  /** Consecutive passes since the last fail (drives the 1d/6d/×ease ladder). */
  streak: z.number().int().min(0),
  /** Total graded reviews (pass+fail; skips never count). */
  reviews: z.number().int().min(0),
  /** Total fails — the classic lapse counter, kept for future policy/UX. */
  lapses: z.number().int().min(0),
  lastReviewedAt: isoDateTimeSchema,
  lastResult: z.enum(["pass", "fail"])
});
export type ReviewScheduleRecord = z.infer<typeof reviewScheduleRecordSchema>;

/** The whole document: noteId → record. Absent note ⇒ never graded ⇒ due now. */
export const reviewScheduleStateSchema = z.record(z.string(), reviewScheduleRecordSchema);
export type ReviewScheduleState = z.infer<typeof reviewScheduleStateSchema>;

const round2 = (value: number): number => Math.round(value * 100) / 100;

const addDays = (nowIso: string, days: number): string =>
  new Date(Date.parse(nowIso) + days * DAY_MS).toISOString();

/**
 * The ONE transition: previous record (undefined = never graded) + outcome + the
 * injected clock → the next record. `skip` returns the input untouched (identity —
 * skipping is "didn't review", never a grade), so a skip on a never-graded note
 * materializes nothing.
 */
export function applyReviewOutcome(
  prev: ReviewScheduleRecord | undefined,
  result: ReviewOutcome,
  nowIso: string
): ReviewScheduleRecord | undefined {
  if (result === "skip") return prev;
  const ease = prev?.ease ?? REVIEW_INITIAL_EASE;

  if (result === "fail") {
    return {
      due: nowIso, // due immediately — back next session until it passes
      intervalDays: 0,
      ease: Math.max(REVIEW_MIN_EASE, round2(ease - REVIEW_EASE_FAIL_STEP)),
      streak: 0,
      reviews: (prev?.reviews ?? 0) + 1,
      lapses: (prev?.lapses ?? 0) + 1,
      lastReviewedAt: nowIso,
      lastResult: "fail"
    };
  }

  const streak = (prev?.streak ?? 0) + 1;
  const intervalDays =
    streak === 1
      ? REVIEW_FIRST_INTERVAL_DAYS
      : streak === 2
        ? REVIEW_SECOND_INTERVAL_DAYS
        : Math.min(
            REVIEW_MAX_INTERVAL_DAYS,
            Math.round((prev?.intervalDays ?? REVIEW_SECOND_INTERVAL_DAYS) * ease)
          );
  return {
    due: addDays(nowIso, intervalDays),
    intervalDays,
    ease, // pass keeps ease flat (see the header note)
    streak,
    reviews: (prev?.reviews ?? 0) + 1,
    lapses: prev?.lapses ?? 0,
    lastReviewedAt: nowIso,
    lastResult: "pass"
  };
}

/**
 * Due test, INCLUSIVE at the boundary (due == now ⇒ due). No record ⇒ due — the
 * zero-migration law: a legacy vault with no review-schedule.json queues everything,
 * exactly like REV-1/2 did. An unparseable due also degrades to "due" (reviewing
 * too often is safe; silently never reviewing is not).
 */
export function isDueAt(record: ReviewScheduleRecord | undefined, nowIso: string): boolean {
  if (!record) return true;
  const due = Date.parse(record.due);
  return Number.isNaN(due) || due <= Date.parse(nowIso);
}

/** Whole days from now until due, floored at 0 (overdue/now ⇒ 0). Display helper. */
export function daysUntilDue(dueIso: string, nowIso: string): number {
  const delta = Date.parse(dueIso) - Date.parse(nowIso);
  if (Number.isNaN(delta) || delta <= 0) return 0;
  return Math.ceil(delta / DAY_MS);
}
