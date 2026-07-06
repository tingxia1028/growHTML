// mediaIo — the media-asset import seam (PLAT-LAYER §2.5 Rule C). The built-in media note
// editors (image/audio/video MediaEditor) call `entityClient.importAsset(path)` — a REAL
// async IO edge (POSTs the picked local file to /api/assets/local-file) — inline; this thin
// facade relocates that edge out of builtinNoteTypes so the component imports no entityClient
// at runtime. (The sibling render-time `assetUrl` builder is SYNC and lives in its own
// sanctioned re-export, data/assetUrl.ts — do not fold it in here.) It is a LEAF module: it
// imports ONLY entityClient (+ the record TYPE its caller may re-export), never a
// view/note/workspace module.
//
// BYTE-EQUIVALENT call-time pass-through — `(...args) => entityClient.importAsset(...args)` —
// so any spy/mock on the entityClient seam still intercepts through this indirection.

import { entityClient } from "../data/entityClient";

export type { AssetRecord } from "../data/entityClient";

export const mediaIo = {
  importAsset: (...args: Parameters<typeof entityClient.importAsset>) => entityClient.importAsset(...args)
};
