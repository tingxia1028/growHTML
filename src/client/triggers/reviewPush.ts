// The review-push built-in (PRO-1 exemplar, proactive-learning.md §1: 主动复习推动) — the
// ONE code-registered trigger PRO-1 ships. A spaced/scheduled nudge → "该复习了" → one tap
// deep-links the review runner (which self-loads its due-filtered queue). Registered as a
// built-in (CODE), exactly the way built-in operations/note-types are code while user ones
// are entities; the tick unions it with the entity-store triggers and evaluates it with the
// ONE pure evaluator.
//
// Shape: when:"schedule" at a daily review time + actionRef:"navigate"→review.panel, with
// conservative 克制 constraints (dailyCap 2, onlyWhenIdle, quiet 22:00–08:00, minGap 180).
// The `event:review-due` variant is PRO-2 (needs a memory-event hook), so PRO-1 rides
// `when:schedule` and the tick's CLIENT-computed reviewDue≥1 gate (evaluator's no-signal
// suppress) is what makes it fire only when there is actually something due.
//
// NEW-USER ARMING GUARD (build-spec delta #6): an empty/absent review-schedule.json makes
// reviewDueStats count ALL eligible notes as due (queue.test.ts:661), so a fresh importer
// with ungraded notes would be nagged day-one. The `arm` guard keeps the trigger OUT of the
// candidate set entirely until there is REAL graded history (≥1 schedule record — the
// hasGradedHistory signal the tick computes), not just imported-but-ungraded notes.

import { registerBuiltInTrigger, type BuiltInTrigger } from "./registry";
import type { TriggerRecord } from "../data/entityClient";

/** Stable built-in id (a fixed valid ULID so the fire-state file keys consistently across
    runs — a built-in is CODE, so its id is a constant, not a per-run mint). */
export const REVIEW_PUSH_TRIGGER_ID = "trigger_01KWQQ648H981MCNVPTVD47RXY";

/** The daily local time the review-push checks (07:00 — a morning study nudge). */
export const REVIEW_PUSH_AT_LOCAL_TIME = "07:00";

export const reviewPushTrigger: TriggerRecord = {
  id: REVIEW_PUSH_TRIGGER_ID,
  name: "主动复习推动",
  description: "spaced review nudge — 该复习了 → open the review runner (REV queue)",
  // 克制: a built-in ships ENABLED (it is the shipped exemplar) but every other restraint
  // stays conservative; the user can disable it once the trigger-manager UI lands (PRO-2).
  enabled: true,
  when: { kind: "schedule", atLocalTime: REVIEW_PUSH_AT_LOCAL_TIME },
  actionRef: { kind: "navigate", target: "review.panel" },
  reason: "该复习了 · 有到期的复习卡",
  constraints: {
    dailyCap: 2,
    quietHours: { start: "22:00", end: "08:00" },
    minGapMinutes: 180,
    onlyWhenIdle: true
  }
};

export const reviewPushBuiltIn: BuiltInTrigger = {
  trigger: reviewPushTrigger,
  // ARMING GUARD (delta #6): only participate once real graded history exists.
  arm: (signals) => signals.review.hasGradedHistory
};

/** Register the review-push built-in. Called once at client startup. Idempotent. */
export function registerReviewPushTrigger(): void {
  registerBuiltInTrigger(reviewPushBuiltIn);
}
