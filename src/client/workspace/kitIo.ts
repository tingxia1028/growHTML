// kitIo — the foreground-kit source-metadata seam (PLAT-LAYER §2.5 Rule C).
// KitForegroundChipHost's 自动 (clear-pin) affordance patches the active source's
// `metadata.activeKitIds` to null via `entityClient.updateSourceMetadata`; this thin
// facade relocates that IO edge out of the component so it imports no entityClient at
// runtime. (The MANUAL pick already flows through the ctx `setActiveKit` callback — a
// domain-hook seam — so only the clear-pin write needed relocating.) It is a LEAF
// module: it imports ONLY entityClient (+ the SourceRecord type its caller may
// re-export), never a view/workspace module, so it can never cycle with the workspace/ dir.
//
// BYTE-EQUIVALENT call-time pass-through — `(...args) => entityClient.updateSourceMetadata
// (...args)` — so any spy/mock on the entityClient seam still intercepts through this
// indirection.

import { entityClient } from "../data/entityClient";

export type { SourceRecord } from "../data/entityClient";

export const kitIo = {
  updateSourceMetadata: (...args: Parameters<typeof entityClient.updateSourceMetadata>) =>
    entityClient.updateSourceMetadata(...args)
};
