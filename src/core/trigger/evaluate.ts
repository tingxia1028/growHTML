// The pure trigger evaluator (PRO-1, proactive-learning §1) — the ONE restraint gate.
// Given a trigger DEFINITION + an injected evaluation context, decide whether the client
// should SURFACE a nudge right now. PURE: no timers, no `Date`, no I/O. Every time-local
// quantity (nowMs, localHhmm, localDayKey) is COMPUTED CLIENT-SIDE and injected
// (build-spec delta #1: the codebase is 100% UTC epoch — there is no server local-time
// machinery, and quiet-hours / a per-local-day cap / a day rollover are inherently the
// USER's wall clock, which only the client owns).
//
// FIRE-ON-SURFACE (build-spec delta #2): `lastFiredAt` / `firedTodayCount` describe what
// the user has already SEEN today for THIS trigger — the caller records them when it
// surfaces a nudge, and scopes `firedTodayCount` to the CURRENT localDayKey (so the count
// resets for free at the local day rollover; no date math needed here).
//
// PRO-1 TRIM (build-spec delta #5): only `when:"schedule"` + `actionRef:"navigate"` fire.
// `when:"event"` (needs an unbuilt memory-event hook) and `actionRef:"operation"` (needs a
// focus-carrying host — cannot run headless) are DEFINED in the schema for PRO-2 but here
// return { fire:false, suppressedBy:"unsupported-in-pro1" }.
//
// The restraint model, in strict order (the first satisfied SUPPRESS wins so the reason is
// deterministic): enabled → unsupported-variant → snooze → dailyCap → quietHours →
// minGap → onlyWhenIdle → the schedule/signal condition itself. The "cap never exceeded"
// property holds by construction: dailyCap is checked BEFORE the condition, against a
// count the caller only ever increments on surface, scoped to the local day.

import type { TriggerActionRef, TriggerConstraints, TriggerWhen } from "../schema/trigger";

// The STRUCTURAL minimum the evaluator reads — the envelope (id/timestamps/…) is
// irrelevant to firing. Both the core TriggerRecord (from the entity store) AND the slim
// client TriggerRecord (entityClient) satisfy this, so the client tick can pass either
// without importing the full core record shape.
export type EvaluableTrigger = {
  enabled: boolean;
  when: TriggerWhen;
  actionRef: TriggerActionRef;
  reason: string;
  constraints: TriggerConstraints;
};

/** The injected evaluation context — every time-local value is CLIENT-computed. */
export type TriggerEvalContext = {
  /** Epoch millis of the local wall clock (Date.now() on the client). */
  nowMs: number;
  /** Current LOCAL time-of-day as zero-padded HH:MM (from `new Date()`, client tz). */
  localHhmm: string;
  /** Current LOCAL day key (e.g. "2026-07-05") — the per-day cap + rollover bucket. */
  localDayKey: string;
  /** Epoch millis this trigger last SURFACED a nudge (undefined = never). */
  lastFiredAt?: number;
  /** How many times THIS trigger has surfaced TODAY (caller scopes it to localDayKey). */
  firedTodayCount: number;
  /** Epoch millis until which the user snoozed this trigger (undefined = not snoozed). */
  snoozedUntil?: number;
  /** Client-computed due signals (build-spec delta #3: reviewDueStats stays client-side). */
  signals: { reviewDue?: number };
  /** Whether the user is currently idle (idleSignal: visibility + last-activity). */
  isIdle: boolean;
};

export type TriggerEvalResult =
  | { fire: true; reason: string }
  | { fire: false; suppressedBy: TriggerSuppressReason };

export type TriggerSuppressReason =
  | "disabled"
  | "unsupported-in-pro1"
  | "snoozed"
  | "daily-cap"
  | "quiet-hours"
  | "min-gap"
  | "not-idle"
  | "not-due" // the schedule time hasn't been crossed, or there is nothing to nudge about
  | "no-signal";

/** Parse a zero-padded HH:MM to minutes-since-midnight (0..1439). */
function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
}

/**
 * Is `now` inside the [start, end) local quiet window? Supports a MIDNIGHT WRAP: a
 * window like 22:00→08:00 spans midnight, so "inside" is (now ≥ start) OR (now < end);
 * a non-wrapping window (08:00→22:00) is (start ≤ now < end). Equal start==end ⇒ empty
 * (never quiet) — a degenerate window shouldn't silence everything.
 */
function inQuietHours(localHhmm: string, quiet: { start: string; end: string }): boolean {
  const now = hhmmToMinutes(localHhmm);
  const start = hhmmToMinutes(quiet.start);
  const end = hhmmToMinutes(quiet.end);
  if (start === end) return false;
  if (start < end) return now >= start && now < end;
  return now >= start || now < end; // wraps past midnight
}

/**
 * Evaluate ONE trigger against the injected context. Returns { fire, reason } when the
 * client should surface a nudge NOW, or { fire:false, suppressedBy } naming the FIRST
 * restraint that stopped it. Pure + total.
 */
export function evaluateTrigger(trigger: EvaluableTrigger, ctx: TriggerEvalContext): TriggerEvalResult {
  // 克制: a trigger family is off until the user opts in.
  if (!trigger.enabled) return { fire: false, suppressedBy: "disabled" };

  // PRO-1 trim (delta #5): only schedule+navigate is wired end-to-end. event needs a
  // memory-event hook; operation.run needs a focus host. Both are rejected here.
  if (trigger.when.kind !== "schedule" || trigger.actionRef.kind !== "navigate") {
    return { fire: false, suppressedBy: "unsupported-in-pro1" };
  }

  // Snooze wins over every other gate (the user explicitly asked for silence).
  if (ctx.snoozedUntil !== undefined && ctx.nowMs < ctx.snoozedUntil) {
    return { fire: false, suppressedBy: "snoozed" };
  }

  const c = trigger.constraints;

  // dailyCap FIRST (before the condition) so "cap never exceeded" holds by construction:
  // firedTodayCount is the caller's on-surface count for THIS localDayKey.
  if (ctx.firedTodayCount >= c.dailyCap) return { fire: false, suppressedBy: "daily-cap" };

  // Local quiet hours (midnight-wrap aware) — never nudge at night.
  if (inQuietHours(ctx.localHhmm, c.quietHours)) return { fire: false, suppressedBy: "quiet-hours" };

  // Minimum gap since the last SURFACED nudge for this trigger.
  if (ctx.lastFiredAt !== undefined && ctx.nowMs - ctx.lastFiredAt < c.minGapMinutes * 60_000) {
    return { fire: false, suppressedBy: "min-gap" };
  }

  // Only interrupt an idle user (visibility/last-activity).
  if (c.onlyWhenIdle && !ctx.isIdle) return { fire: false, suppressedBy: "not-idle" };

  // The firing CONDITION for a schedule+navigate trigger:
  //   • the local wall clock must have crossed the daily atLocalTime, AND
  //   • there must be something to nudge about (reviewDue ≥ 1 for the review target).
  // (The dailyCap already prevents a second same-day fire once one is recorded.)
  const crossed = hhmmToMinutes(ctx.localHhmm) >= hhmmToMinutes(trigger.when.atLocalTime);
  if (!crossed) return { fire: false, suppressedBy: "not-due" };

  const reviewDue = ctx.signals.reviewDue ?? 0;
  if (reviewDue < 1) return { fire: false, suppressedBy: "no-signal" };

  return { fire: true, reason: trigger.reason };
}
