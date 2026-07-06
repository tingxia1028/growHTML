// triggerIo — the trigger family's data seam (PLAT-LAYER §2.5 Rule C). The nudge surface
// (NudgeToast: snooze/dismiss) and the proactive tick's default IO edge (proactiveTick's
// defaultTickIo: the trigger definitions + fire-state read + the fire-on-surface record)
// previously called `entityClient.*` inline; this thin facade relocates those IO edges out
// of those modules so neither imports entityClient at runtime. It is a LEAF module: it
// imports ONLY entityClient (+ the record TYPES its callers re-export), never a
// view/workspace module, so it can never cycle with the workspace/ dir.
//
// Every method is a BYTE-EQUIVALENT pass-through (same args, same return type) that
// delegates at CALL TIME — `(...args) => entityClient.method(...args)` — NOT a captured
// binding. This matters for the tests: NudgeToast.test.tsx `vi.mock("../data/entityClient",
// …)` with `{ entityClient: { snoozeTrigger, dismissTrigger } }`, and a call-time lookup
// lets that mock still intercept through this indirection.

import { entityClient } from "../data/entityClient";

// Record types re-exported so the trigger surfaces import their shapes from the same seam
// they now call (no direct entityClient TYPE edge needed either).
export type {
  TriggerRecord,
  TriggerFiresState,
  TriggerFireState
} from "../data/entityClient";

export const triggerIo = {
  // —— Definitions + fire-state reads (proactiveTick's defaultTickIo) ——
  triggers: (...args: Parameters<typeof entityClient.triggers>) => entityClient.triggers(...args),
  triggerFires: (...args: Parameters<typeof entityClient.triggerFires>) => entityClient.triggerFires(...args),

  // —— Fire-on-surface record (delta #2) ——
  recordTriggerFire: (...args: Parameters<typeof entityClient.recordTriggerFire>) =>
    entityClient.recordTriggerFire(...args),

  // —— Restraint mutations (NudgeToast: 稍后再说 / 关闭) ——
  snoozeTrigger: (...args: Parameters<typeof entityClient.snoozeTrigger>) => entityClient.snoozeTrigger(...args),
  dismissTrigger: (...args: Parameters<typeof entityClient.dismissTrigger>) => entityClient.dismissTrigger(...args)
};
