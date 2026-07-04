// Built-in trigger registry (PRO-1) — the CODE-registered triggers, the same way built-in
// operations/note-types are CODE while user ones are entities (kernel law). A built-in is a
// trigger DEFINITION plus an optional ARMING GUARD (delta #6): a predicate the tick checks
// before the trigger participates at all, so a fresh vault isn't nagged before there is any
// real signal (e.g. the review-push arms only after graded history exists). The tick unions
// getBuiltInTriggers() with the entity-store user triggers and evaluates them all with the
// ONE pure evaluator.
//
// PRO-1 registers exactly one built-in (the review-push, PRO1.6). The registry is set up
// here so the tick (PRO1.4) can read it before that exemplar lands.

import type { TriggerRecord } from "../data/entityClient";

/** Inputs an arming guard may consult (extended as built-ins need more signals). */
export type ArmingSignals = {
  /** The client-computed review-due readout + whether real graded history exists. */
  review: { due: number; hasGradedHistory: boolean };
};

export type BuiltInTrigger = {
  /** The full trigger definition (the same shape the entity store holds). */
  trigger: TriggerRecord;
  /**
   * Optional pre-evaluation gate (delta #6). Return false to keep the trigger OUT of the
   * candidate set entirely (before any restraint runs) — e.g. no graded history yet. Absent
   * ⇒ always armed (the plain evaluator gates it).
   */
  arm?: (signals: ArmingSignals) => boolean;
};

const builtIns = new Map<string, BuiltInTrigger>();

/** Register (or replace) a built-in trigger by its definition id. */
export function registerBuiltInTrigger(entry: BuiltInTrigger): void {
  builtIns.set(entry.trigger.id, entry);
}

/** Every registered built-in (insertion order). */
export function getBuiltInTriggers(): BuiltInTrigger[] {
  return [...builtIns.values()];
}

/** Whether a built-in's arming guard passes (no guard ⇒ armed). */
export function isTriggerArmed(entry: BuiltInTrigger, signals: ArmingSignals): boolean {
  return entry.arm ? entry.arm(signals) : true;
}

/** Test seam: clear the registry between cases. */
export function resetBuiltInTriggersForTests(): void {
  builtIns.clear();
}
