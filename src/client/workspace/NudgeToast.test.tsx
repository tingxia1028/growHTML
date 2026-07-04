// @vitest-environment jsdom
// NudgeToast (PRO-1) — the nudge surface. Asserts: renders the trigger's REASON; a click
// deep-links via navigateShell + clears the toast; 稍后再说 POSTs snooze and 关闭 POSTs
// dismiss (both clear); and the desktop Notification escalation fires ONLY when the window
// is hidden AND permission is granted, never when denied.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

const mocks = vi.hoisted(() => ({
  navigateShell: vi.fn(() => true),
  snoozeTrigger: vi.fn(async () => ({ state: { firedByDay: {} } })),
  dismissTrigger: vi.fn(async () => ({ state: { firedByDay: {} } })),
  hidden: { value: false }
}));
const { navigateShell, snoozeTrigger, dismissTrigger } = mocks;
vi.mock("./shellNav", () => ({ navigateShell: mocks.navigateShell }));
vi.mock("../data/entityClient", () => ({
  entityClient: { snoozeTrigger: mocks.snoozeTrigger, dismissTrigger: mocks.dismissTrigger }
}));
vi.mock("./idleSignal", () => ({ isHidden: () => mocks.hidden.value }));

import { NudgeToast, maybeNotify } from "./NudgeToast";
import { pushNudge, resetNudgeStoreForTests, getPendingNudge } from "./nudgeStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NUDGE = { triggerId: "trigger_x", reason: "5 张卡到期 · 你 19:00 常复习", target: "review.panel", localDayKey: "2026-07-15" };

function render(): { container: HTMLElement; cleanup: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<NudgeToast />));
  return {
    container,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    }
  };
}

beforeEach(() => {
  resetNudgeStoreForTests();
  navigateShell.mockClear();
  snoozeTrigger.mockClear();
  dismissTrigger.mockClear();
  mocks.hidden.value = false;
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("NudgeToast surface", () => {
  it("renders nothing when no nudge is pending, then the REASON once one lands", () => {
    const { cleanup } = render();
    expect(document.querySelector(".nudge-toast")).toBeNull();
    act(() => {
      pushNudge(NUDGE, NUDGE.localDayKey);
    });
    const toast = document.querySelector(".nudge-toast");
    expect(toast).not.toBeNull();
    expect(toast?.textContent).toContain("5 张卡到期 · 你 19:00 常复习");
    cleanup();
  });

  it("a reason/open click deep-links via navigateShell(review.panel) + clears the toast", () => {
    const { cleanup } = render();
    act(() => {
      pushNudge(NUDGE, NUDGE.localDayKey);
    });
    const open = document.querySelector(".nudge-toast-open") as HTMLButtonElement;
    act(() => open.click());
    expect(navigateShell).toHaveBeenCalledWith({ type: "pane", kind: "review.panel" });
    expect(getPendingNudge()).toBeNull(); // cleared
    expect(document.querySelector(".nudge-toast")).toBeNull();
    cleanup();
  });

  it("稍后再说 POSTs snooze + clears; 关闭 POSTs dismiss + clears", () => {
    const { cleanup } = render();
    act(() => {
      pushNudge(NUDGE, NUDGE.localDayKey);
    });
    act(() => (document.querySelector(".nudge-toast-snooze") as HTMLButtonElement).click());
    expect(snoozeTrigger).toHaveBeenCalledWith("trigger_x", expect.any(Number));
    expect(getPendingNudge()).toBeNull();

    // Re-raise and dismiss.
    act(() => {
      pushNudge(NUDGE, NUDGE.localDayKey);
    });
    act(() => (document.querySelector(".nudge-toast-dismiss") as HTMLButtonElement).click());
    expect(dismissTrigger).toHaveBeenCalledWith("trigger_x");
    expect(getPendingNudge()).toBeNull();
    cleanup();
  });
});

describe("maybeNotify — the desktop Notification enhancement (delta #6)", () => {
  function stubNotification(permission: NotificationPermission) {
    const ctor = vi.fn();
    const NotificationStub = Object.assign(ctor, {
      permission,
      requestPermission: vi.fn(async () => permission)
    });
    vi.stubGlobal("Notification", NotificationStub);
    return NotificationStub;
  }

  it("fires ONLY when hidden AND granted", () => {
    const N = stubNotification("granted");
    mocks.hidden.value = true;
    expect(maybeNotify(NUDGE)).toBe(true);
    expect(N).toHaveBeenCalledWith(NUDGE.reason);
  });

  it("does NOT fire when granted but the window is VISIBLE", () => {
    const N = stubNotification("granted");
    mocks.hidden.value = false;
    expect(maybeNotify(NUDGE)).toBe(false);
    expect(N).not.toHaveBeenCalled();
  });

  it("does NOT fire when DENIED (even if hidden) — the toast stays the only surface", () => {
    const N = stubNotification("denied");
    mocks.hidden.value = true;
    expect(maybeNotify(NUDGE)).toBe(false);
    expect(N).not.toHaveBeenCalled();
  });

  it("requests permission once (not fire) when default + hidden", () => {
    const N = stubNotification("default");
    mocks.hidden.value = true;
    expect(maybeNotify(NUDGE)).toBe(false);
    expect(N).not.toHaveBeenCalled(); // no notification yet
    expect(N.requestPermission).toHaveBeenCalledTimes(1);
  });

  it("no-ops safely when Notification is absent (jsdom/older shell)", () => {
    vi.stubGlobal("Notification", undefined);
    mocks.hidden.value = true;
    expect(maybeNotify(NUDGE)).toBe(false);
  });
});
