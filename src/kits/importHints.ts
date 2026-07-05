// Import dependency resolution (M3a — docs/design/plugin-viewer-model.md §8.7 step 2).
// React-free pure helper: given the contentType set of an incoming pack (studypack /
// svpack), decide which types need an install prompt. One rule, keyed on the catalog +
// effective-installed model — NEVER on a hardcoded contentType list:
//
//   • no provider + a core renderer → a CORE primitive → nothing to install (no hint);
//   • provider effective-installed   → nothing to do (no hint);
//   • provider NOT effective-installed → collect a hint (naming the providing plugin +
//     the kit that owns it, so the prompt can offer "install «Textbook Kit»");
//   • no provider at all              → unknown type (informational; renders inert). It
//     carries no provider, so it is NOT an installable hint — the per-note InertNote
//     affordance (M3b) handles it at render time.
//
// The write a prompt performs on accept is the SAME §8.5 install path a market install
// uses (withKitInstalled / withPluginInstalled) — this module only RESOLVES, never writes.

import { groupOwnerOf, providerOf, type CatalogEntry } from "./catalog";
import {
  effectiveInstalledPluginIds,
  isPluginEffectiveInstalled,
  type CatalogState,
  type UserKitDef
} from "./installState";

export type ImportHint = {
  /** The pack contentType that triggered the hint. */
  contentType: string;
  /** The cataloged plugin that PROVIDES it. */
  provider: CatalogEntry;
  /** The kit id to install to get this provider (FLAT: install is kit-granular — the
      provider's owning kit; undefined for a standalone plugin that installs directly). */
  kitId?: string;
  /** Always false for a hint (an installed provider yields no hint); kept so callers can
      render a uniform row shape. */
  installed: false;
};

/** Whether a provider plugin is effective-installed under an EXPLICIT state (for the
    import-preview flow, which resolves against a freshly-fetched vault state rather than
    the module store). Falls back to the module-store predicate when no state is passed. */
function providerInstalled(pluginId: string, state?: CatalogState, userKits?: readonly UserKitDef[]): boolean {
  if (!state) return isPluginEffectiveInstalled(pluginId);
  return effectiveInstalledPluginIds(state, userKits ?? []).has(pluginId);
}

/**
 * Resolve import hints for a set of contentTypes (§8.7 step 2). Returns ONE hint per
 * distinct contentType whose provider is not yet effective-installed; core primitives,
 * already-installed providers, and unknown types produce no hint. Pure over its inputs
 * (an optional explicit state/userKits for the pre-commit preview; the module store
 * otherwise), so it is unit-testable with no React and no network.
 */
export function resolveImportHints(
  contentTypes: readonly string[],
  opts?: { state?: CatalogState; userKits?: readonly UserKitDef[] }
): ImportHint[] {
  const hints: ImportHint[] = [];
  const seen = new Set<string>();
  for (const contentType of contentTypes) {
    if (seen.has(contentType)) continue;
    seen.add(contentType);
    const provider = providerOf(contentType);
    if (!provider) continue; // core primitive or unknown → nothing to install
    if (providerInstalled(provider.id, opts?.state, opts?.userKits)) continue; // already have it
    const owner = groupOwnerOf(provider.id);
    hints.push({ contentType, provider, kitId: owner?.kitId, installed: false });
  }
  return hints;
}
