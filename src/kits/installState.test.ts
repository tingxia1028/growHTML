// Install-state unit tests (M1 §8.3/§8.5.2 + F4, FLAT-amended per
// docs/design/kit-flatten-and-core-review.md §2): the null back-compat default, the
// effective-installed union over ENABLED capability groups, materialize-on-first-touch,
// group toggles, the kit-granular FLAT migration (idempotent, zero-loss write-back
// shape), and the legacy subject-kit aliases.
import { afterEach, describe, expect, it } from "vitest";
import { registerCatalogEntry, resetCatalog, defaultInstalledIds } from "./catalog";
import {
  EMPTY_CATALOG_STATE,
  disabledGroupIdsFor,
  effectiveInstalledPluginIds,
  holdsOf,
  installStateSnapshot,
  isKitEnabled,
  isKitGroupEnabled,
  isKitInstalled,
  isPluginEffectiveInstalled,
  kitGroupsFor,
  kitRemovalOutcome,
  materializeCatalogState,
  migrateCatalogState,
  resetInstallState,
  syncInstallState,
  withKitDisabled,
  withKitEnabled,
  withKitGroupDisabled,
  withKitGroupEnabled,
  withKitInstalled,
  withKitUninstalled,
  withPluginInstalled,
  withPluginUninstalled,
  type CatalogState
} from "./installState";

const TEXTBOOK = "textbook-learning";
const BASE_GROUPS = ["explanation", "practice", "mistake", "review-pack", "textbook-language"];
const SUBJECT_GROUPS = ["subject-english", "subject-math", "subject-history-geo"];
const STANDALONE_PLUGINS = ["flashcard", "quiz", "bookmark", "diagrams", "table-viewer"];
// The pre-FLAT materialized default direct list (what old vaults' plugin-prefs carry).
const LEGACY_DEFAULT_PLUGINS = [...STANDALONE_PLUGINS, ...BASE_GROUPS];

afterEach(() => {
  resetInstallState();
  resetCatalog();
});

describe("effective-installed derivation (§8.3 × FLAT groups)", () => {
  it("null lists = the DEFAULT set: standalone plugins + the kit's default-ENABLED groups", () => {
    const effective = effectiveInstalledPluginIds(EMPTY_CATALOG_STATE);
    for (const id of STANDALONE_PLUGINS) expect(effective.has(id), id).toBe(true);
    // Base capability groups on by default…
    for (const id of BASE_GROUPS) expect(effective.has(id), id).toBe(true);
    // …the opt-in per-subject groups off by default (the old NOT-installed subject kits).
    expect(effective.has("subject-vocab")).toBe(false);
    expect(effective.has("subject-formula")).toBe(false);
    expect(effective.has("subject-timeline")).toBe(false);
  });

  it("union: direct holds ∪ enabled-group members of installed kits (catalog + user kits)", () => {
    const state = { installedPlugins: ["flashcard"], installedKits: [TEXTBOOK] };
    const effective = effectiveInstalledPluginIds(state);
    expect(effective.has("flashcard")).toBe(true); // direct
    expect(effective.has("practice")).toBe(true); // via an enabled group
    expect(effective.has("quiz")).toBe(false); // neither
    expect(effective.has("subject-vocab")).toBe(false); // group defaults off

    const userKits = [{ id: "user:exam", name: "Exam", members: ["quiz"] }];
    const withUser = effectiveInstalledPluginIds(
      { installedPlugins: [], installedKits: ["user:exam"] },
      userKits
    );
    expect(withUser.has("quiz")).toBe(true); // user kits participate uniformly
  });

  it("a DISABLED group's members leave the effective set (create gating only)", () => {
    const base: CatalogState = { installedPlugins: [], installedKits: [TEXTBOOK] };
    expect(effectiveInstalledPluginIds(base).has("practice")).toBe(true);
    const off = withKitGroupDisabled(base, TEXTBOOK, "practice");
    expect(effectiveInstalledPluginIds(off).has("practice")).toBe(false);
    expect(effectiveInstalledPluginIds(off).has("explanation")).toBe(true); // others untouched
  });

  it("materializes null → the concrete default arrays (first-touch semantics)", () => {
    const materialized = materializeCatalogState(EMPTY_CATALOG_STATE);
    expect(materialized.installedPlugins).toEqual(defaultInstalledIds("plugin"));
    expect(materialized.installedKits).toEqual(defaultInstalledIds("kit"));
    // Identity when already concrete.
    const concrete = { installedPlugins: ["a"], installedKits: [] };
    expect(materializeCatalogState(concrete)).toEqual(concrete);
  });
});

describe("capability groups (FLAT §2)", () => {
  it("kitGroupsFor: catalog groups for the Textbook Kit; per-member implicit groups for user kits", () => {
    const groups = kitGroupsFor(TEXTBOOK);
    expect(groups.map((g) => g.id)).toEqual([...BASE_GROUPS, ...SUBJECT_GROUPS]);
    const userGroups = kitGroupsFor("user:k", [{ id: "user:k", name: "K", members: ["quiz", "flashcard"] }]);
    expect(userGroups.map((g) => g.id)).toEqual(["quiz", "flashcard"]);
    expect(userGroups[0].members).toEqual(["quiz"]);
  });

  it("absent disabledGroups key = the kit's group DEFAULTS; present key = explicit", () => {
    const state: CatalogState = { installedPlugins: [], installedKits: [TEXTBOOK] };
    expect(disabledGroupIdsFor(state, TEXTBOOK)).toEqual(SUBJECT_GROUPS);
    expect(isKitGroupEnabled(state, TEXTBOOK, "practice")).toBe(true);
    expect(isKitGroupEnabled(state, TEXTBOOK, "subject-math")).toBe(false);
    const explicit = { ...state, disabledGroups: { [TEXTBOOK]: [] } };
    expect(isKitGroupEnabled(explicit, TEXTBOOK, "subject-math")).toBe(true);
  });

  it("group toggles materialize the per-kit key and are idempotent set ops", () => {
    const base: CatalogState = { installedPlugins: [], installedKits: [TEXTBOOK] };
    const on = withKitGroupEnabled(base, TEXTBOOK, "subject-english");
    // Materialized from the defaults minus the enabled group.
    expect(on.disabledGroups?.[TEXTBOOK]).toEqual(["subject-math", "subject-history-geo"]);
    expect(effectiveInstalledPluginIds(on).has("subject-vocab")).toBe(true);
    expect(withKitGroupEnabled(on, TEXTBOOK, "subject-english")).toEqual(on);
    const off = withKitGroupDisabled(on, TEXTBOOK, "subject-english");
    expect(off.disabledGroups?.[TEXTBOOK]).toEqual(["subject-math", "subject-history-geo", "subject-english"]);
    expect(withKitGroupDisabled(off, TEXTBOOK, "subject-english")).toEqual(off);
  });

  it("kit-level disable = every group off; enable = back to the group defaults", () => {
    const base: CatalogState = { installedPlugins: [], installedKits: [TEXTBOOK] };
    const off = withKitDisabled(base, TEXTBOOK);
    expect(isKitEnabled(off, TEXTBOOK)).toBe(false);
    for (const id of BASE_GROUPS) expect(effectiveInstalledPluginIds(off).has(id), id).toBe(false);
    const back = withKitEnabled(off, TEXTBOOK);
    expect(back.disabledGroups?.[TEXTBOOK]).toBeUndefined(); // defaults again
    expect(isKitEnabled(back, TEXTBOOK)).toBe(true);
    expect(effectiveInstalledPluginIds(back).has("practice")).toBe(true);
  });

  it("kit uninstall drops the kit's group switchboard", () => {
    const state = withKitGroupEnabled(
      { installedPlugins: [], installedKits: [TEXTBOOK] },
      TEXTBOOK,
      "subject-math"
    );
    const gone = withKitUninstalled(state, TEXTBOOK);
    expect(gone.installedKits).toEqual([]);
    expect(gone.disabledGroups?.[TEXTBOOK]).toBeUndefined();
  });
});

describe("transitions (§8.5)", () => {
  it("the FIRST explicit uninstall materializes, then applies the delta", () => {
    const next = withPluginUninstalled(EMPTY_CATALOG_STATE, "quiz");
    expect(next.installedPlugins).toEqual(defaultInstalledIds("plugin").filter((id) => id !== "quiz"));
    expect(next.installedKits).toEqual(defaultInstalledIds("kit")); // untouched but concrete
    expect(effectiveInstalledPluginIds(next).has("quiz")).toBe(false);
  });

  it("install/uninstall are idempotent set ops", () => {
    const base = { installedPlugins: [] as string[], installedKits: [] as string[] };
    const once = withPluginInstalled(base, "quiz");
    expect(withPluginInstalled(once, "quiz").installedPlugins).toEqual(["quiz"]);
    const kit = withKitInstalled(base, TEXTBOOK);
    expect(withKitInstalled(kit, TEXTBOOK).installedKits).toEqual([TEXTBOOK]);
    expect(withKitUninstalled(kit, TEXTBOOK).installedKits).toEqual([]);
  });

  it("kit uninstall keeps a member that is directly held (§8.5.2 refcount, derived)", () => {
    const state = { installedPlugins: ["practice"], installedKits: [TEXTBOOK] };
    const next = withKitUninstalled(state, TEXTBOOK);
    const effective = effectiveInstalledPluginIds(next);
    expect(effective.has("practice")).toBe(true); // direct hold survives
    expect(effective.has("explanation")).toBe(false); // kit-only member removed
  });
});

describe("holds + kit-removal outcome (§8.5.2, over the flattened members)", () => {
  it("holdsOf names the provenance (direct / via kits)", () => {
    const state = { installedPlugins: ["practice"], installedKits: [TEXTBOOK] };
    expect(holdsOf("practice", state)).toEqual({ direct: true, viaKits: [TEXTBOOK] });
    expect(holdsOf("explanation", state)).toEqual({ direct: false, viaKits: [TEXTBOOK] });
    expect(holdsOf("quiz", state)).toEqual({ direct: false, viaKits: [] });
  });

  it("kitRemovalOutcome: removed vs kept-with-reason per member (8 members post-merge)", () => {
    const userKits = [{ id: "user:second", name: "Second", members: ["explanation"] }];
    const state = {
      installedPlugins: ["practice"],
      installedKits: [TEXTBOOK, "user:second"]
    };
    const rows = kitRemovalOutcome(TEXTBOOK, state, userKits);
    const byId = Object.fromEntries(rows.map((r) => [r.pluginId, r]));
    expect(byId["practice"]).toEqual({ pluginId: "practice", kept: true, keptBy: ["direct"] });
    expect(byId["explanation"]).toEqual({ pluginId: "explanation", kept: true, keptBy: ["user:second"] });
    expect(byId["mistake"]).toEqual({ pluginId: "mistake", kept: false, keptBy: [] });
    // 5 base members + the 3 merged subject exemplars.
    expect(rows).toHaveLength(8);
  });
});

describe("FLAT migration — per-plugin installState → per-kit (§2)", () => {
  it("a pristine null/null state is untouched (new defaults reproduce old behavior)", () => {
    const { state, changed } = migrateCatalogState(EMPTY_CATALOG_STATE);
    expect(changed).toBe(false);
    expect(state).toBe(EMPTY_CATALOG_STATE);
  });

  it("an already-flat state is untouched (no legacy kit ids, no group-owned direct holds)", () => {
    const flat: CatalogState = {
      installedPlugins: ["flashcard"],
      installedKits: [TEXTBOOK],
      disabledGroups: { [TEXTBOOK]: ["practice", ...SUBJECT_GROUPS] }
    };
    const { state, changed } = migrateCatalogState(flat);
    expect(changed).toBe(false);
    expect(state).toBe(flat);
  });

  it("a materialized pre-FLAT default vault collapses losslessly (direct member holds → the kit)", () => {
    const old: CatalogState = { installedPlugins: [...LEGACY_DEFAULT_PLUGINS], installedKits: [TEXTBOOK] };
    const before = effectiveInstalledPluginIds(old); // owned direct ids count either way
    const { state, changed } = migrateCatalogState(old);
    expect(changed).toBe(true);
    expect(state.installedPlugins).toEqual(STANDALONE_PLUGINS); // owned ids collapsed
    expect(state.installedKits).toEqual([TEXTBOOK]);
    expect(state.disabledGroups?.[TEXTBOOK]).toBeUndefined(); // matches the defaults → implicit
    // Effective-installed parity before/after.
    expect(effectiveInstalledPluginIds(state)).toEqual(before);
  });

  it("a legacy SUBJECT kit id maps to Textbook Kit + that subject group; shared refs stay direct", () => {
    const old: CatalogState = { installedPlugins: [], installedKits: ["subject-math"] };
    const { state, changed } = migrateCatalogState(old);
    expect(changed).toBe(true);
    expect(state.installedKits).toEqual([TEXTBOOK]);
    // Old effective was {subject-formula, mistake, quiz}: the formula + mistake groups
    // enable; every other group starts DISABLED (previously uninstalled member → off).
    expect(state.disabledGroups?.[TEXTBOOK]).toEqual([
      "explanation",
      "practice",
      "review-pack",
      "textbook-language",
      "subject-english",
      "subject-history-geo"
    ]);
    // quiz was a shared legacy ref with no owning group — it survives as a direct hold.
    expect(state.installedPlugins).toEqual(["quiz"]);
    const effective = effectiveInstalledPluginIds(state);
    for (const id of ["subject-formula", "mistake", "quiz"]) expect(effective.has(id), id).toBe(true);
    expect(effective.has("explanation")).toBe(false);
  });

  it("kit installed iff any member installed: an old kit-less vault with direct member holds re-derives the kit", () => {
    const old: CatalogState = { installedPlugins: [...LEGACY_DEFAULT_PLUGINS], installedKits: [] };
    const { state } = migrateCatalogState(old);
    expect(state.installedKits).toEqual([TEXTBOOK]);
    expect(state.installedPlugins).toEqual(STANDALONE_PLUGINS);
    expect(effectiveInstalledPluginIds(state).has("explanation")).toBe(true); // parity
  });

  it("null plugins + a materialized kit list: the OLD default direct set migrates (zero loss)", () => {
    // Old vault that uninstalled the kit but never touched plugins: the old null
    // default kept the 5 member plugins effective as direct defaults.
    const old: CatalogState = { installedPlugins: null, installedKits: [] };
    const { state, changed } = migrateCatalogState(old);
    expect(changed).toBe(true);
    expect(state.installedKits).toEqual([TEXTBOOK]); // any member installed ⇒ kit installed
    expect(state.installedPlugins).toEqual(STANDALONE_PLUGINS);
    const effective = effectiveInstalledPluginIds(state);
    for (const id of LEGACY_DEFAULT_PLUGINS) expect(effective.has(id), id).toBe(true);
  });

  it("is idempotent: migrating a migrated state is the identity", () => {
    for (const old of [
      { installedPlugins: [...LEGACY_DEFAULT_PLUGINS], installedKits: [TEXTBOOK] },
      { installedPlugins: [], installedKits: ["subject-english", TEXTBOOK] },
      { installedPlugins: ["subject-vocab"], installedKits: null }
    ] satisfies CatalogState[]) {
      const first = migrateCatalogState(old);
      expect(first.changed).toBe(true);
      const second = migrateCatalogState(first.state);
      expect(second.changed).toBe(false);
      expect(second.state).toEqual(first.state);
    }
  });

  it("legacy kit + the target kit together: base groups AND the subject group enable", () => {
    const old: CatalogState = {
      installedPlugins: [...LEGACY_DEFAULT_PLUGINS],
      installedKits: [TEXTBOOK, "subject-english"]
    };
    const { state } = migrateCatalogState(old);
    expect(state.installedKits).toEqual([TEXTBOOK]);
    expect(state.disabledGroups?.[TEXTBOOK]).toEqual(["subject-math", "subject-history-geo"]);
    expect(state.installedPlugins).toEqual(STANDALONE_PLUGINS); // flashcard already direct
    expect(effectiveInstalledPluginIds(state).has("subject-vocab")).toBe(true);
  });

  it("user kits pass through untouched and keep contributing to the union", () => {
    const userKits = [{ id: "user:exam", name: "Exam", members: ["quiz", "practice"] }];
    const old: CatalogState = { installedPlugins: ["practice"], installedKits: ["user:exam"] };
    const { state } = migrateCatalogState(old, userKits);
    expect(state.installedKits).toEqual(["user:exam", TEXTBOOK]);
    expect(state.installedPlugins).toEqual([]);
    const effective = effectiveInstalledPluginIds(state, userKits);
    expect(effective.has("quiz")).toBe(true); // via the user kit
    expect(effective.has("practice")).toBe(true); // via the enabled practice group
  });
});

describe("the module store (the availability predicate selectors read)", () => {
  it("defaults to the default set; sync/reset flip it", () => {
    expect(isPluginEffectiveInstalled("quiz")).toBe(true); // default = standalone on
    syncInstallState({ catalogState: { installedPlugins: [], installedKits: [] }, userKits: [] });
    expect(isPluginEffectiveInstalled("quiz")).toBe(false);
    expect(isKitInstalled(TEXTBOOK)).toBe(false);
    resetInstallState();
    expect(isPluginEffectiveInstalled("quiz")).toBe(true);
    expect(isKitInstalled(TEXTBOOK)).toBe(true);
  });

  it("UNCATALOGED ids are always available (core primitives / test registrations)", () => {
    syncInstallState({ catalogState: { installedPlugins: [], installedKits: [] }, userKits: [] });
    expect(isPluginEffectiveInstalled("core")).toBe(true);
    expect(isPluginEffectiveInstalled("some-test-kit")).toBe(true);
    expect(isPluginEffectiveInstalled(undefined)).toBe(true);
    // …until cataloged: then install state governs.
    registerCatalogEntry({
      id: "some-test-kit",
      kind: "plugin",
      name: "T",
      description: "",
      defaultInstalled: true,
      source: "bundled"
    });
    expect(isPluginEffectiveInstalled("some-test-kit")).toBe(false);
  });

  it("syncInstallState migrates defensively: a legacy subject-kit install keeps working", () => {
    syncInstallState({
      catalogState: { installedPlugins: [], installedKits: ["subject-english"] },
      userKits: []
    });
    expect(isPluginEffectiveInstalled("subject-vocab")).toBe(true);
    expect(isKitInstalled(TEXTBOOK)).toBe(true);
    // The LEGACY id resolves through the capability-group alias (detection/pins).
    expect(isKitInstalled("subject-english")).toBe(true);
    expect(isKitInstalled("subject-math")).toBe(false); // its group stayed off
  });

  it("legacy kit-id aliases follow the GROUP toggle, not just the kit", () => {
    syncInstallState({ catalogState: { installedPlugins: [], installedKits: [TEXTBOOK] }, userKits: [] });
    expect(isKitInstalled("subject-math")).toBe(false); // default: group off
    syncInstallState({
      catalogState: withKitGroupEnabled({ installedPlugins: [], installedKits: [TEXTBOOK] }, TEXTBOOK, "subject-math"),
      userKits: []
    });
    expect(isKitInstalled("subject-math")).toBe(true);
  });

  it("a user kit id in installedKits activates its members", () => {
    syncInstallState({
      catalogState: { installedPlugins: [], installedKits: ["user:k"] },
      userKits: [{ id: "user:k", name: "K", members: ["flashcard"] }]
    });
    expect(isPluginEffectiveInstalled("flashcard")).toBe(true);
    expect(isKitInstalled("user:k")).toBe(true);
  });

  it("snapshot exposes state + userKits + the derived effective set", () => {
    syncInstallState({
      catalogState: { installedPlugins: ["quiz"], installedKits: [] },
      userKits: [{ id: "user:k", name: "K", members: ["flashcard"] }]
    });
    const snap = installStateSnapshot();
    expect(snap.catalogState.installedPlugins).toEqual(["quiz"]);
    expect(snap.userKits).toHaveLength(1);
    expect(snap.effectivePluginIds.has("quiz")).toBe(true);
    expect(snap.effectivePluginIds.has("flashcard")).toBe(false); // user kit NOT installed
  });

  it("REV-CORE migration safety: a STALE plugin id persisted before a catalog entry was retired is ignored gracefully", () => {
    syncInstallState({
      catalogState: { installedPlugins: ["review", "quiz"], installedKits: [TEXTBOOK] },
      userKits: []
    });
    const snap = installStateSnapshot();
    expect(snap.effectivePluginIds.has("quiz")).toBe(true);
    expect(snap.effectivePluginIds.has("review")).toBe(true); // inert — nothing resolves it
    expect(isPluginEffectiveInstalled("review")).toBe(true); // uncataloged ⇒ always available
    expect(holdsOf("review", snap.catalogState)).toEqual({ direct: true, viaKits: [] });
    // Uninstalling the stale id is a plain set op — still no crash.
    const next = withPluginUninstalled(snap.catalogState, "review");
    expect(next.installedPlugins).not.toContain("review");
  });
});
