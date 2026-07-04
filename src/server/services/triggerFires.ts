// Trigger FIRE STATE (PRO-1, proactive-learning §1) — the fast-moving side of a trigger,
// kept OUT of the durable definition store (triggers.jsonl) and in a small raw-JSON file
// (trigger-fires.json), the operation-prefs.json / review-schedule.json `vault.storage`
// idiom: read → parse-or-default, write → atomic pretty JSON. The zod schemas double as
// the FILE format AND the route body shapes (one validation source of truth with the
// direct adapter — X0b).
//
// FIRE-ON-SURFACE (build-spec delta #2): the client POSTs a fire when it SURFACES a
// nudge, NOT when a candidate is computed — restraint governs what the user SEES. The
// per-day count is bucketed by the CLIENT-computed localDayKey (build-spec delta #1: the
// only place a local day is meaningful is the user's wall clock, which the client owns);
// the server never does local-time math. Reading back one trigger's state gives the tick
// the { lastFiredAt, firedTodayCount(for a given localDayKey), snoozedUntil? } it injects
// into the pure evaluator.
//
// firedByDay also self-prunes on write (keep only a small window of recent local days) so
// the file cannot grow without bound.

import path from "node:path";
import { z } from "zod";
import type { StudyVault } from "../../core/vault";
import { triggerIdSchema } from "../../core/schema";

export const TRIGGER_FIRES_FILE_NAME = "trigger-fires.json";

/** How many recent local-day buckets to keep per trigger (older ones are pruned). */
const FIRED_BY_DAY_WINDOW = 14;

export type TriggerFiresDeps = { vault: StudyVault };

/** One trigger's fire state. lastFiredAt/snoozedUntil are epoch millis (client clock). */
export const triggerFireStateSchema = z.object({
  lastFiredAt: z.number().int().nonnegative().optional(),
  /** localDayKey → nudges SURFACED that local day (the per-day cap counter). */
  firedByDay: z.record(z.string(), z.number().int().nonnegative()).default({}),
  snoozedUntil: z.number().int().nonnegative().optional()
});
export type TriggerFireState = z.infer<typeof triggerFireStateSchema>;

/** The whole document: triggerId → fire state. Absent file ⇒ {} (nothing fired yet). */
export const triggerFiresStateSchema = z.record(z.string(), triggerFireStateSchema);
export type TriggerFiresState = z.infer<typeof triggerFiresStateSchema>;

const EMPTY_STATE: TriggerFireState = { firedByDay: {} };

/** POST /api/triggers/:id/fire — record that the client SURFACED a nudge (delta #2). */
export const recordFireSchema = z.object({
  /** The CLIENT-computed local day key the surface counts against (delta #1). */
  localDayKey: z.string().min(1),
  /** The client's surface time (epoch millis) — the memory-events `ts` idiom (tests pin). */
  firedAt: z.number().int().nonnegative()
});
export type RecordFireInput = z.infer<typeof recordFireSchema>;

/** POST /api/triggers/:id/snooze — silence this trigger until an epoch-millis instant. */
export const snoozeSchema = z.object({ snoozedUntil: z.number().int().nonnegative() });
export type SnoozeInput = z.infer<typeof snoozeSchema>;

function firesPathFor(vault: StudyVault): string {
  return path.join(vault.paths.studyDir, TRIGGER_FIRES_FILE_NAME);
}

/**
 * Read the whole fire-state document. Absent/corrupt ⇒ {} — fire state is derived
 * restraint bookkeeping, and degrading to "nothing fired yet" is the safe direction (at
 * worst one extra nudge, never a wrong-silence). Mirrors readReviewSchedule's law.
 */
export async function readTriggerFires({ vault }: TriggerFiresDeps): Promise<TriggerFiresState> {
  const text = await vault.storage.readText(firesPathFor(vault));
  if (!text) return {};
  try {
    return triggerFiresStateSchema.parse(JSON.parse(text));
  } catch {
    return {};
  }
}

async function writeTriggerFires(deps: TriggerFiresDeps, state: TriggerFiresState): Promise<void> {
  await deps.vault.storage.writeTextAtomic(firesPathFor(deps.vault), `${JSON.stringify(state, null, 2)}\n`);
}

/** Keep only the most recent localDayKey buckets (lexicographic sort works on ISO days). */
function pruneFiredByDay(firedByDay: Record<string, number>): Record<string, number> {
  const keys = Object.keys(firedByDay).sort();
  if (keys.length <= FIRED_BY_DAY_WINDOW) return firedByDay;
  const keep = keys.slice(keys.length - FIRED_BY_DAY_WINDOW);
  return Object.fromEntries(keep.map((k) => [k, firedByDay[k]]));
}

/**
 * Record a SURFACED nudge for one trigger (delta #2): bump firedByDay[localDayKey] and
 * stamp lastFiredAt to the client's surface time. Returns the trigger's new state.
 */
export async function recordTriggerFire(
  deps: TriggerFiresDeps,
  input: { triggerId: string } & RecordFireInput
): Promise<TriggerFireState> {
  triggerIdSchema.parse(input.triggerId); // reject a malformed id at the edge
  const state = await readTriggerFires(deps);
  const prev = state[input.triggerId] ?? EMPTY_STATE;
  const firedByDay = pruneFiredByDay({
    ...prev.firedByDay,
    [input.localDayKey]: (prev.firedByDay[input.localDayKey] ?? 0) + 1
  });
  const next: TriggerFireState = { ...prev, lastFiredAt: input.firedAt, firedByDay };
  await writeTriggerFires(deps, { ...state, [input.triggerId]: next });
  return next;
}

/** Snooze one trigger until an instant (delta #6 dismiss/snooze surface controls). */
export async function snoozeTrigger(
  deps: TriggerFiresDeps,
  input: { triggerId: string } & SnoozeInput
): Promise<TriggerFireState> {
  triggerIdSchema.parse(input.triggerId);
  const state = await readTriggerFires(deps);
  const prev = state[input.triggerId] ?? EMPTY_STATE;
  const next: TriggerFireState = { ...prev, snoozedUntil: input.snoozedUntil };
  await writeTriggerFires(deps, { ...state, [input.triggerId]: next });
  return next;
}

/**
 * Dismiss = clear this trigger's snooze (the pending nudge itself is client-side/in-
 * memory in the tick; dismiss on the server just lifts any lingering snooze so a genuine
 * later signal is not permanently muted). Returns the new state. Idempotent.
 */
export async function dismissTrigger(
  deps: TriggerFiresDeps,
  input: { triggerId: string }
): Promise<TriggerFireState> {
  triggerIdSchema.parse(input.triggerId);
  const state = await readTriggerFires(deps);
  const prev = state[input.triggerId] ?? EMPTY_STATE;
  const next: TriggerFireState = { ...prev };
  delete next.snoozedUntil;
  await writeTriggerFires(deps, { ...state, [input.triggerId]: next });
  return next;
}
