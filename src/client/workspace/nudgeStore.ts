// Pending-nudge store (PRO-1) — the module-scope seam between the proactive TICK (which
// decides a nudge should surface) and the NudgeToast chrome (which shows it), mirroring
// the shellNav / install-state store idiom so the tick never reaches into React state and
// the toast never reaches into the tick (IRON LAW). One nudge is "pending" at a time (the
// newest wins); the toast subscribes and re-renders on change.
//
// TTL + DEDUPE (build-spec delta #6): a pending nudge carries the localDayKey it was
// raised on; pushing DROPS a pending nudge that is not from today (stale across a rollover
// or a slept laptop), and a re-push for the SAME triggerId+localDayKey is a no-op (the
// user already sees it — don't restart the toast or double-count). The tick still records
// the fire separately (fire-on-surface), so dedupe here is purely about the visible toast.

export type PendingNudge = {
  /** The trigger that raised it — the fire/dismiss/snooze POSTs key on this. */
  triggerId: string;
  /** The WHY string every nudge must show (queue-reason principle). */
  reason: string;
  /** The shell target to navigate to on click (e.g. "review.panel"). */
  target: string;
  /** The local day this was raised on — the TTL + dedupe key (delta #6). */
  localDayKey: string;
};

type Listener = (nudge: PendingNudge | null) => void;

let current: PendingNudge | null = null;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener(current);
}

/** The currently pending nudge, or null. */
export function getPendingNudge(): PendingNudge | null {
  return current;
}

/**
 * Push a nudge to surface. Returns true if it became (or already was) the visible pending
 * nudge, false if it was DROPPED (stale, not from `todayKey`). De-dupes an identical
 * re-push (same triggerId+localDayKey) to a silent no-op so the toast isn't restarted.
 */
export function pushNudge(nudge: PendingNudge, todayKey: string): boolean {
  // TTL: a nudge raised on a different local day is stale — never show it.
  if (nudge.localDayKey !== todayKey) return false;
  // Dedupe: the same trigger on the same day is already shown — no-op (no re-emit).
  if (current && current.triggerId === nudge.triggerId && current.localDayKey === nudge.localDayKey) {
    return true;
  }
  current = nudge;
  emit();
  return true;
}

/** Clear the pending nudge (dismiss / snooze / after navigate). Idempotent. */
export function clearNudge(): void {
  if (current === null) return;
  current = null;
  emit();
}

/** Subscribe to pending-nudge changes; returns an unsubscribe. Fires once immediately. */
export function subscribeNudge(listener: Listener): () => void {
  listeners.add(listener);
  listener(current);
  return () => listeners.delete(listener);
}

/** Test seam: wipe the store between cases. */
export function resetNudgeStoreForTests(): void {
  current = null;
  listeners.clear();
}
