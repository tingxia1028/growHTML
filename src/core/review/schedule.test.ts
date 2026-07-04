// REV-3 scheduler — the pure SM-2-minimal transition, exhaustively: grade sequences
// → interval ladders, ease dynamics (fail-only, floored), clock-injected determinism
// (same inputs ⇒ byte-identical records), boundary dueness (inclusive), skip
// identity, the interval cap, and the zod document schema roundtrip.

import { describe, expect, it } from "vitest";
import {
  applyReviewOutcome,
  daysUntilDue,
  isDueAt,
  REVIEW_EASE_FAIL_STEP,
  REVIEW_FIRST_INTERVAL_DAYS,
  REVIEW_INITIAL_EASE,
  REVIEW_MAX_INTERVAL_DAYS,
  REVIEW_MIN_EASE,
  REVIEW_SECOND_INTERVAL_DAYS,
  reviewScheduleRecordSchema,
  reviewScheduleStateSchema,
  type ReviewScheduleRecord
} from "./schedule";

const T0 = "2026-07-01T08:00:00.000Z";
const DAY_MS = 86_400_000;
const daysAfter = (iso: string, days: number) => new Date(Date.parse(iso) + days * DAY_MS).toISOString();

/** Run a grade sequence from nothing, one grade per day, returning every state. */
function runSequence(results: ("pass" | "fail" | "skip")[], startIso = T0) {
  const states: (ReviewScheduleRecord | undefined)[] = [];
  let record: ReviewScheduleRecord | undefined;
  results.forEach((result, index) => {
    record = applyReviewOutcome(record, result, daysAfter(startIso, index));
    states.push(record);
  });
  return states;
}

describe("applyReviewOutcome — the pass ladder", () => {
  it("first pass materializes a record: 1d interval, initial ease, streak 1", () => {
    const record = applyReviewOutcome(undefined, "pass", T0)!;
    expect(record).toEqual({
      due: daysAfter(T0, REVIEW_FIRST_INTERVAL_DAYS),
      intervalDays: 1,
      ease: REVIEW_INITIAL_EASE,
      streak: 1,
      reviews: 1,
      lapses: 0,
      lastReviewedAt: T0,
      lastResult: "pass"
    });
  });

  it("pass, pass, pass → the SM-2 ladder 1d, 6d, round(6 × 2.5) = 15d", () => {
    const [first, second, third] = runSequence(["pass", "pass", "pass"]);
    expect(first!.intervalDays).toBe(REVIEW_FIRST_INTERVAL_DAYS);
    expect(second!.intervalDays).toBe(REVIEW_SECOND_INTERVAL_DAYS);
    expect(third!.intervalDays).toBe(Math.round(6 * REVIEW_INITIAL_EASE)); // 15
    expect(third!.due).toBe(daysAfter(daysAfter(T0, 2), 15));
    expect(third!.streak).toBe(3);
    expect(third!.reviews).toBe(3);
    expect(third!.lapses).toBe(0);
  });

  it("the fourth pass keeps multiplying: round(15 × 2.5) = 38d", () => {
    const states = runSequence(["pass", "pass", "pass", "pass"]);
    expect(states[3]!.intervalDays).toBe(Math.round(15 * REVIEW_INITIAL_EASE)); // 38
  });

  it("pass never moves ease (binary grading has no 'easy' bonus)", () => {
    const states = runSequence(["pass", "pass", "pass", "pass"]);
    for (const state of states) expect(state!.ease).toBe(REVIEW_INITIAL_EASE);
  });

  it("intervals cap at REVIEW_MAX_INTERVAL_DAYS", () => {
    const veteran: ReviewScheduleRecord = {
      due: T0,
      intervalDays: 300,
      ease: REVIEW_INITIAL_EASE,
      streak: 9,
      reviews: 9,
      lapses: 0,
      lastReviewedAt: T0,
      lastResult: "pass"
    };
    const next = applyReviewOutcome(veteran, "pass", T0)!;
    expect(next.intervalDays).toBe(REVIEW_MAX_INTERVAL_DAYS);
    expect(next.due).toBe(daysAfter(T0, REVIEW_MAX_INTERVAL_DAYS));
  });
});

describe("applyReviewOutcome — fail semantics", () => {
  it("a fail on a fresh note: due NOW, interval 0, ease down one step, lapse counted", () => {
    const record = applyReviewOutcome(undefined, "fail", T0)!;
    expect(record).toEqual({
      due: T0, // immediately due — back next session
      intervalDays: 0,
      ease: REVIEW_INITIAL_EASE - REVIEW_EASE_FAIL_STEP,
      streak: 0,
      reviews: 1,
      lapses: 1,
      lastReviewedAt: T0,
      lastResult: "fail"
    });
    expect(isDueAt(record, T0)).toBe(true);
  });

  it("fail resets the streak: the ladder restarts at 1d on the next pass", () => {
    const states = runSequence(["pass", "pass", "fail", "pass", "pass"]);
    expect(states[2]!.streak).toBe(0);
    expect(states[3]!.intervalDays).toBe(REVIEW_FIRST_INTERVAL_DAYS); // ladder restarted
    expect(states[4]!.intervalDays).toBe(REVIEW_SECOND_INTERVAL_DAYS);
    expect(states[4]!.lapses).toBe(1);
    expect(states[4]!.reviews).toBe(5);
  });

  it("repeated fails floor ease at REVIEW_MIN_EASE (never below)", () => {
    const states = runSequence(["fail", "fail", "fail", "fail", "fail", "fail", "fail"]);
    const eases = states.map((state) => state!.ease);
    expect(eases).toEqual([2.3, 2.1, 1.9, 1.7, 1.5, 1.3, 1.3]);
    expect(Math.min(...eases)).toBe(REVIEW_MIN_EASE);
  });

  it("a lowered ease slows regrowth after relearning: round(6 × 2.3) = 14d", () => {
    const states = runSequence(["fail", "pass", "pass", "pass"]);
    expect(states[3]!.intervalDays).toBe(Math.round(6 * 2.3)); // 14, not 15
  });
});

describe("applyReviewOutcome — skip identity", () => {
  it("skip on a never-graded note materializes NOTHING (legacy vaults stay recordless)", () => {
    expect(applyReviewOutcome(undefined, "skip", T0)).toBeUndefined();
  });

  it("skip returns the previous record untouched (same reference)", () => {
    const record = applyReviewOutcome(undefined, "pass", T0)!;
    expect(applyReviewOutcome(record, "skip", daysAfter(T0, 5))).toBe(record);
  });
});

describe("clock-injected determinism", () => {
  it("identical inputs produce byte-identical records (no hidden clock)", () => {
    const a = runSequence(["pass", "fail", "pass", "pass"]);
    const b = runSequence(["pass", "fail", "pass", "pass"]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("isDueAt — boundaries + the zero-migration law", () => {
  it("no record ⇒ due (legacy vault: everything queues on first load)", () => {
    expect(isDueAt(undefined, T0)).toBe(true);
  });

  it("due is INCLUSIVE at the boundary; one ms later is not due", () => {
    const record = applyReviewOutcome(undefined, "pass", T0)!; // due = T0 + 1d
    const due = record.due;
    expect(isDueAt(record, due)).toBe(true);
    expect(isDueAt(record, new Date(Date.parse(due) - 1).toISOString())).toBe(false);
    expect(isDueAt(record, daysAfter(due, 3))).toBe(true); // overdue stays due
  });

  it("an unparseable due degrades to DUE (over-review is safe, silence is not)", () => {
    const record = { ...applyReviewOutcome(undefined, "pass", T0)!, due: "not-a-date" };
    expect(isDueAt(record, T0)).toBe(true);
  });
});

describe("daysUntilDue — the display helper", () => {
  it("overdue / due-now ⇒ 0; future rounds UP to whole days", () => {
    expect(daysUntilDue(T0, daysAfter(T0, 2))).toBe(0);
    expect(daysUntilDue(T0, T0)).toBe(0);
    expect(daysUntilDue(daysAfter(T0, 1), T0)).toBe(1);
    expect(daysUntilDue(new Date(Date.parse(T0) + DAY_MS / 2).toISOString(), T0)).toBe(1); // half a day → "tomorrow"
    expect(daysUntilDue(daysAfter(T0, 6), T0)).toBe(6);
    expect(daysUntilDue("not-a-date", T0)).toBe(0); // degrade, never NaN
  });
});

describe("schema roundtrip — the review-schedule.json document", () => {
  it("a produced record parses through its own schema, and the state document roundtrips", () => {
    const record = applyReviewOutcome(applyReviewOutcome(undefined, "pass", T0), "fail", daysAfter(T0, 1))!;
    expect(reviewScheduleRecordSchema.parse(record)).toEqual(record);
    const state = { note_a: record, note_b: applyReviewOutcome(undefined, "pass", T0)! };
    expect(reviewScheduleStateSchema.parse(JSON.parse(JSON.stringify(state)))).toEqual(state);
  });

  it("rejects malformed rows (negative counts, unknown results, bad dates)", () => {
    const good = applyReviewOutcome(undefined, "pass", T0)!;
    expect(() => reviewScheduleRecordSchema.parse({ ...good, reviews: -1 })).toThrow();
    expect(() => reviewScheduleRecordSchema.parse({ ...good, lastResult: "skip" })).toThrow();
    expect(() => reviewScheduleRecordSchema.parse({ ...good, due: "yesterday-ish" })).toThrow();
  });
});
