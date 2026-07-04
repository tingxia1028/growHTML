// Install-state unit tests (M1 — plugin-viewer-model §8.3/§8.5.2 + F4): the null
// back-compat default, the effective-installed union, materialize-on-first-touch,
// direct holds vs kit holds, and the derived kit-removal refcount.
import { afterEach, describe, expect, it } from "vitest";
import { registerCatalogEntry, resetCatalog, defaultInstalledIds } from "./catalog";
import {
  EMPTY_CATALOG_STATE,
  effectiveInstalledPluginIds,
  holdsOf,
  installStateSnapshot,
  isKitInstalled,
  isPluginEffectiveInstalled,
  kitRemovalOutcome,
  materializeCatalogState,
  resetInstallState,
  syncInstallState,
  withKitInstalled,
  withKitUninstalled,
  withPluginInstalled,
  withPluginUninstalled
} from "./installState";

afterEach(() => {
  resetInstallState();
  resetCatalog();
});

describe("effective-installed derivation (§8.3)", () => {
  it("null lists = the DEFAULT-INSTALLED set (every bundled entry) — untouched vaults change nothing", () => {
    const effective = effectiveInstalledPluginIds(EMPTY_CATALOG_STATE);
    // every bundled plugin, directly…
    for (const id of defaultInstalledIds("plugin")) expect(effective.has(id)).toBe(true);
    // …and the textbook members via the default-installed kit (redundantly, by union).
    expect(effective.has("explanation")).toBe(true);
    expect(effective.has("quiz")).toBe(true);
  });

  it("union: direct holds ∪ members of installed kits (catalog kits + user kits)", () => {
    const state = { installedPlugins: ["flashcard"], installedKits: ["textbook-learning"] };
    const effective = effectiveInstalledPluginIds(state);
    expect(effective.has("flashcard")).toBe(true); // direct
    expect(effective.has("practice")).toBe(true); // via the kit
    expect(effective.has("quiz")).toBe(false); // neither

    const userKits = [{ id: "user:exam", name: "Exam", members: ["quiz"] }];
    const withUser = effectiveInstalledPluginIds(
      { installedPlugins: [], installedKits: ["user:exam"] },
      userKits
    );
    expect(withUser.has("quiz")).toBe(true); // user kits participate uniformly
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

describe("transitions (§8.5)", () => {
  it("the FIRST explicit uninstall materializes, then applies the delta", () => {
    const next = withPluginUninstalled(EMPTY_CATALOG_STATE, "quiz");
    expect(next.installedPlugins).toEqual(defaultInstalledIds("plugin").filter((id) => id !== "quiz"));
    expect(next.installedKits).toEqual(defaultInstalledIds("kit")); // untouched but concrete
    // quiz stays EFFECTIVE only if some installed kit provides it — it doesn't, so gone.
    expect(effectiveInstalledPluginIds(next).has("quiz")).toBe(false);
  });

  it("install/uninstall are idempotent set ops", () => {
    const base = { installedPlugins: [] as string[], installedKits: [] as string[] };
    const once = withPluginInstalled(base, "quiz");
    expect(withPluginInstalled(once, "quiz").installedPlugins).toEqual(["quiz"]);
    const kit = withKitInstalled(base, "textbook-learning");
    expect(withKitInstalled(kit, "textbook-learning").installedKits).toEqual(["textbook-learning"]);
    expect(withKitUninstalled(kit, "textbook-learning").installedKits).toEqual([]);
  });

  it("kit uninstall keeps a member that is directly held (§8.5.2 refcount, derived)", () => {
    const state = {
      installedPlugins: ["practice"],
      installedKits: ["textbook-learning"]
    };
    const next = withKitUninstalled(state, "textbook-learning");
    const effective = effectiveInstalledPluginIds(next);
    expect(effective.has("practice")).toBe(true); // direct hold survives
    expect(effective.has("explanation")).toBe(false); // kit-only member removed
  });
});

describe("holds + kit-removal outcome (§8.5.2 confirmation rows)", () => {
  it("holdsOf names the provenance (direct / via kits)", () => {
    const state = { installedPlugins: ["practice"], installedKits: ["textbook-learning"] };
    expect(holdsOf("practice", state)).toEqual({ direct: true, viaKits: ["textbook-learning"] });
    expect(holdsOf("explanation", state)).toEqual({ direct: false, viaKits: ["textbook-learning"] });
    expect(holdsOf("quiz", state)).toEqual({ direct: false, viaKits: [] });
  });

  it("kitRemovalOutcome: removed vs kept-with-reason per member", () => {
    // practice held directly; explanation also in a second (user) kit; the rest kit-only.
    const userKits = [{ id: "user:second", name: "Second", members: ["explanation"] }];
    const state = {
      installedPlugins: ["practice"],
      installedKits: ["textbook-learning", "user:second"]
    };
    const rows = kitRemovalOutcome("textbook-learning", state, userKits);
    const byId = Object.fromEntries(rows.map((r) => [r.pluginId, r]));
    expect(byId["practice"]).toEqual({ pluginId: "practice", kept: true, keptBy: ["direct"] });
    expect(byId["explanation"]).toEqual({ pluginId: "explanation", kept: true, keptBy: ["user:second"] });
    expect(byId["mistake"]).toEqual({ pluginId: "mistake", kept: false, keptBy: [] });
    expect(rows).toHaveLength(5); // all five textbook members named
  });
});

describe("the module store (the availability predicate selectors read)", () => {
  it("defaults to the default-installed set; sync/reset flip it", () => {
    expect(isPluginEffectiveInstalled("quiz")).toBe(true); // default = everything
    syncInstallState({ catalogState: { installedPlugins: [], installedKits: [] }, userKits: [] });
    expect(isPluginEffectiveInstalled("quiz")).toBe(false);
    expect(isKitInstalled("textbook-learning")).toBe(false);
    resetInstallState();
    expect(isPluginEffectiveInstalled("quiz")).toBe(true);
    expect(isKitInstalled("textbook-learning")).toBe(true);
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

  it("a user kit id in installedKits activates its members", () => {
    syncInstallState({
      catalogState: { installedPlugins: [], installedKits: ["user:k"] },
      userKits: [{ id: "user:k", name: "K", members: ["flashcard"] }]
    });
    expect(isPluginEffectiveInstalled("flashcard")).toBe(true);
    expect(isKitInstalled("user:k")).toBe(true);
  });

  it("REV-CORE migration safety: a STALE plugin id persisted before a catalog entry was retired is ignored gracefully", () => {
    // Vaults that materialized their catalogState while the review plugin was a market
    // good still carry "review" in installedPlugins. The id is UNCATALOGED now: every
    // derivation tolerates it (no crash, no listing), and the availability predicate
    // treats it as always-available (the loop is core).
    syncInstallState({
      catalogState: { installedPlugins: ["review", "quiz"], installedKits: ["textbook-learning"] },
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
