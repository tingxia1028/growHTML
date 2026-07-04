import { z } from "zod";
import { recordEnvelopeSchema, triggerIdSchema } from "./common";

// —— The trigger entity (PRO-1, docs/design/proactive-learning.md §1) — the temporal
// analogue of `operation` (behavior-as-data extended to TIME): "when X, fire actionRef,
// respecting restraint". DEFINITIONS live in the entity store (triggers.jsonl, like
// operations.jsonl); the FIRE STATE (lastFiredAt / firedByDay / snoozedUntil) lives in a
// raw-JSON side file (trigger-fires.json, the operation-prefs idiom) so that the durable
// definition and the fast-moving fire state never mingle. Kept OUT of vaultEntitySchema
// (schema/index.ts) exactly like operationSchema — no generic entity flow (import/export/
// sharing) should ever sweep a trigger up by accident.
//
// PRO-1 SCOPE TRIM (build-spec delta #5): the discriminated unions below DEFINE the
// `event` when-variant and the `operation` actionRef-variant for forward-compat (PRO-2),
// but the PRO-1 evaluator (src/core/trigger/evaluate.ts) REJECTS them at fire time
// ({fire:false, suppressedBy:"unsupported-in-pro1"}) — `event` needs a memory-event hook
// that is not built, and `operation.run` needs a focus/context host so it cannot run
// headless. So the ONLY end-to-end path PRO-1 lights up is when:"schedule" +
// actionRef:"navigate". The full 6-field restraint schema is kept regardless (克制 is
// first-class, not polish).

// HH:MM in 24h, zero-padded — the LOCAL wall-clock string the client computes from
// `new Date()` (build-spec delta #1: all time-local math is CLIENT-side, never server).
const localHhmmSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected a zero-padded local HH:MM (00:00–23:59)");

// —— when: the firing condition ———————————————————————————————————————————————
// schedule — a daily local wall-clock time. The client tick fires it once per local day
// when its wall clock has crossed `atLocalTime` (and no fire is recorded for that
// localDayKey yet). This is the PRO-1 exemplar's shape.
const scheduleWhenSchema = z.object({
  kind: z.literal("schedule"),
  /** Daily local time-of-day (HH:MM) the schedule crosses. */
  atLocalTime: localHhmmSchema
});

// event — DEFINED for PRO-2 forward-compat, REJECTED by the PRO-1 evaluator. Rides over
// the memory-event stream (e.g. "N mistakes accumulated", "streak about to break"); the
// hook that would surface such events does not exist yet.
const eventWhenSchema = z.object({
  kind: z.literal("event"),
  /** The memory-event signal this fires on (PRO-2 — no hook in PRO-1). */
  signal: z.string().min(1)
});

export const triggerWhenSchema = z.discriminatedUnion("kind", [scheduleWhenSchema, eventWhenSchema]);
export type TriggerWhen = z.infer<typeof triggerWhenSchema>;

// —— actionRef: what fires ————————————————————————————————————————————————————
// navigate — deep-link a registered shell pane (headless-safe: navigateShell only asks
// the shell to swap a pane; it never needs a focus/selection context). PRO-1's exemplar
// navigates to the review panel.
const navigateActionSchema = z.object({
  kind: z.literal("navigate"),
  /** A registered shell view-kind (e.g. "review.panel") — navigateShell target. */
  target: z.string().min(1)
});

// operation — DEFINED for PRO-2 forward-compat, REJECTED by the PRO-1 evaluator. An
// operation.run needs a focus-carrying host (registry can't run one headless), so it
// cannot fire from a background tick in PRO-1.
const operationActionSchema = z.object({
  kind: z.literal("operation"),
  /** The operation id to run (PRO-2 — needs a context host in PRO-1). */
  operationId: z.string().min(1)
});

export const triggerActionRefSchema = z.discriminatedUnion("kind", [navigateActionSchema, operationActionSchema]);
export type TriggerActionRef = z.infer<typeof triggerActionRefSchema>;

// —— constraints: the 克制 restraint block (first-class, conservative defaults) ————
// Every field is a restraint the pure evaluator enforces. Defaults are intentionally
// conservative (build-spec §"Restraint defaults"): a fresh trigger nags at most twice a
// day, only when idle, never at night, and never within 3h of the last nudge.
export const triggerConstraintsSchema = z.object({
  /** Max nudges SURFACED per local day (build-spec delta #2 — counted on surface). */
  dailyCap: z.number().int().min(0).default(2),
  /** Local quiet window [start, end) as HH:MM; supports a midnight wrap (22:00→08:00). */
  quietHours: z
    .object({ start: localHhmmSchema, end: localHhmmSchema })
    .default({ start: "22:00", end: "08:00" }),
  /** Minimum minutes between two surfaced nudges FOR THIS trigger. */
  minGapMinutes: z.number().int().min(0).default(180),
  /** Only surface while the user is idle (visibility/last-activity — idleSignal). */
  onlyWhenIdle: z.boolean().default(true)
});
export type TriggerConstraints = z.infer<typeof triggerConstraintsSchema>;

// The trigger record: the recordEnvelope (id/type/timestamps/createdBy/…) + the trigger
// body. `enabled` is opt-in per trigger family (克制); `reason` is the WHY string every
// nudge must show (the queue-reason principle — "5 张浮力卡到期 · 你 19:00 常复习").
export const triggerSchema = recordEnvelopeSchema("trigger", triggerIdSchema).extend({
  name: z.string().min(1),
  description: z.string().default(""),
  /** Per-trigger opt-in switch (克制: a trigger family is off until the user turns it on). */
  enabled: z.boolean().default(false),
  when: triggerWhenSchema,
  actionRef: triggerActionRefSchema,
  /** The human WHY the nudge surfaces (queue-reason principle). Every nudge shows it. */
  reason: z.string().min(1),
  constraints: triggerConstraintsSchema.default({
    dailyCap: 2,
    quietHours: { start: "22:00", end: "08:00" },
    minGapMinutes: 180,
    onlyWhenIdle: true
  })
});
export type TriggerRecord = z.infer<typeof triggerSchema>;
