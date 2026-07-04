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

import {
  catalogKitMembers,
  defaultDisabledGroupIds,
  defaultInstalledIds,
  groupOwnerOf,
  isCataloged,
  kitCapabilityGroups,
  type KitCapabilityGroup
} from "./catalog";

// Mirrors the server's catalogState schema: null = default-installed set.
// FLAT (kit-flatten-and-core-review.md §2): install state is KIT-granular.
// `installedPlugins` survives as the INTERNAL direct-hold list for standalone plugins
// (flashcard/quiz/… — hidden infrastructure, no longer a user-facing unit) plus
// user-kit members; group-owned member plugins collapse into their owning kit via
// migrateCatalogState. `disabledGroups` is the per-kit capability-group switchboard.
export type CatalogState = {
  installedPlugins: string[] | null;
  installedKits: string[] | null;
  /** kitId → DISABLED capability-group ids. ABSENT key = the kit's group DEFAULTS
      (groups with defaultEnabled:false start off); PRESENT key (even []) = the
      explicit, materialized set — the same first-touch idiom as the null lists. */
  disabledGroups?: Record<string, string[]>;
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

// —— capability groups (FLAT §2) ————————————————————————————————————————————————

/** A kit's capability groups — catalog groups for catalog kits; user kits present each
    member as its own implicit group (so the group model is total over installed kits). */
export function kitGroupsFor(kitId: string, userKits: readonly UserKitDef[] = []): readonly KitCapabilityGroup[] {
  const user = userKits.find((k) => k.id === kitId);
  if (user) {
    return user.members.map((memberId) => ({
      id: memberId,
      name: { zh: memberId, en: memberId },
      members: [memberId]
    }));
  }
  return kitCapabilityGroups(kitId);
}

/** The DISABLED group ids for a kit under a state: the explicit per-kit list when the
    key is present, else the kit's group defaults (defaultEnabled:false groups). */
export function disabledGroupIdsFor(
  state: CatalogState,
  kitId: string,
  userKits: readonly UserKitDef[] = []
): string[] {
  const explicit = state.disabledGroups?.[kitId];
  if (explicit) return explicit;
  if (userKits.some((k) => k.id === kitId)) return []; // user kits: all members on
  return defaultDisabledGroupIds(kitId);
}

export function isKitGroupEnabled(
  state: CatalogState,
  kitId: string,
  groupId: string,
  userKits: readonly UserKitDef[] = []
): boolean {
  return !disabledGroupIdsFor(state, kitId, userKits).includes(groupId);
}

/** A kit is ENABLED iff at least one of its capability groups is enabled ("kit
    installed iff any member installed; enabled likewise" — FLAT §2). Kits with no
    groups at all count as enabled. */
export function isKitEnabled(state: CatalogState, kitId: string, userKits: readonly UserKitDef[] = []): boolean {
  const groups = kitGroupsFor(kitId, userKits);
  if (groups.length === 0) return true;
  const disabled = new Set(disabledGroupIdsFor(state, kitId, userKits));
  return groups.some((group) => !disabled.has(group.id));
}

/** Member plugin ids of a kit's ENABLED groups — the availability contribution of one
    installed kit. */
function enabledMembersOf(kitId: string, state: CatalogState, userKits: readonly UserKitDef[]): string[] {
  const groups = kitGroupsFor(kitId, userKits);
  if (groups.length === 0) return [...membersOf(kitId, userKits)];
  const disabled = new Set(disabledGroupIdsFor(state, kitId, userKits));
  return groups.filter((group) => !disabled.has(group.id)).flatMap((group) => group.members);
}

/**
 * The effective-installed plugin set (§8.3, FLAT-amended):
 *   effectiveInstalled(p) ⇔ p ∈ directPluginIds
 *                          ∨ ∃ k ∈ installedKitIds : p ∈ ENABLED-groups-members(k)
 * The kit refcount (§8.5.2) is DERIVED from this union — nothing persisted beyond the
 * two lists + the group switchboard, nothing to drift.
 */
export function effectiveInstalledPluginIds(
  state: CatalogState,
  userKits: readonly UserKitDef[] = []
): Set<string> {
  const effective = new Set(directPluginIds(state));
  for (const kitId of installedKitIds(state)) {
    for (const member of enabledMembersOf(kitId, state, userKits)) effective.add(member);
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

/** Install a kit = add its id; all default-enabled groups' members become effective. */
export function withKitInstalled(state: CatalogState, kitId: string): CatalogState {
  const next = materializeCatalogState(state);
  return { ...next, installedKits: added(next.installedKits!, kitId) };
}

/** Uninstall a kit = remove its id (+ drop its group switchboard); members survive iff
    another installed kit still contains them OR they are directly installed (derived,
    §8.5.2). */
export function withKitUninstalled(state: CatalogState, kitId: string): CatalogState {
  const next = materializeCatalogState(state);
  const disabledGroups = { ...(next.disabledGroups ?? {}) };
  delete disabledGroups[kitId];
  return { ...next, installedKits: removed(next.installedKits!, kitId), disabledGroups };
}

// —— capability-group transitions (FLAT §2) ————————————————————————————————————

/** Write one kit's explicit disabled-group list (materializes the per-kit key —
    the group analogue of materializeCatalogState's first-touch rule). */
function withDisabledGroups(state: CatalogState, kitId: string, disabled: string[]): CatalogState {
  return { ...state, disabledGroups: { ...(state.disabledGroups ?? {}), [kitId]: disabled } };
}

export function withKitGroupEnabled(
  state: CatalogState,
  kitId: string,
  groupId: string,
  userKits: readonly UserKitDef[] = []
): CatalogState {
  const disabled = disabledGroupIdsFor(state, kitId, userKits).filter((id) => id !== groupId);
  return withDisabledGroups(state, kitId, disabled);
}

export function withKitGroupDisabled(
  state: CatalogState,
  kitId: string,
  groupId: string,
  userKits: readonly UserKitDef[] = []
): CatalogState {
  const disabled = disabledGroupIdsFor(state, kitId, userKits);
  return withDisabledGroups(state, kitId, disabled.includes(groupId) ? disabled : [...disabled, groupId]);
}

/** Kit-level enable = back to the kit's GROUP DEFAULTS (drop the explicit key). */
export function withKitEnabled(state: CatalogState, kitId: string): CatalogState {
  const disabledGroups = { ...(state.disabledGroups ?? {}) };
  delete disabledGroups[kitId];
  return { ...state, disabledGroups };
}

/** Kit-level disable = every capability group off (installed but dormant — create
    affordances hidden, rendering untouched; reversible without uninstalling). */
export function withKitDisabled(state: CatalogState, kitId: string, userKits: readonly UserKitDef[] = []): CatalogState {
  return withDisabledGroups(
    state,
    kitId,
    kitGroupsFor(kitId, userKits).map((group) => group.id)
  );
}

// —— FLAT migration: per-plugin install state → per-kit (§2, write-back on first load) —
// FROZEN legacy tables — the pre-FLAT catalog shape, kept only so old persisted states
// migrate with zero loss. Never extend these; new capability ships as groups.

/** Old subject KITS → their new per-subject capability group inside the Textbook Kit. */
export const LEGACY_KIT_GROUP_ALIASES: Record<string, { kitId: string; groupId: string }> = {
  "subject-english": { kitId: "textbook-learning", groupId: "subject-english" },
  "subject-math": { kitId: "textbook-learning", groupId: "subject-math" },
  "subject-history-geo": { kitId: "textbook-learning", groupId: "subject-history-geo" }
};

/** Old kit membership (the pre-FLAT `members[]`), for old-effective computation. */
const LEGACY_KIT_MEMBERS: Record<string, readonly string[]> = {
  "textbook-learning": ["explanation", "practice", "mistake", "review-pack", "textbook-language"],
  "subject-english": ["subject-vocab", "flashcard"],
  "subject-math": ["subject-formula", "mistake", "quiz"],
  "subject-history-geo": ["subject-timeline"]
};

/** The pre-FLAT DEFAULT-INSTALLED plugin list (what a null installedPlugins meant when
    an old vault materialized only its kit list). */
const LEGACY_DEFAULT_PLUGIN_IDS: readonly string[] = [
  "flashcard",
  "quiz",
  "bookmark",
  "diagrams",
  "table-viewer",
  "explanation",
  "practice",
  "mistake",
  "review-pack",
  "textbook-language"
];

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id) => b.includes(id));

/**
 * Collapse a pre-FLAT per-plugin install state into the kit-granular model:
 *   • legacy subject KIT ids → the Textbook Kit + that subject group enabled;
 *   • DIRECT holds of group-owned member plugins → owning kit installed + group
 *     enabled, the direct hold dropped ("kit installed iff any member installed");
 *   • a previously NOT-effective member → its group starts DISABLED;
 *   • non-group-owned legacy kit members (flashcard/quiz refs) keep their
 *     effectiveness as direct holds — effective-installed parity before/after.
 * Idempotent: the output contains no legacy kit ids and no group-owned direct holds,
 * so a second run is the identity (`changed: false`). A pristine null/null state is
 * untouched (the new defaults already reproduce the old behavior).
 */
export function migrateCatalogState(
  state: CatalogState,
  userKits: readonly UserKitDef[] = []
): { state: CatalogState; changed: boolean } {
  if (state.installedPlugins === null && state.installedKits === null) return { state, changed: false };
  // Old semantics of the persisted lists: null = the OLD default set of that kind.
  const pluginsList = state.installedPlugins ?? [...LEGACY_DEFAULT_PLUGIN_IDS];
  const kitsList = state.installedKits ?? defaultInstalledIds("kit");
  const legacyKits = kitsList.filter((id) => LEGACY_KIT_GROUP_ALIASES[id]);
  const ownedDirect = pluginsList.filter((id) => groupOwnerOf(id));
  if (legacyKits.length === 0 && ownedDirect.length === 0) return { state, changed: false };

  // Old-effective set (legacy union semantics — legacy membership for legacy/old kits).
  const oldEffective = new Set(pluginsList);
  for (const kitId of kitsList) {
    const user = userKits.find((k) => k.id === kitId);
    const members = user ? user.members : LEGACY_KIT_MEMBERS[kitId] ?? catalogKitMembers(kitId);
    for (const member of members) oldEffective.add(member);
  }

  // Kit list: legacy ids map onto their target kit; owners of direct-held members join.
  const installedKits: string[] = [];
  const addKit = (id: string) => {
    if (!installedKits.includes(id)) installedKits.push(id);
  };
  for (const kitId of kitsList) addKit(LEGACY_KIT_GROUP_ALIASES[kitId]?.kitId ?? kitId);
  for (const pluginId of ownedDirect) addKit(groupOwnerOf(pluginId)!.kitId);

  // Group switchboard: a group is enabled iff one of its members was old-effective;
  // keys matching the kit's defaults stay implicit (canonical form).
  const disabledGroups: Record<string, string[]> = { ...(state.disabledGroups ?? {}) };
  for (const kitId of installedKits) {
    const groups = kitCapabilityGroups(kitId);
    if (groups.length === 0) continue;
    const disabled = groups
      .filter((group) => !group.members.some((member) => oldEffective.has(member)))
      .map((group) => group.id);
    if (sameSet(disabled, defaultDisabledGroupIds(kitId))) delete disabledGroups[kitId];
    else disabledGroups[kitId] = disabled;
  }

  // Direct holds: group-owned ids collapse into their kit; non-owned members of a
  // dissolving legacy kit keep their effectiveness as direct holds (zero loss).
  const installedPlugins = pluginsList.filter((id) => !groupOwnerOf(id));
  for (const legacyKitId of legacyKits) {
    for (const member of LEGACY_KIT_MEMBERS[legacyKitId] ?? []) {
      if (!groupOwnerOf(member) && !installedPlugins.includes(member)) installedPlugins.push(member);
    }
  }

  return { state: { installedPlugins, installedKits, disabledGroups }, changed: true };
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
  currentUserKits = Array.isArray(next.userKits)
    ? next.userKits.filter(
        (k): k is UserKitDef =>
          !!k && typeof k === "object" && typeof (k as UserKitDef).id === "string" && Array.isArray((k as UserKitDef).members)
      )
    : [];
  // FLAT: derive only ever over the MIGRATED shape. The server write-back is the
  // durable migration; this is the defensive client-side half (stale caches, tests).
  currentState = migrateCatalogState(next.catalogState ?? EMPTY_CATALOG_STATE, currentUserKits).state;
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
    kit's id sits in installedKits like any catalog kit, §8.3). LEGACY subject-kit ids
    (persisted pins, detection tables) resolve through their capability-group alias:
    "installed" ⇔ the Textbook Kit is installed AND that subject group is enabled — so
    the Subject Auto-Switch gate keeps working across the flatten. */
export function isKitInstalled(kitId: string): boolean {
  const alias = LEGACY_KIT_GROUP_ALIASES[kitId];
  if (alias) {
    return (
      installedKitIds(currentState).includes(alias.kitId) &&
      isKitGroupEnabled(currentState, alias.kitId, alias.groupId, currentUserKits)
    );
  }
  return installedKitIds(currentState).includes(kitId);
}
