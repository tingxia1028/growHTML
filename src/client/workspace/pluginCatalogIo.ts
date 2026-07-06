// pluginCatalogIo — the plugin/kit install-state data seam (PLAT-LAYER §2.5 Rule C).
// Two surfaces write/read the catalog: the Kit Manager (pluginManagerViews — mount
// `pluginPrefs()` refresh + the `putPluginCatalog()` install/uninstall write seam) and
// the note-install hint (builtinNoteTypes' InstallToView — `putPluginCatalog()` on
// 安装). Both previously called `entityClient.*` inline; this shared thin facade
// relocates those IO edges out of the components so neither imports entityClient at
// runtime. It is a LEAF module: it imports ONLY entityClient (+ the PluginPrefs type its
// callers may re-export), never a view/workspace module, so it can never cycle with the
// workspace/ or notes/ dirs.
//
// NOTE: both `pluginPrefs` and `putPluginCatalog` internally run entityClient's
// `syncInstallStateFrom` side effect (it refreshes the installState module store from the
// response). Call-time delegation preserves that side effect exactly — the facade adds no
// behavior, it only moves the call site.
//
// BYTE-EQUIVALENT call-time pass-through — `(...args) => entityClient.method(...args)` —
// so any spy/mock on the entityClient seam (both tests `vi.mock("../data/entityClient", …)`)
// still intercepts through this indirection.

import { entityClient } from "../data/entityClient";

export type { PluginPrefs } from "../data/entityClient";

export const pluginCatalogIo = {
  pluginPrefs: (...args: Parameters<typeof entityClient.pluginPrefs>) => entityClient.pluginPrefs(...args),
  putPluginCatalog: (...args: Parameters<typeof entityClient.putPluginCatalog>) =>
    entityClient.putPluginCatalog(...args)
};
