// Client idle signal (PRO-1, proactive-learning §1: onlyWhenIdle restraint) — a tiny
// module-scope tracker of "is the user idle right now?" over the browser signals that
// ALREADY exist in a renderer (no new dependency): document visibility + the time since
// the last pointer/key activity. The tick reads isIdle() to fill the pure evaluator's
// ctx.isIdle, and isHidden() gates the desktop Notification (a nudge becomes an OS
// notification only when the window is hidden — PRO1.5).
//
// This is genuinely NEW machinery (grep confirmed: no prior visibilitychange /
// requestIdleCallback / document.hidden renderer hook). Kept pure of React so tests drive
// it headless; startIdleTracking wires the DOM listeners once and returns a teardown.

/** Minutes of no pointer/key activity before we call the user idle (also hidden ⇒ idle). */
export const IDLE_AFTER_MINUTES = 3;

let lastActivityMs = Date.now();
let hidden = typeof document !== "undefined" ? document.hidden : false;
/** Injectable clock so tests are deterministic (no real Date in assertions). */
let clock: () => number = () => Date.now();

/** Test/host seam: pin the clock the idle math reads (null restores Date.now). */
export function setIdleClock(fn: (() => number) | null): void {
  clock = fn ?? (() => Date.now());
}

function markActive(): void {
  lastActivityMs = clock();
}

/** Is the user idle NOW? Idle ⇔ the tab is hidden OR no activity for IDLE_AFTER_MINUTES. */
export function isIdle(): boolean {
  if (hidden) return true;
  return clock() - lastActivityMs >= IDLE_AFTER_MINUTES * 60_000;
}

/** Is the window hidden right now? (Gates whether a nudge escalates to an OS Notification.) */
export function isHidden(): boolean {
  return hidden;
}

/** Test seam: force the idle inputs directly (bypasses the DOM listeners). */
export function setIdleStateForTests(state: { lastActivityMs?: number; hidden?: boolean }): void {
  if (state.lastActivityMs !== undefined) lastActivityMs = state.lastActivityMs;
  if (state.hidden !== undefined) hidden = state.hidden;
}

/**
 * Wire the DOM listeners once (visibilitychange + a few activity events). Returns a
 * teardown that removes them. No-op with a return outside a DOM (SSR/jsdom-less).
 */
export function startIdleTracking(): () => void {
  if (typeof document === "undefined" || typeof window === "undefined") return () => {};
  markActive();
  hidden = document.hidden;

  const onVisibility = () => {
    hidden = document.hidden;
    if (!hidden) markActive(); // returning to the tab counts as activity
  };
  const activityEvents: Array<keyof WindowEventMap> = ["pointerdown", "pointermove", "keydown", "wheel", "scroll"];

  document.addEventListener("visibilitychange", onVisibility);
  for (const evt of activityEvents) window.addEventListener(evt, markActive, { passive: true });

  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    for (const evt of activityEvents) window.removeEventListener(evt, markActive);
  };
}
