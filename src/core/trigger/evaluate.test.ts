// The pure trigger evaluator restraint matrix (PRO-1). Every gate is exercised
// fire/suppress with an INJECTED local clock context (no real Date/timers) — determinism
// is the point. Also: the midnight-wrapping quiet window, the local-day rollover of the
// cap, the event/operation PRO-1 rejection, and the "cap never exceeded" property.
import { describe, expect, it } from "vitest";
import { evaluateTrigger, type TriggerEvalContext, type TriggerEvalResult } from "./evaluate";
import { triggerSchema, type TriggerRecord } from "../schema/trigger";

/** Narrow to the suppression variant + return its reason (fails loudly if it fired). */
function suppressedBy(result: TriggerEvalResult): string {
  expect(result.fire).toBe(false);
  return result.fire ? "FIRED" : result.suppressedBy;
}

// A canonical schedule+navigate review-push trigger (the PRO-1 exemplar's shape).
function makeTrigger(overrides?: Partial<TriggerRecord>): TriggerRecord {
  return triggerSchema.parse({
    id: "trigger_01ARZ3NDEKTSV4RRFFQ69G5FAV",
    type: "trigger",
    schemaVersion: 1,
    createdAt: "2026-07-01T08:00:00.000Z",
    updatedAt: "2026-07-01T08:00:00.000Z",
    createdBy: "system",
    name: "复习推动",
    enabled: true,
    when: { kind: "schedule", atLocalTime: "19:00" },
    actionRef: { kind: "navigate", target: "review.panel" },
    reason: "5 张卡到期 · 你 19:00 常复习",
    constraints: { dailyCap: 2, quietHours: { start: "22:00", end: "08:00" }, minGapMinutes: 180, onlyWhenIdle: true },
    ...overrides
  });
}

// A context where the trigger WOULD fire — every gate open, past 19:00, due≥1, idle.
const MS_1930 = Date.UTC(2026, 6, 5, 11, 30); // arbitrary epoch; the HH:MM below is what matters
function fireableCtx(overrides?: Partial<TriggerEvalContext>): TriggerEvalContext {
  return {
    nowMs: MS_1930,
    localHhmm: "19:30",
    localDayKey: "2026-07-05",
    firedTodayCount: 0,
    signals: { reviewDue: 5 },
    isIdle: true,
    ...overrides
  };
}

describe("evaluateTrigger — the happy path", () => {
  it("FIRES with the trigger's reason when every gate is open, past the time, due, idle", () => {
    const result = evaluateTrigger(makeTrigger(), fireableCtx());
    expect(result).toEqual({ fire: true, reason: "5 张卡到期 · 你 19:00 常复习" });
  });
});

describe("evaluateTrigger — each restraint gate (suppress)", () => {
  it("disabled ⇒ suppressedBy:disabled", () => {
    expect(evaluateTrigger(makeTrigger({ enabled: false }), fireableCtx())).toEqual({
      fire: false,
      suppressedBy: "disabled"
    });
  });

  it("snooze in the future ⇒ suppressedBy:snoozed (wins over cap etc.)", () => {
    const ctx = fireableCtx({ snoozedUntil: MS_1930 + 60_000, firedTodayCount: 99 });
    expect(evaluateTrigger(makeTrigger(), ctx)).toEqual({ fire: false, suppressedBy: "snoozed" });
  });

  it("an EXPIRED snooze does not suppress (nowMs ≥ snoozedUntil)", () => {
    const ctx = fireableCtx({ snoozedUntil: MS_1930 - 1 });
    expect(evaluateTrigger(makeTrigger(), ctx).fire).toBe(true);
  });

  it("firedTodayCount at the cap ⇒ suppressedBy:daily-cap", () => {
    expect(suppressedBy(evaluateTrigger(makeTrigger(), fireableCtx({ firedTodayCount: 2 })))).toBe("daily-cap");
    // one under the cap still fires
    expect(evaluateTrigger(makeTrigger(), fireableCtx({ firedTodayCount: 1 })).fire).toBe(true);
  });

  it("inside local quiet hours ⇒ suppressedBy:quiet-hours", () => {
    // 23:00 is inside the 22:00→08:00 wrap window.
    expect(suppressedBy(evaluateTrigger(makeTrigger(), fireableCtx({ localHhmm: "23:00" })))).toBe("quiet-hours");
  });

  it("within minGap of the last surface ⇒ suppressedBy:min-gap", () => {
    // last fired 60 min ago; minGap is 180 min.
    const ctx = fireableCtx({ lastFiredAt: MS_1930 - 60 * 60_000 });
    expect(suppressedBy(evaluateTrigger(makeTrigger(), ctx))).toBe("min-gap");
    // exactly at the gap boundary (180 min ago) fires.
    const atBoundary = fireableCtx({ lastFiredAt: MS_1930 - 180 * 60_000 });
    expect(evaluateTrigger(makeTrigger(), atBoundary).fire).toBe(true);
  });

  it("not idle + onlyWhenIdle ⇒ suppressedBy:not-idle (but fires if the trigger allows non-idle)", () => {
    expect(suppressedBy(evaluateTrigger(makeTrigger(), fireableCtx({ isIdle: false })))).toBe("not-idle");
    const allowsActive = makeTrigger({
      constraints: { dailyCap: 2, quietHours: { start: "22:00", end: "08:00" }, minGapMinutes: 180, onlyWhenIdle: false }
    });
    expect(evaluateTrigger(allowsActive, fireableCtx({ isIdle: false })).fire).toBe(true);
  });

  it("before the daily schedule time ⇒ suppressedBy:not-due", () => {
    expect(suppressedBy(evaluateTrigger(makeTrigger(), fireableCtx({ localHhmm: "18:59" })))).toBe("not-due");
  });

  it("nothing due (reviewDue < 1) ⇒ suppressedBy:no-signal", () => {
    expect(suppressedBy(evaluateTrigger(makeTrigger(), fireableCtx({ signals: { reviewDue: 0 } })))).toBe("no-signal");
    expect(suppressedBy(evaluateTrigger(makeTrigger(), fireableCtx({ signals: {} })))).toBe("no-signal");
  });
});

describe("evaluateTrigger — quiet-hours midnight wrap", () => {
  const t = makeTrigger();
  it("22:00→08:00: quiet at 23:00 and at 03:00, NOT quiet at 12:00", () => {
    expect(suppressedBy(evaluateTrigger(t, fireableCtx({ localHhmm: "23:00" })))).toBe("quiet-hours");
    expect(suppressedBy(evaluateTrigger(t, fireableCtx({ localHhmm: "03:00" })))).toBe("quiet-hours");
    // 12:00 is outside quiet — but before the 19:00 schedule ⇒ not-due (not quiet-hours).
    expect(suppressedBy(evaluateTrigger(t, fireableCtx({ localHhmm: "12:00" })))).toBe("not-due");
  });

  it("a NON-wrapping window (08:00→22:00) is quiet mid-day, open at night", () => {
    const dayQuiet = makeTrigger({
      constraints: { dailyCap: 2, quietHours: { start: "08:00", end: "22:00" }, minGapMinutes: 180, onlyWhenIdle: true },
      when: { kind: "schedule", atLocalTime: "00:00" }
    });
    expect(suppressedBy(evaluateTrigger(dayQuiet, fireableCtx({ localHhmm: "12:00" })))).toBe("quiet-hours");
    expect(evaluateTrigger(dayQuiet, fireableCtx({ localHhmm: "23:00" })).fire).toBe(true);
  });

  it("a degenerate start==end window is NEVER quiet", () => {
    // Schedule at 00:00 so 23:00 has crossed the daily time; a start==end window means
    // "no quiet hours", so it fires at 23:00 instead of being silenced.
    const noQuiet = makeTrigger({
      constraints: { dailyCap: 2, quietHours: { start: "00:00", end: "00:00" }, minGapMinutes: 180, onlyWhenIdle: true },
      when: { kind: "schedule", atLocalTime: "00:00" }
    });
    expect(evaluateTrigger(noQuiet, fireableCtx({ localHhmm: "23:00" })).fire).toBe(true);
  });
});

describe("evaluateTrigger — local-day rollover of the cap", () => {
  it("the cap is per localDayKey: yesterday's count does not carry (caller scopes it)", () => {
    // Same trigger, two different local days: the caller passes firedTodayCount=0 on the
    // NEW day (it buckets by localDayKey), so the cap resets for free — no date math here.
    const yesterday = fireableCtx({ localDayKey: "2026-07-04", firedTodayCount: 2 });
    expect(suppressedBy(evaluateTrigger(makeTrigger(), yesterday))).toBe("daily-cap");
    const today = fireableCtx({ localDayKey: "2026-07-05", firedTodayCount: 0 });
    expect(evaluateTrigger(makeTrigger(), today).fire).toBe(true);
  });
});

describe("evaluateTrigger — PRO-1 variant trim (delta #5)", () => {
  it("when:event ⇒ suppressedBy:unsupported-in-pro1 (defined, not wired)", () => {
    const eventTrigger = makeTrigger({ when: { kind: "event", signal: "mistakes-accumulated" } });
    expect(evaluateTrigger(eventTrigger, fireableCtx())).toEqual({ fire: false, suppressedBy: "unsupported-in-pro1" });
  });

  it("actionRef:operation ⇒ suppressedBy:unsupported-in-pro1 (needs a focus host)", () => {
    const opTrigger = makeTrigger({ actionRef: { kind: "operation", operationId: "op_x" } });
    expect(evaluateTrigger(opTrigger, fireableCtx())).toEqual({ fire: false, suppressedBy: "unsupported-in-pro1" });
  });
});

describe("evaluateTrigger — the cap-never-exceeded property", () => {
  it("across many local ticks, the number of FIRES on a day never exceeds dailyCap", () => {
    // Simulate a day of ticks. The caller (client) increments firedTodayCount on each
    // fire; evaluateTrigger must refuse once the cap is reached. We assert the invariant
    // holds for a range of caps and tick counts.
    for (const cap of [0, 1, 2, 5]) {
      const trigger = makeTrigger({
        constraints: { dailyCap: cap, quietHours: { start: "22:00", end: "08:00" }, minGapMinutes: 0, onlyWhenIdle: false }
      });
      let firedTodayCount = 0;
      let fires = 0;
      for (let tick = 0; tick < 50; tick += 1) {
        const result = evaluateTrigger(trigger, {
          nowMs: MS_1930 + tick,
          localHhmm: "19:30",
          localDayKey: "2026-07-05",
          firedTodayCount,
          signals: { reviewDue: 5 },
          isIdle: true
        });
        if (result.fire) {
          fires += 1;
          firedTodayCount += 1; // the caller's on-surface increment
        }
      }
      expect(fires).toBe(cap); // exactly the cap fires, never more
      expect(fires).toBeLessThanOrEqual(cap);
    }
  });
});
