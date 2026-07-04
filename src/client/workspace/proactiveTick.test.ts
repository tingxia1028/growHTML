// @vitest-environment jsdom
// The proactive tick + idle signal (PRO-1, CLIENT-CENTRIC). Drives runProactiveTick
// DIRECTLY with an INJECTED local clock (via the `now` Date) + a stubbed io seam — no real
// timers, no network. Asserts: a due signal + a fireable built-in emits a nudge AND records
// the fire on surface; within-minGap emits nothing; local quiet-hours emits nothing; and
// the idle transitions the evaluator's onlyWhenIdle gate keys on.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runProactiveTick, setProactiveTickIoForTests, type ProactiveTickIo } from "./proactiveTick";
import { getPendingNudge, resetNudgeStoreForTests } from "./nudgeStore";
import { isIdle, setIdleClock, setIdleStateForTests, IDLE_AFTER_MINUTES } from "./idleSignal";
import { registerBuiltInTrigger, resetBuiltInTriggersForTests } from "../triggers/registry";
import { triggerSchema, type TriggerRecord } from "../../core/schema/trigger";

const REVIEW_TRIGGER_ID = "trigger_01ARZ3NDEKTSV4RRFFQ69G5FAV";

function reviewPushTrigger(overrides?: Partial<TriggerRecord>): TriggerRecord {
  return triggerSchema.parse({
    id: REVIEW_TRIGGER_ID,
    type: "trigger",
    schemaVersion: 1,
    createdAt: "2026-07-01T08:00:00.000Z",
    updatedAt: "2026-07-01T08:00:00.000Z",
    createdBy: "system",
    name: "复习推动",
    enabled: true,
    when: { kind: "schedule", atLocalTime: "08:00" },
    actionRef: { kind: "navigate", target: "review.panel" },
    reason: "5 张卡到期",
    constraints: { dailyCap: 2, quietHours: { start: "22:00", end: "08:00" }, minGapMinutes: 180, onlyWhenIdle: true },
    ...overrides
  }) as TriggerRecord;
}

// A local Date at a given wall-clock time TODAY. The tick reads getHours()/getDate() etc.,
// so we construct a plain local Date — the assertions never depend on the timezone offset.
function localDateAt(hh: number, mm: number, day = 15): Date {
  return new Date(2026, 6, day, hh, mm, 0, 0);
}

let recorded: Array<{ triggerId: string; localDayKey: string; firedAt: number }> = [];

function baseIo(overrides?: Partial<ProactiveTickIo>): ProactiveTickIo {
  return {
    fetchTriggers: async () => [],
    fetchFires: async () => ({}),
    recordFire: async (triggerId, input) => {
      recorded.push({ triggerId, ...input });
    },
    computeReviewDue: async () => ({ due: 5, hasGradedHistory: true }),
    ...overrides
  };
}

beforeEach(() => {
  recorded = [];
  resetNudgeStoreForTests();
  resetBuiltInTriggersForTests();
  setIdleStateForTests({ hidden: false, lastActivityMs: 0 });
  setIdleClock(() => 10 * 60_000); // 10 min since activity ⇒ idle by IDLE_AFTER_MINUTES
});

afterEach(() => {
  setProactiveTickIoForTests(null);
  setIdleClock(null);
});

describe("idle signal", () => {
  it("is idle when hidden, or after IDLE_AFTER_MINUTES of no activity; active resets it", () => {
    setIdleStateForTests({ hidden: true });
    expect(isIdle()).toBe(true);

    setIdleStateForTests({ hidden: false, lastActivityMs: 0 });
    setIdleClock(() => (IDLE_AFTER_MINUTES - 1) * 60_000); // under the threshold ⇒ active
    expect(isIdle()).toBe(false);
    setIdleClock(() => IDLE_AFTER_MINUTES * 60_000); // at the threshold ⇒ idle
    expect(isIdle()).toBe(true);
  });
});

describe("runProactiveTick — a fireable built-in", () => {
  it("emits a nudge AND records the fire on surface (delta #2) when due + idle + past time", async () => {
    registerBuiltInTrigger({ trigger: reviewPushTrigger() });
    setProactiveTickIoForTests(baseIo());

    const fired = await runProactiveTick({ now: localDateAt(19, 0) });

    expect(fired).toBe(REVIEW_TRIGGER_ID);
    const nudge = getPendingNudge();
    expect(nudge).toMatchObject({ triggerId: REVIEW_TRIGGER_ID, reason: "5 张卡到期", target: "review.panel" });
    // fire recorded on surface with the CLIENT local day + clock.
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ triggerId: REVIEW_TRIGGER_ID, localDayKey: "2026-07-15" });
  });

  it("emits NOTHING when the last surface is within minGap", async () => {
    registerBuiltInTrigger({ trigger: reviewPushTrigger() });
    const now = localDateAt(19, 0);
    // last fired 60 min ago; minGap is 180 min.
    setProactiveTickIoForTests(
      baseIo({
        fetchFires: async () => ({
          [REVIEW_TRIGGER_ID]: { lastFiredAt: now.getTime() - 60 * 60_000, firedByDay: {} }
        })
      })
    );

    const fired = await runProactiveTick({ now });
    expect(fired).toBeNull();
    expect(getPendingNudge()).toBeNull();
    expect(recorded).toHaveLength(0);
  });

  it("emits NOTHING inside local quiet hours (23:00, wrap window)", async () => {
    registerBuiltInTrigger({ trigger: reviewPushTrigger() });
    setProactiveTickIoForTests(baseIo());

    const fired = await runProactiveTick({ now: localDateAt(23, 0) });
    expect(fired).toBeNull();
    expect(getPendingNudge()).toBeNull();
  });

  it("emits NOTHING when not idle (onlyWhenIdle) — the idle transition matters", async () => {
    registerBuiltInTrigger({ trigger: reviewPushTrigger() });
    setProactiveTickIoForTests(baseIo());
    // Make the user ACTIVE (recent activity, not hidden).
    setIdleStateForTests({ hidden: false, lastActivityMs: 10 * 60_000 });
    setIdleClock(() => 10 * 60_000); // 0 min since activity ⇒ active

    const fired = await runProactiveTick({ now: localDateAt(19, 0) });
    expect(fired).toBeNull();
  });

  it("emits NOTHING when nothing is due (reviewDue 0)", async () => {
    registerBuiltInTrigger({ trigger: reviewPushTrigger() });
    setProactiveTickIoForTests(baseIo({ computeReviewDue: async () => ({ due: 0, hasGradedHistory: true }) }));

    const fired = await runProactiveTick({ now: localDateAt(19, 0) });
    expect(fired).toBeNull();
  });

  it("respects an arming guard (delta #6): an un-armed built-in never participates", async () => {
    // No graded history → the guard keeps it out of the candidate set entirely.
    registerBuiltInTrigger({ trigger: reviewPushTrigger(), arm: (s) => s.review.hasGradedHistory });
    setProactiveTickIoForTests(baseIo({ computeReviewDue: async () => ({ due: 9, hasGradedHistory: false }) }));

    const fired = await runProactiveTick({ now: localDateAt(19, 0) });
    expect(fired).toBeNull();
    expect(getPendingNudge()).toBeNull();
  });

  it("de-dupes a same-day re-tick to one visible nudge but keeps restraint via the cap", async () => {
    registerBuiltInTrigger({ trigger: reviewPushTrigger() });
    // First tick: no fires yet. Second tick: reflect the recorded fire so the cap counts.
    let fires: Record<string, { lastFiredAt?: number; firedByDay: Record<string, number>; snoozedUntil?: number }> = {};
    setProactiveTickIoForTests(
      baseIo({
        fetchFires: async () => fires,
        recordFire: async (triggerId, input) => {
          recorded.push({ triggerId, ...input });
          fires = { [triggerId]: { lastFiredAt: input.firedAt, firedByDay: { [input.localDayKey]: 1 }, snoozedUntil: undefined } };
        }
      })
    );

    const now = localDateAt(19, 0);
    expect(await runProactiveTick({ now })).toBe(REVIEW_TRIGGER_ID);
    // A second tick 1 min later is inside minGap ⇒ suppressed (no second fire).
    const later = localDateAt(19, 1);
    expect(await runProactiveTick({ now: later })).toBeNull();
    expect(recorded).toHaveLength(1);
  });
});
