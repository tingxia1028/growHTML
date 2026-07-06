// operationIo — the operation family's data seam (PLAT-LAYER §2.5 Rule C). The Operation
// manager view (the `operation.manager` pane in operationViews) previously called
// `entityClient.*` inline for its four writes (create / update / delete an Operation +
// save the operation-prefs); this thin facade relocates those IO edges out of the
// component so no component imports entityClient at runtime. It is a LEAF module: it
// imports ONLY entityClient (+ the record TYPES its caller re-exports), never a
// view/workspace module, so it can never cycle with the workspace/ dir.
//
// Every method is a BYTE-EQUIVALENT pass-through (same args, same return type) that
// delegates at CALL TIME — `(...args) => entityClient.method(...args)` — NOT a captured
// binding. This matters for the tests: they `vi.mock("../data/entityClient", …)` (spread
// actual + override these four fns), and a call-time lookup lets that mock still intercept
// through this indirection.
//
// FACADE-SCOPE decision (§2.5 slice 8c, overriding the plan doc's "extend
// useOperationDomain" suggestion): this is a FACADE for the four entityClient WRITES only,
// consistent with 8a/8b — zero WorkspaceContextValue interface change, no domain-surface /
// render-guard risk. The view KEEPS its existing `ctx.refreshOperations()` refresh + its
// `ctx.saveActionPrefs` surface writes exactly as before; only the four `entityClient.X(…)`
// call expressions move behind this seam.

import { entityClient } from "../data/entityClient";

// Record types re-exported so the operation view imports its shapes from the same seam it
// now calls (no direct entityClient TYPE edge needed either).
export type {
  OperationInput,
  OperationPrefs,
  OperationRecord,
  OperationVariable
} from "../data/entityClient";

export const operationIo = {
  createOperation: (...args: Parameters<typeof entityClient.createOperation>) => entityClient.createOperation(...args),
  updateOperation: (...args: Parameters<typeof entityClient.updateOperation>) => entityClient.updateOperation(...args),
  deleteOperation: (...args: Parameters<typeof entityClient.deleteOperation>) => entityClient.deleteOperation(...args),
  saveOperationPrefs: (...args: Parameters<typeof entityClient.saveOperationPrefs>) =>
    entityClient.saveOperationPrefs(...args)
};
