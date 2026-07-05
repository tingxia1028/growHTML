// The teach-back trigger built-in (PRO-2, proactive-learning.md §2) — a spaced/scheduled
// nudge → "教一遍你今天学的" → one tap deep-links the teach-back runner (navigateShell →
// teachback.panel). Registered as a CODE built-in the same way review-push is.
//
// SHIPPED enabled:false (build-spec delta 2 — the 克制 default + a KNOWN-GAP guard):
// the core evaluator HARDCODES signals.reviewDue (evaluate.ts:139-140) with per-trigger
// caps and NO shared budget across trigger families. Enabling BOTH the review-push AND
// this teach-back trigger on the SAME reviewDue>=1 signal would DOUBLE-NUDGE the same
// due state (two cards for one thing). PRO-2 does NOT edit the core evaluator; it ships
// this trigger OFF by default (opt-in) so the wiring is validated (a manually-enabled
// trigger fires → navigate) without the double-nudge. The design-faithful fix is a
// DISTINCT `teachDue` signal ("teach what you LEARNED today", not what's DUE) in PRO-3,
// after which this trigger can enable by default without collision. See 04-decision-log.
//
// The evaluator REJECTS a disabled trigger (suppressedBy:"disabled", evaluate.ts:102), so
// while shipped-off this trigger contributes nothing to the candidate set — a fresh user
// is never auto-navigated into an empty panel (delta 3), and the empty-topic panel state
// (delta 5) covers a manual launch on a fresh vault.

import { registerBuiltInTrigger, type BuiltInTrigger } from "./registry";
import type { TriggerRecord } from "../data/entityClient";

/** Stable built-in id (a fixed valid ULID so the fire-state file keys consistently). */
export const TEACHBACK_TRIGGER_ID = "trigger_01KWQQ7TB0CK1MCNVPTVD47RXZ";

/** The daily local time the teach-back nudge checks (19:00 — an evening study nudge). */
export const TEACHBACK_AT_LOCAL_TIME = "19:00";

export const teachbackTrigger: TriggerRecord = {
  id: TEACHBACK_TRIGGER_ID,
  name: "教回提醒",
  description: "teach-back nudge — 把今天学的讲一遍 → open the teach-back runner (Feynman)",
  // 克制 (delta 2): SHIPPED OFF (opt-in). Enabling it alongside review-push would
  // double-nudge the same reviewDue state until PRO-3 adds a distinct teachDue signal.
  enabled: false,
  when: { kind: "schedule", atLocalTime: TEACHBACK_AT_LOCAL_TIME },
  actionRef: { kind: "navigate", target: "teachback.panel" },
  reason: "教一遍你今天学的 · 讲给装不懂的 AI",
  constraints: {
    dailyCap: 1,
    quietHours: { start: "22:00", end: "08:00" },
    minGapMinutes: 180,
    onlyWhenIdle: true
  }
};

export const teachbackBuiltIn: BuiltInTrigger = {
  trigger: teachbackTrigger,
  // Same arming guard as review-push: only participate once real graded history exists
  // (a fresh importer with ungraded notes isn't nagged). Moot while enabled:false, but
  // correct the moment a user opts in.
  arm: (signals) => signals.review.hasGradedHistory
};

/** Register the teach-back built-in. Called once at client startup. Idempotent. */
export function registerTeachbackTrigger(): void {
  registerBuiltInTrigger(teachbackBuiltIn);
}
