// assetUrl — a SANCTIONED re-export of the platform-funneled asset-URL builder
// (PLAT-LAYER §2.5 Rule C). `entityClient.assetUrl(id)` is NOT a data fetch: it is a
// SYNCHRONOUS `${scheme}/api/assets/${id}` string builder (already funneled through the
// platform adapter — web/desktop return `/api/assets/${id}`, a future mobile scheme swaps
// it). It is called DURING RENDER (JSX `src=`) in views.tsx / ChatMessageBody.tsx /
// builtinNoteTypes.tsx, so it MUST stay sync — it is NOT converted to async/effect.
//
// This 1-line sanctioned module lets those render surfaces import `assetUrl` from a
// sanctioned path (data/**) instead of importing entityClient directly, satisfying Rule C
// without changing render behavior. Call-time delegation `(...args) => entityClient.assetUrl
// (...args)` keeps it SYNC + preserves any spy/binding on the entityClient seam.

import { entityClient } from "./entityClient";

export const assetUrl = (...args: Parameters<typeof entityClient.assetUrl>) => entityClient.assetUrl(...args);
