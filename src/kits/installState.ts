// Market install state (docs/design/plugin-viewer-model.md §8.3) — the F4
// "effective-installed" model that replaces the single-active-kit gate as the
// AVAILABILITY filter (activation stays as per-source FOREGROUNDING only).
//
// Persistence lives in the per-vault plugin-prefs.json (`catalogState` + `userKits`,
// server schema in src/server/services/workspace.ts). This module is the React-free
// CLIENT-RUNTIME half: pure derivation + transition helpers over that state, plus a
// module-scope store (the same pattern as clientContext's disabled set) that
// entityClient syncs from every plugin-prefs round-trip, so pure selectors
// (kitSurfaceItems, the slash adapter, the viewer resolver) can read it without
// threading React state through every caller.
//
// Back-compat default (locked, §8.3): null lists mean "the DEFAULT-INSTALLED set" —
// every bundled entry is defaultInstalled:true, so an untouched vault behaves
// byte-for-byte as today. The first explicit install/uninstall MATERIALIZES the
// effective set into concrete arrays and then applies the delta, so catalog entries
// added in later app versions don't silently auto-install into a curating vault.

import { catalogKitMembers, defaultInstalledIds, isCataloged } from "./catalog";

// Mirrors the server's catalogState schema: null = default-installed set.
export type CatalogState = {
  installedPlugins: string[] | null;
  installedKits: string[] | null;
};

// Mirrors the server's userKitSchema (§8.3) — typed since M1.
export type UserKitDef = {
  id: string; // "user:" prefix, e.g. "user:exam-prep"
  name: string;
  description?: string;
  members: string[]; // cataloged plugin ids
};

export const EMPTY_CATALOG_STATE: CatalogState = { installedPlugins: null, installedKits: null };

// —— pure derivation (§8.3) ————————————————————————————————————————————————

/** Installed kit ids: the explicit list, else the default-installed kits. */
export function installedKitIds(state: CatalogState): string[] {
  return state.installedKits ?? defaultInstalledIds("kit");
}

/** Directly-installed plugin ids: the explicit list, else the default-installed plugins. */
export function directPluginIds(state: CatalogState): string[] {
  return state.installedPlugins ?? defaultInstalledIds("plugin");
}

/** Member plugin ids of a kit id — catalog kits ∪ userKits. */
function membersOf(kitId: string, userKits: readonly UserKitDef[]): readonly string[] {
  const user = userKits.find((k) => k.id === kitId);
  return user ? user.members : catalogKitMembers(kitId);
}

/**
 * The effective-installed plugin set (§8.3):
 *   effectiveInstalled(p) ⇔ p ∈ directPluginIds ∨ ∃ k ∈ installedKitIds : p ∈ members(k)
 * The kit refcount (§8.5.2) is DERIVED from this union — nothing persisted beyond the
 * two lists, nothing to drift.
 */
export function effectiveInstalledPluginIds(
  state: CatalogState,
  userKits: readonly UserKitDef[] = []
): Set<string> {
  const effective = new Set(directPluginIds(state));
  for (const kitId of installedKitIds(state)) {
    for (const member of membersOf(kitId, userKits)) effective.add(member);
  }
  return effective;
}

// —— pure transitions (each MATERIALIZES null → concrete arrays first, §8.3) ————

/** Concrete arrays for both lists (identity when already materialized). */
export function materializeCatalogState(state: CatalogState): CatalogState {
  return {
    installedPlugins: state.installedPlugins ?? defaultInstalledIds("plugin"),
    installedKits: state.installedKits ?? defaultInstalledIds("kit")
  };
}

const added = (list: string[], id: string) => (list.includes(id) ? list : [...list, id]);
const removed = (list: string[], id: string) => list.filter((x) => x !== id);

/** Add a DIRECT plugin hold (a market/import install — §8.5.1/§8.7 share this write). */
export function withPluginInstalled(state: CatalogState, pluginId: string): CatalogState {
  const next = materializeCatalogState(state);
  return { ...next, installedPlugins: added(next.installedPlugins!, pluginId) };
}

/** Remove the DIRECT hold only — a member still held by an installed kit stays
    effective-installed (§8.5.2 "installed via «kit»"). */
export function withPluginUninstalled(state: CatalogState, pluginId: string): CatalogState {
  const next = materializeCatalogState(state);
  return { ...next, installedPlugins: removed(next.installedPlugins!, pluginId) };
}

/** Install a kit = add its id; all members become effective via the union. */
export function withKitInstalled(state: CatalogState, kitId: string): CatalogState {
  const next = materializeCatalogState(state);
  return { ...next, installedKits: added(next.installedKits!, kitId) };
}

/** Uninstall a kit = remove its id; members survive iff another installed kit still
    contains them OR they are directly installed (derived, §8.5.2). */
export function withKitUninstalled(state: CatalogState, kitId: string): CatalogState {
  const next = materializeCatalogState(state);
  return { ...next, installedKits: removed(next.installedKits!, kitId) };
}

// —— provenance / refcount views (for the manage UI, §8.5.2) ————————————————

export type PluginHolds = {
  /** Directly in installedPlugins. */
  direct: boolean;
  /** Installed kits whose members include the plugin. */
  viaKits: string[];
};

/** Why a plugin is effective-installed (direct hold and/or holding kits). */
export function holdsOf(
  pluginId: string,
  state: CatalogState,
  userKits: readonly UserKitDef[] = []
): PluginHolds {
  const direct = directPluginIds(state).includes(pluginId);
  const viaKits = installedKitIds(state).filter((kitId) => membersOf(kitId, userKits).includes(pluginId));
  return { direct, viaKits };
}

export type KitRemovalRow = {
  pluginId: string;
  /** true = the member stays effective-installed after the kit is removed. */
  kept: boolean;
  /** Why it is kept: "direct" and/or other holding kit ids. Empty when removed. */
  keptBy: string[];
};

/** Per-member outcome of uninstalling a kit — the §8.5.2 confirmation rows
    ("Quiz — kept (also in «Exam Prep»)" / "Explanation — removed"). */
export function kitRemovalOutcome(
  kitId: string,
  state: CatalogState,
  userKits: readonly UserKitDef[] = []
): KitRemovalRow[] {
  const after = withKitUninstalled(state, kitId);
  return membersOf(kitId, userKits).map((pluginId) => {
    const holds = holdsOf(pluginId, after, userKits);
    const keptBy = [...(holds.direct ? ["direct"] : []), ...holds.viaKits];
    return { pluginId, kept: keptBy.length > 0, keptBy };
  });
}

// —— the module-scope runtime store (the clientContext disabled-set pattern) ————
// entityClient.pluginPrefs()/putPluginPrefs()/putPluginCatalog() call syncInstallState
// with every server response, so any prefs round-trip refreshes this store. Defaults
// (never synced) = null state = default-installed set = today's behavior.

let currentState: CatalogState = EMPTY_CATALOG_STATE;
let currentUserKits: UserKitDef[] = [];

export function syncInstallState(next: { catalogState?: CatalogState | null; userKits?: unknown }): void {
  currentState = next.catalogState ?? EMPTY_CATALOG_STATE;
  currentUserKits = Array.isArray(next.userKits)
    ? next.userKits.filter(
        (k): k is UserKitDef =>
          !!k && typeof k === "object" && typeof (k as UserKitDef).id === "string" && Array.isArray((k as UserKitDef).members)
      )
    : [];
}

/** Test hook — back to the pristine default-installed store. */
export function resetInstallState(): void {
  currentState = EMPTY_CATALOG_STATE;
  currentUserKits = [];
}

/** Snapshot for the market view (state + userKits + the derived sets — null defaults
    already resolved, so the view never re-implements the default-installed rule). */
export function installStateSnapshot(): {
  catalogState: CatalogState;
  userKits: readonly UserKitDef[];
  effectivePluginIds: Set<string>;
  installedKitIds: string[];
} {
  return {
    catalogState: currentState,
    userKits: currentUserKits,
    effectivePluginIds: effectiveInstalledPluginIds(currentState, currentUserKits),
    installedKitIds: installedKitIds(currentState)
  };
}

/**
 * THE F4 availability predicate. Cataloged plugin → effective-installed per the union;
 * uncataloged id (core primitives, test kits, absent owner) → always available
 * (nothing to install). Selectors (kitSurfaceItems / slash adapter / viewer resolver)
 * call this instead of gating on the single active kit.
 */
export function isPluginEffectiveInstalled(pluginId: string | undefined): boolean {
  if (!pluginId || !isCataloged(pluginId)) return true;
  return effectiveInstalledPluginIds(currentState, currentUserKits).has(pluginId);
}

/** Whether a kit id is in the installed set (catalog kits and user kits alike — a user
    kit's id sits in installedKits like any catalog kit, §8.3). */
export function isKitInstalled(kitId: string): boolean {
  return installedKitIds(currentState).includes(kitId);
}
