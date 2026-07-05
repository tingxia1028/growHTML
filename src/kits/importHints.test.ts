// M3a — import-hint resolution (docs/design/plugin-viewer-model.md §8.7 step 2). The pure
// mapping of a pack's contentType set onto install prompts: core primitives → no hint;
// an uninstalled provider → a hint naming its plugin + owning kit; an already-installed
// provider → no hint; an unknown type → no hint (the InertNote affordance covers it).
import { afterEach, describe, expect, it } from "vitest";
import { registerCatalogEntry, resetCatalog } from "./catalog";
import { resolveImportHints } from "./importHints";
import {
  resetInstallState,
  syncInstallState,
  withKitInstalled,
  withPluginInstalled,
  type CatalogState
} from "./installState";

afterEach(() => {
  resetCatalog();
  resetInstallState();
});

const NULL_STATE: CatalogState = { installedPlugins: null, installedKits: null };

describe("resolveImportHints — §8.7 resolution", () => {
  it("core primitives produce NO hint (no provider, nothing to install)", () => {
    expect(resolveImportHints(["markdown", "code-snippet", "html-sandbox"], { state: NULL_STATE })).toEqual([]);
  });

  it("an unknown type (no provider) produces no hint — the InertNote affordance covers it", () => {
    expect(resolveImportHints(["totally.unknown"], { state: NULL_STATE })).toEqual([]);
  });

  it("a NOT-effective-installed provider yields a hint naming the plugin + its owning kit", () => {
    // subject.vocab's provider (subject-vocab) is group-owned by textbook-learning's
    // per-subject 英语 group, which is default-DISABLED → not effective-installed on a
    // default state → a hint.
    const hints = resolveImportHints(["subject.vocab"], { state: NULL_STATE });
    expect(hints).toHaveLength(1);
    expect(hints[0]).toMatchObject({
      contentType: "subject.vocab",
      installed: false,
      kitId: "textbook-learning"
    });
    expect(hints[0].provider.id).toBe("subject-vocab");
  });

  it("an already-effective-installed provider yields NO hint (default-enabled group)", () => {
    // textbook.explanation's provider (explanation) is in the default-ENABLED explanation
    // group of the default-installed Textbook Kit → effective-installed → no hint.
    expect(resolveImportHints(["textbook.explanation"], { state: NULL_STATE })).toEqual([]);
    // flashcard is a standalone defaultInstalled plugin → effective → no hint.
    expect(resolveImportHints(["flashcard"], { state: NULL_STATE })).toEqual([]);
  });

  it("installing the owning kit's subject group flips a hint to none", () => {
    // Enable the 英语 group by materializing the state with the group enabled: install the
    // kit (already default-installed) then explicitly enable via disabledGroups = [].
    const enabled: CatalogState = { installedPlugins: [], installedKits: ["textbook-learning"], disabledGroups: { "textbook-learning": [] } };
    expect(resolveImportHints(["subject.vocab"], { state: enabled })).toEqual([]);
  });

  it("dedupes repeated contentTypes into a single hint", () => {
    const hints = resolveImportHints(["subject.vocab", "subject.vocab", "subject.formula"], { state: NULL_STATE });
    expect(hints.map((h) => h.contentType)).toEqual(["subject.vocab", "subject.formula"]);
  });

  it("falls back to the module install-state store when no explicit state is passed", () => {
    // Sync a store where the Textbook Kit is uninstalled → subject.vocab provider missing.
    syncInstallState({ catalogState: { installedPlugins: [], installedKits: [] } });
    expect(resolveImportHints(["subject.vocab"]).map((h) => h.contentType)).toEqual(["subject.vocab"]);
    // Now direct-install the provider into the store → the hint clears.
    let state: CatalogState = { installedPlugins: [], installedKits: [] };
    state = withPluginInstalled(state, "subject-vocab");
    syncInstallState({ catalogState: state });
    expect(resolveImportHints(["subject.vocab"])).toEqual([]);
  });

  it("a standalone (non-group-owned) provider hint carries no kitId", () => {
    registerCatalogEntry({
      id: "standalone",
      kind: "plugin",
      name: "Standalone",
      description: "x",
      provides: ["standalone.type"],
      defaultInstalled: false,
      source: "bundled"
    });
    const state = withKitInstalled({ installedPlugins: [], installedKits: [] }, "nope"); // no-op kit
    const hints = resolveImportHints(["standalone.type"], { state });
    expect(hints).toHaveLength(1);
    expect(hints[0].provider.id).toBe("standalone");
    expect(hints[0].kitId).toBeUndefined();
  });
});
