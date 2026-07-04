// Local wall-clock context (PRO-1, build-spec delta #1) — the CLIENT owns `new Date()`
// and derives the local-time quantities the pure evaluator needs. The whole codebase is
// UTC-epoch; quiet hours, a per-local-day cap and the day rollover are inherently the
// USER's wall clock, so this is the ONE place local-time is computed, and it lives on the
// client. Pure over an injected Date so tests pin it (no real clock in assertions).

/** The client-computed local clock context the evaluator consumes. */
export type LocalClock = {
  /** Epoch millis (date.getTime()). */
  nowMs: number;
  /** Local time-of-day as zero-padded HH:MM. */
  localHhmm: string;
  /** Local day key YYYY-MM-DD (the per-day cap + rollover bucket). */
  localDayKey: string;
};

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Build the local clock context from a Date (defaults to now). Pure + injectable. */
export function localClockFrom(date: Date = new Date()): LocalClock {
  return {
    nowMs: date.getTime(),
    localHhmm: `${pad2(date.getHours())}:${pad2(date.getMinutes())}`,
    localDayKey: `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
  };
}
