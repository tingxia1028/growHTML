// @vitest-environment jsdom
// PRO-2 launch wiring (build-spec commit 6): the teachback.start command + the global-
// search NAV_COMMANDS entry both deep-link the runner (navigateShell → teachback.panel);
// and the teach-back TRIGGER ships enabled:false (delta 2) — a disabled trigger is
// suppressed, but a manually-enabled one fires end-to-end → navigate (the reviewPush.test
// idiom). This validates the wiring without the double-nudge.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigateShell = vi.hoisted(() => vi.fn(() => true));
vi.mock("../../client/workspace/shellNav", () => ({ navigateShell }));

import { teachbackStartCommand, TEACHBACK_PANEL_KIND } from "./commands";
import { searchCommandEntries } from "../../client/search/commandEntries";
import { evaluateTrigger, type TriggerEvalContext } from "../../core/trigger/evaluate";
import { teachbackTrigger, TEACHBACK_TRIGGER_ID, TEACHBACK_AT_LOCAL_TIME } from "../../client/triggers/teachbackTrigger";

beforeEach(() => navigateShell.mockClear());
afterEach(() => vi.clearAllMocks());

describe("teachback.start command", () => {
  it("is always available and navigateShell(teachback.panel) on run", () => {
    expect(teachbackStartCommand.id).toBe("teachback.start");
    expect(teachbackStartCommand.isAvailable({} as never)).toBe(true);
    teachbackStartCommand.run({} as never);
    expect(navigateShell).toHaveBeenCalledWith({ type: "pane", kind: TEACHBACK_PANEL_KIND });
    expect(TEACHBACK_PANEL_KIND).toBe("teachback.panel");
  });
});

describe("global-search NAV_COMMANDS entry (delta 1 — the static list needs it)", () => {
  it("surfaces an open:teachback.panel command that deep-links the panel", () => {
    const entry = searchCommandEntries().find((e) => e.id === "open:teachback.panel");
    expect(entry, "teachback command missing from the STATIC palette list").toBeTruthy();
    expect(entry!.target).toEqual({ type: "pane", kind: "teachback.panel" });
    // aliases include 教回/feynman so the palette matches natural queries
    expect(entry!.aliases).toContain("教回");
    entry!.run();
    expect(navigateShell).toHaveBeenCalledWith({ type: "pane", kind: "teachback.panel" });
  });
});

describe("teach-back trigger (delta 2 — enabled:false, known-gap double-nudge)", () => {
  const baseCtx = (over: Partial<TriggerEvalContext> = {}): TriggerEvalContext => ({
    nowMs: new Date(2026, 6, 15, 20, 0, 0).getTime(), // 20:00 local, past 19:00, outside quiet
    localHhmm: "20:00",
    localDayKey: "2026-07-15",
    firedTodayCount: 0,
    signals: { reviewDue: 5 },
    isIdle: true,
    ...over
  });

  it("SHIPS disabled → the evaluator suppresses it (no auto-navigate for a fresh user)", () => {
    expect(teachbackTrigger.enabled).toBe(false);
    expect(teachbackTrigger.id).toBe(TEACHBACK_TRIGGER_ID);
    expect(teachbackTrigger.actionRef).toEqual({ kind: "navigate", target: "teachback.panel" });
    const result = evaluateTrigger(teachbackTrigger, baseCtx());
    expect(result).toEqual({ fire: false, suppressedBy: "disabled" });
  });

  it("a manually-enabled trigger FIRES end-to-end when reviewDue>=1 past its time", () => {
    const enabled = { ...teachbackTrigger, enabled: true };
    const result = evaluateTrigger(enabled, baseCtx());
    expect(result).toEqual({ fire: true, reason: teachbackTrigger.reason });
    // the wiring: actionRef.target is the panel the shell resolves via navigateShell
    expect(enabled.actionRef).toEqual({ kind: "navigate", target: "teachback.panel" });
    expect(TEACHBACK_AT_LOCAL_TIME).toBe("19:00");
  });

  it("even enabled, it stays quiet before its scheduled time / with no due signal", () => {
    const enabled = { ...teachbackTrigger, enabled: true };
    // before 19:00
    expect(evaluateTrigger(enabled, baseCtx({ localHhmm: "10:00", nowMs: new Date(2026, 6, 15, 10, 0, 0).getTime() })))
      .toEqual({ fire: false, suppressedBy: "not-due" });
    // nothing due
    expect(evaluateTrigger(enabled, baseCtx({ signals: { reviewDue: 0 } })))
      .toEqual({ fire: false, suppressedBy: "no-signal" });
  });
});
