// anchorIo — the anchor-materialization data seam (PLAT-LAYER §2.5 Rule C). FocusProvider's
// `materializeAnchor` creates a stored Anchor lazily from a draft via `createAnchor`, which
// is a DI DEFAULT PARAM (tests inject their own). This 3-line leaf facade holds the real
// default so FocusContext.tsx imports no entityClient at runtime — the DI-injection seam is
// unchanged (callers/tests still pass their own createAnchor). FocusProvider is BELOW
// WorkspaceContext in the tree, so this edge cannot route through ctx (use-before-provider);
// a dedicated leaf Io is the correct destination.
//
// BYTE-EQUIVALENT call-time pass-through — `(...args) => entityClient.createAnchor(...args)` —
// so any spy/mock on the entityClient seam still intercepts through this indirection.

import { entityClient } from "../data/entityClient";

export const anchorIo = {
  createAnchor: (...args: Parameters<typeof entityClient.createAnchor>) => entityClient.createAnchor(...args)
};
