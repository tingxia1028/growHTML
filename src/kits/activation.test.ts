import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { CORE_KIT_ID, effectiveKitIds } from "./activation";
import { installClientKits, kitSurfaceItems, noteTypeOwnerKit } from "./clientContext";
import { registerCatalogEntry, resetCatalog } from "./catalog";
import { resetInstallState, syncInstallState } from "./installState";
import type { ProductKit } from "./types";

// effectiveKitIds — the pure per-source resolver (no localStorage). Source metadata
// wins; an empty array means "Core"; absent metadata inherits the workspace default.
// F4 NOTE: this resolves the FOREGROUND kit set only — availability comes from the
// marketplace effective-installed set (see the filtering suite below).
describe("effectiveKitIds", () => {
  it("uses the workspace default when source metadata has no array", () => {
    expect(effectiveKitIds(undefined, "textbook-learning")).toEqual(["textbook-learning"]);
    expect(effectiveKitIds(null, "textbook-learning")).toEqual(["textbook-learning"]);
    expect(effectiveKitIds("nope", "textbook-learning")).toEqual(["textbook-learning"]);
  });

  it("treats an explicit array as authoritative (incl. empty = Core)", () => {
    expect(effectiveKitIds([], "textbook-learning")).toEqual([]);
    expect(effectiveKitIds(["textbook-learning"], "textbook-learning")).toEqual(["textbook-learning"]);
    expect(effectiveKitIds(["a", "b"], "x")).toEqual(["a", "b"]);
  });

  it("yields Core ([]) when the default is core/empty and no metadata", () => {
    expect(effectiveKitIds(undefined, CORE_KIT_ID)).toEqual([]);
    expect(effectiveKitIds(undefined, null)).toEqual([]);
  });

  it("filters non-strings and the core sentinel out of a metadata array", () => {
    expect(effectiveKitIds(["textbook-learning", CORE_KIT_ID, 5, null], "x")).toEqual(["textbook-learning"]);
  });
});

// F4 — effective-installed replaces the single-active-kit GATE. Availability of a
// surface item is decided by the marketplace install state (installState.ts); the
// per-source active kit ids only FOREGROUND (order) the list. Install two tiny fake
// kits: one CATALOGED (so install state governs it), one UNCATALOGED (always
// available — core/test registrations are outside install state).
const surfacedKit = (id: string, commandId: string, priority: number): ProductKit => ({
  id,
  name: `Kit ${id}`,
  description: "fake",
  members: [
    {
      id: `${id}-member`,
      name: `${id} member`,
      install(ctx) {
        ctx.surfaces.contribute("selection-toolbar", [{ commandId, title: commandId, priority }]);
      }
    }
  ],
  install() {}
});

const fakeKit: ProductKit = {
  id: "test-kit",
  name: "Test Kit",
  description: "fake",
  install(ctx) {
    ctx.surfaces.contribute("selection-toolbar", [{ commandId: "test.cmd", title: "Test", priority: 50 }]);
    ctx.noteTypes.register(
      {
        contentType: "test.block",
        schema: z.string(),
        createDefault: () => "",
        toSearchText: (c) => String(c)
      },
      { render: () => null, edit: () => null }
    );
  }
};

describe("kit surface filtering (F4: effective-installed, foreground-not-filter)", () => {
  // Catalog the two surfaced kits + their members so install state governs them.
  registerCatalogEntry({ id: "kit-a", kind: "kit", name: "Kit A", description: "", members: ["kit-a-member"], defaultInstalled: true, source: "bundled" });
  registerCatalogEntry({ id: "kit-a-member", kind: "plugin", name: "Kit A member", description: "", defaultInstalled: true, source: "bundled" });
  registerCatalogEntry({ id: "kit-b", kind: "kit", name: "Kit B", description: "", members: ["kit-b-member"], defaultInstalled: true, source: "bundled" });
  registerCatalogEntry({ id: "kit-b-member", kind: "plugin", name: "Kit B member", description: "", defaultInstalled: true, source: "bundled" });
  installClientKits([surfacedKit("kit-a", "a.cmd", 10), surfacedKit("kit-b", "b.cmd", 90), fakeKit]);

  afterEach(() => {
    resetInstallState();
    // NOTE: resetCatalog() is NOT called here — the registered test entries must
    // survive for every `it` in this file; the module registry is per-file.
  });

  const ids = (kitIds?: string[]) => kitSurfaceItems("selection-toolbar", kitIds).map((i) => i.commandId);

  it("default install state (null = default-installed): every installed kit's items are AVAILABLE regardless of the active kit", () => {
    // Core active ([]) no longer hides kit items — creation is governed by install
    // state, not per-source activation (the F4 flip; migration story: a previously
    // active kit is defaultInstalled, so existing vaults keep their toolbar).
    expect(ids([])).toEqual(expect.arrayContaining(["a.cmd", "b.cmd", "test.cmd"]));
    expect(ids(["kit-a"])).toEqual(expect.arrayContaining(["a.cmd", "b.cmd", "test.cmd"]));
    expect(ids(undefined)).toEqual(expect.arrayContaining(["a.cmd", "b.cmd", "test.cmd"]));
  });

  it("the active kit FOREGROUNDS its items (first), priority ordering within groups", () => {
    // kit-a active: its item leads even though kit-b has higher priority.
    expect(ids(["kit-a"])[0]).toBe("a.cmd");
    // No foreground set: plain priority order (kit-b 90 > test-kit 50 > kit-a 10).
    expect(ids(undefined)).toEqual(["b.cmd", "test.cmd", "a.cmd"]);
  });

  it("uninstalling a kit removes its items everywhere — even when it is the source's active kit", () => {
    syncInstallState({
      catalogState: { installedPlugins: [], installedKits: ["kit-b"] },
      userKits: []
    });
    expect(ids(["kit-a"])).not.toContain("a.cmd"); // active but NOT installed → gone
    expect(ids(["kit-a"])).toContain("b.cmd"); // installed → stays
  });

  it("uncataloged (test/core) registrations are OUTSIDE install state — always available", () => {
    syncInstallState({
      catalogState: { installedPlugins: [], installedKits: [] },
      userKits: []
    });
    expect(ids(undefined)).toEqual(["test.cmd"]); // only the uncataloged kit's item survives
  });

  it("a directly-installed member keeps its items after its kit is uninstalled (§8.5.2 direct hold)", () => {
    syncInstallState({
      catalogState: { installedPlugins: ["kit-a-member"], installedKits: [] },
      userKits: []
    });
    expect(ids(undefined)).toContain("a.cmd");
    expect(ids(undefined)).not.toContain("b.cmd");
  });

  it("tags kit note types with their owning plugin; core/built-in types have no owner", () => {
    expect(noteTypeOwnerKit("test.block")).toBe("test-kit");
    expect(noteTypeOwnerKit("markdown")).toBeUndefined();
  });
});
