// The proactive TICK (PRO-1, CLIENT-CENTRIC) — the client-side loop that, while the app
// is open, evaluates every trigger (the code-registered built-ins ∪ the entity-store user
// definitions) against the REAL LOCAL clock and surfaces a nudge for the first fireable
// one. This is the "who ticks" the build-spec moved server→client: the pure CORE evaluator
// (src/core/trigger/evaluate.ts) is called HERE with an injected local ctx (delta #1); the
// due signal is CLIENT-computed via reviewDueStats (delta #3); the fire is recorded
// ON SURFACE (delta #2) via the raw-JSON fire route.
//
// Determinism: runProactiveTick takes an injected clock + io seam, so the jsdom tests
// drive it directly (no real timers/Date). startProactiveTick wires the interval + a
// focus/visibility re-tick for the live app.

import { reviewDueStats } from "../review/queue";
import { getReviewIo } from "../review/reviewIo";
import { evaluateTrigger, type TriggerEvalContext } from "../../core/trigger/evaluate";
import type { TriggerRecord, TriggerFiresState, TriggerFireState } from "../data/entityClient";
import { entityClient } from "../data/entityClient";
import { getBuiltInTriggers, isTriggerArmed } from "../triggers/registry";
import { isIdle } from "./idleSignal";
import { localClockFrom, type LocalClock } from "./localClock";
import { pushNudge } from "./nudgeStore";

// The tick's data edges behind ONE swappable seam (the reviewIo idiom) so jsdom tests
// stub the network without touching global fetch.
export type ProactiveTickIo = {
  /** The entity-store trigger definitions (user triggers; none seeded in PRO-1). */
  fetchTriggers(): Promise<TriggerRecord[]>;
  /** The whole fire-state document (arms each trigger's restraint ctx). */
  fetchFires(): Promise<TriggerFiresState>;
  /** Record a SURFACED nudge (fire-on-surface, delta #2). */
  recordFire(triggerId: string, input: { localDayKey: string; firedAt: number }): Promise<void>;
  /** The client-computed review-due count (delta #3 — reviewDueStats stays client-side). */
  computeReviewDue(): Promise<{ due: number; hasGradedHistory: boolean }>;
};

const EMPTY_FIRE_STATE: TriggerFireState = { firedByDay: {} };

// Client-computed due signal (delta #3): the SAME primitives ReviewPanel uses — notes +
// the review-schedule doc → reviewDueStats. `hasGradedHistory` is the NEW-USER ARMING
// GUARD input (delta #6): an empty/absent schedule makes reviewDueStats count ALL eligible
// notes as due (queue.test.ts:661), so a fresh importer would be nagged day-one; we treat
// "≥1 schedule record" as real graded history and let the built-in's arming gate use it.
async function computeReviewDueViaIo(): Promise<{ due: number; hasGradedHistory: boolean }> {
  try {
    const io = getReviewIo();
    const [notes, schedule] = await Promise.all([io.fetchAllNotes(), io.fetchSchedule()]);
    const stats = reviewDueStats(notes, schedule, new Date().toISOString());
    return { due: stats.due, hasGradedHistory: Object.keys(schedule).length > 0 };
  } catch {
    // Degrade like review itself: no signal rather than a wrong nudge.
    return { due: 0, hasGradedHistory: false };
  }
}

export const defaultTickIo: ProactiveTickIo = {
  fetchTriggers: async () => {
    try {
      return (await entityClient.triggers()).triggers;
    } catch {
      return [];
    }
  },
  fetchFires: async () => {
    try {
      return (await entityClient.triggerFires()).fires;
    } catch {
      return {};
    }
  },
  recordFire: async (triggerId, input) => {
    try {
      await entityClient.recordTriggerFire(triggerId, input);
    } catch {
      // A lost fire-record only risks one extra nudge later — never block the surface.
    }
  },
  computeReviewDue: computeReviewDueViaIo
};

let io: ProactiveTickIo = defaultTickIo;
/** Test seam: override any subset of the tick IO edges (null restores the real ones). */
export function setProactiveTickIoForTests(next: Partial<ProactiveTickIo> | null): void {
  io = next ? { ...defaultTickIo, ...next } : defaultTickIo;
}

/** Build the per-trigger restraint ctx from its fire state + the local clock + signals. */
function contextFor(
  fireState: TriggerFireState,
  clock: LocalClock,
  signals: { reviewDue: number }
): TriggerEvalContext {
  return {
    nowMs: clock.nowMs,
    localHhmm: clock.localHhmm,
    localDayKey: clock.localDayKey,
    lastFiredAt: fireState.lastFiredAt,
    // firedTodayCount is scoped to TODAY's local day (delta #1) — the cap resets at the
    // rollover for free because a new localDayKey has no bucket yet.
    firedTodayCount: fireState.firedByDay[clock.localDayKey] ?? 0,
    snoozedUntil: fireState.snoozedUntil,
    signals,
    isIdle: isIdle()
  };
}

/**
 * Run ONE proactive tick. Reads triggers (built-ins ∪ entity) + fire state + the
 * client-computed due signal, builds the local clock ctx, runs the pure evaluator per
 * trigger, and for the FIRST fireable trigger: pushes a pending nudge (deduped/TTL'd in
 * the store) AND records the fire on surface (delta #2). Returns the surfaced nudge's
 * triggerId, or null if nothing fired. Injectable clock so tests are deterministic.
 */
export async function runProactiveTick(opts?: { now?: Date }): Promise<string | null> {
  const clock = localClockFrom(opts?.now ?? new Date());
  const [userTriggers, fires, review] = await Promise.all([io.fetchTriggers(), io.fetchFires(), io.computeReviewDue()]);
  const signals = { reviewDue: review.due };

  // Built-ins first (the PRO-1 exemplar), then user entity triggers. A built-in may carry
  // an ARMING GUARD (delta #6) — it only participates when its guard passes.
  const builtIns = getBuiltInTriggers().filter((entry) => isTriggerArmed(entry, { review }));
  const candidates: TriggerRecord[] = [...builtIns.map((entry) => entry.trigger), ...userTriggers];

  for (const trigger of candidates) {
    const fireState = fires[trigger.id] ?? EMPTY_FIRE_STATE;
    const result = evaluateTrigger(trigger, contextFor(fireState, clock, signals));
    if (!result.fire) continue;
    // Surface ONE nudge per tick. The store de-dupes a same-day re-push, so a lost/late
    // fire-record can't produce a second toast for the same trigger today.
    const target = trigger.actionRef.kind === "navigate" ? trigger.actionRef.target : "";
    const shown = pushNudge(
      { triggerId: trigger.id, reason: result.reason, target, localDayKey: clock.localDayKey },
      clock.localDayKey
    );
    if (shown) {
      // fire-on-surface (delta #2): record the surface with the client's clock.
      await io.recordFire(trigger.id, { localDayKey: clock.localDayKey, firedAt: clock.nowMs });
      return trigger.id;
    }
  }
  return null;
}

/** How often the live app ticks (60s, plus an immediate tick + focus/visibility re-tick). */
export const TICK_INTERVAL_MS = 60_000;

/**
 * Start the live tick loop: an immediate tick, then every TICK_INTERVAL_MS, plus a re-tick
 * on window focus / visibility change (cheap, and the moment a user returns is exactly when
 * an idle-gated nudge should re-evaluate). Returns a teardown. No-op outside a DOM.
 */
export function startProactiveTick(): () => void {
  if (typeof window === "undefined") return () => {};
  const fire = () => void runProactiveTick();
  fire();
  const interval = window.setInterval(fire, TICK_INTERVAL_MS);
  const onFocus = () => fire();
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onFocus);
  return () => {
    window.clearInterval(interval);
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onFocus);
  };
}
