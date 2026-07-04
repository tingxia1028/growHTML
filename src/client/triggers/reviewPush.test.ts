// @vitest-environment jsdom
// Review-push built-in (PRO-1 exemplar) — the arming guard + the end-to-end tick→nudge→
// navigate flow, driven through the REAL registry + REAL proactive tick with only the io
// edges stubbed. This is the integration the build-spec's PRO1.6 asks for: seed graded
// history + a due signal → the tick surfaces a nudge with the review-push reason → clicking
// it deep-links navigateShell(review.panel). No test-only HTTP route — the hook is directly
// invokable (delta #6: any HTTP tick would be env-gated; this drives the hook itself).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigateShell = vi.hoisted(() => vi.fn(() => true));
vi.mock("../workspace/shellNav", () => ({ navigateShell }));

import { registerReviewPushTrigger, REVIEW_PUSH_TRIGGER_ID } from "./reviewPush";
import { resetBuiltInTriggersForTests } from "./registry";
import { runProactiveTick, setProactiveTickIoForTests } from "../workspace/proactiveTick";
import { getPendingNudge, resetNudgeStoreForTests } from "../workspace/nudgeStore";
import { setIdleStateForTests, setIdleClock } from "../workspace/idleSignal";

// A local Date at a wall-clock time TODAY, past the review-push's 07:00 schedule + outside
// its 22:00–08:00 quiet window (so 12:00 is a valid fire time).
function localNoon(): Date {
  return new Date(2026, 6, 15, 12, 0, 0, 0);
}

let recorded: Array<{ triggerId: string; localDayKey: string; firedAt: number }> = [];

function stubTickIo(review: { due: number; hasGradedHistory: boolean }) {
  recorded = [];
  setProactiveTickIoForTests({
    fetchTriggers: async () => [], // no user entity triggers
    fetchFires: async () => ({}), // nothing surfaced yet
    recordFire: async (triggerId, input) => {
      recorded.push({ triggerId, ...input });
    },
    computeReviewDue: async () => review
  });
}

beforeEach(() => {
  resetBuiltInTriggersForTests();
  resetNudgeStoreForTests();
  navigateShell.mockClear();
  registerReviewPushTrigger(); // the REAL built-in registration
  setIdleStateForTests({ hidden: true, lastActivityMs: 0 }); // idle (onlyWhenIdle)
  setIdleClock(() => 0);
});

afterEach(() => {
  setProactiveTickIoForTests(null);
  setIdleClock(null);
  resetBuiltInTriggersForTests();
});

describe("review-push built-in — arming guard (delta #6)", () => {
  it("does NOT fire with a due count but NO graded history (fresh importer, day-one nag guard)", async () => {
    // reviewDueStats over an empty schedule counts ALL eligible notes as due; the guard must
    // keep the trigger out until graded history exists.
    stubTickIo({ due: 12, hasGradedHistory: false });
    const fired = await runProactiveTick({ now: localNoon() });
    expect(fired).toBeNull();
    expect(getPendingNudge()).toBeNull();
  });

  it("does NOT fire once graded history exists but nothing is actually due", async () => {
    stubTickIo({ due: 0, hasGradedHistory: true });
    expect(await runProactiveTick({ now: localNoon() })).toBeNull();
    expect(getPendingNudge()).toBeNull();
  });
});

describe("review-push built-in — the end-to-end nudge→navigate flow", () => {
  it("seed graded history + a due signal → the tick surfaces the review-push nudge → click → navigateShell(review.panel)", async () => {
    // Graded history (≥1 schedule record) AND something due → the exemplar fires.
    stubTickIo({ due: 5, hasGradedHistory: true });

    const fired = await runProactiveTick({ now: localNoon() });

    // 1) the tick surfaced the review-push, recording the fire ON SURFACE (delta #2).
    expect(fired).toBe(REVIEW_PUSH_TRIGGER_ID);
    expect(recorded).toEqual([{ triggerId: REVIEW_PUSH_TRIGGER_ID, localDayKey: "2026-07-15", firedAt: localNoon().getTime() }]);

    // 2) a pending nudge with the review-push reason + target is up.
    const nudge = getPendingNudge();
    expect(nudge).toMatchObject({
      triggerId: REVIEW_PUSH_TRIGGER_ID,
      reason: "该复习了 · 有到期的复习卡",
      target: "review.panel"
    });

    // 3) clicking it deep-links the review runner (which self-loads its due queue).
    const { navigateShell: nav } = await import("../workspace/shellNav");
    nav({ type: "pane", kind: nudge!.target });
    expect(navigateShell).toHaveBeenCalledWith({ type: "pane", kind: "review.panel" });
  });
});
