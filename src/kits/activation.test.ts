import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  activeKitIdsForSource,
  CORE_KIT_ID,
  effectiveKitIds,
  FALLBACK_DEFAULT_KIT,
  resolveForegroundKits
} from "./activation";
import { installClientKits, kitSurfaceItems, noteTypeOwnerKit } from "./clientContext";
import { registerCatalogEntry, resetCatalog } from "./catalog";
import { resetInstallState, syncInstallState } from "./installState";
import {
  registerKitDetection,
  resetKitDetections,
  type KitDetectionTable
} from "../core/subject/detectSubject";
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

// F4 — effective-installed replaces the old single-kit install gate. A caller without a
// foreground asks for the full configurable pool; a caller with per-source active kit ids
// gets the document-scoped tool surface. Install two tiny fake kits: one CATALOGED (so
// install state governs it), one UNCATALOGED (always available when no foreground filter
// is requested — core/test registrations are outside install state).
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

describe("kit surface filtering (F4: effective-installed, foreground filter)", () => {
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

  it("default install state (null = default-installed): no foreground returns the full configurable pool", () => {
    expect(ids(undefined)).toEqual(["b.cmd", "test.cmd", "a.cmd"]);
  });

  it("the active kit filters to its own member-owned surface items", () => {
    expect(ids(["kit-a"])).toEqual(["a.cmd"]);
    expect(ids(["kit-b"])).toEqual(["b.cmd"]);
    expect(ids([])).toEqual([]);
  });

  it("uninstalling a kit removes its items everywhere — even when it is the source's active kit", () => {
    syncInstallState({
      catalogState: { installedPlugins: [], installedKits: ["kit-b"] },
      userKits: []
    });
    expect(ids(["kit-a"])).toEqual([]);
    expect(ids(["kit-b"])).toEqual(["b.cmd"]);
  });

  it("uncataloged (test/core) registrations are outside install state but still obey foreground filters", () => {
    syncInstallState({
      catalogState: { installedPlugins: [], installedKits: [] },
      userKits: []
    });
    expect(ids(undefined)).toEqual(["test.cmd"]); // only the uncataloged kit's item survives
    expect(ids(["test-kit"])).toEqual(["test.cmd"]);
    expect(ids(["kit-a"])).toEqual([]);
  });

  it("a directly-installed member keeps its items after its kit is uninstalled (§8.5.2 direct hold)", () => {
    syncInstallState({
      catalogState: { installedPlugins: ["kit-a-member"], installedKits: [] },
      userKits: []
    });
    expect(ids(undefined)).toContain("a.cmd");
    expect(ids(undefined)).not.toContain("b.cmd");
    expect(ids(["kit-a"])).toEqual(["a.cmd"]);
    expect(ids(["kit-b"])).toEqual([]);
  });

  it("tags kit note types with their owning plugin; core/built-in types have no owner", () => {
    expect(noteTypeOwnerKit("test.block")).toBe("test-kit");
    expect(noteTypeOwnerKit("markdown")).toBeUndefined();
  });
});

// M-A — the Subject Auto-Switch rides the activation resolver (subject-kits.md §3.2):
// pin (explicit metadata.activeKitIds array) > detection ≥ threshold (installed kit)
// > workspace default. Pure over injected (tables, isInstalled) — no registry state.
describe("resolveForegroundKits (M-A auto-switch: pin > detected > default)", () => {
  const mathTable: KitDetectionTable = {
    kitId: "kit-math",
    titleKeywords: ["数学"],
    titlePatterns: [/\bmath\b/i],
    sourceTypes: ["pdf"]
  };
  const opts = { tables: [mathTable], isInstalled: () => true };

  it("an explicit per-source pin beats a winning detection — including [] = Core", () => {
    const pinnedOther = resolveForegroundKits(
      { title: "数学必修一", metadata: { activeKitIds: ["kit-english"] } },
      "textbook-learning",
      opts
    );
    expect(pinnedOther).toEqual({ kitIds: ["kit-english"], mode: "pin", detection: null });

    const pinnedCore = resolveForegroundKits(
      { title: "数学必修一", metadata: { activeKitIds: [] } },
      "textbook-learning",
      opts
    );
    expect(pinnedCore).toEqual({ kitIds: [], mode: "pin", detection: null });
  });

  it("a NON-array activeKitIds is not a pin — detection applies (inherit semantics)", () => {
    const resolved = resolveForegroundKits(
      { title: "数学必修一", metadata: { activeKitIds: null } },
      "textbook-learning",
      opts
    );
    expect(resolved.mode).toBe("detected");
    expect(resolved.kitIds).toEqual(["kit-math"]);
  });

  it("a detection above the threshold auto-foregrounds the kit, with explainable provenance", () => {
    const resolved = resolveForegroundKits({ title: "Math Workbook", sourceType: "pdf" }, "textbook-learning", opts);
    expect(resolved.mode).toBe("detected");
    expect(resolved.kitIds).toEqual(["kit-math"]);
    expect(resolved.detection?.kitId).toBe("kit-math");
    expect(resolved.detection?.confidence).toBe(0.7); // title 0.6 + pdf 0.1
    expect(resolved.detection?.signals.map((s) => s.kind)).toEqual(["title-pattern", "source-type"]);
  });

  it("a below-threshold score falls through to the workspace default (no-op switch)", () => {
    const resolved = resolveForegroundKits({ title: "scan_001", sourceType: "pdf" }, "textbook-learning", opts);
    expect(resolved).toEqual({ kitIds: ["textbook-learning"], mode: "default", detection: null });
  });

  it("an UNINSTALLED winner foregrounds nothing — availability is never touched (§3.5)", () => {
    const resolved = resolveForegroundKits({ title: "数学必修一" }, "textbook-learning", {
      tables: [mathTable],
      isInstalled: () => false
    });
    expect(resolved).toEqual({ kitIds: ["textbook-learning"], mode: "default", detection: null });
  });

  it("no tables registered → byte-for-byte the pre-M-A behavior", () => {
    expect(resolveForegroundKits({ title: "数学必修一" }, "textbook-learning", { tables: [], isInstalled: () => true }))
      .toEqual({ kitIds: ["textbook-learning"], mode: "default", detection: null });
    expect(resolveForegroundKits(null, "textbook-learning", { tables: [], isInstalled: () => true }).kitIds)
      .toEqual(["textbook-learning"]);
    expect(resolveForegroundKits(null, null, { tables: [], isInstalled: () => true }).kitIds).toEqual([]);
  });

  it("deterministic: the same source resolves identically on every open/focus", () => {
    const source = { title: "初中数学 第3章", sourceType: "pdf" };
    const first = resolveForegroundKits(source, "textbook-learning", opts);
    expect(resolveForegroundKits(source, "textbook-learning", opts)).toEqual(first);
    expect(resolveForegroundKits(source, "textbook-learning", opts)).toEqual(first);
  });
});

// The registry-wired integration: activeKitIdsForSource (the seam WorkspaceContext's
// useMemo and the server's stage-axis seeding already call) picks up PER-KIT registered
// tables + the real install state + the stored workspace default.
describe("activeKitIdsForSource — auto-switch through the real registries", () => {
  afterEach(() => {
    resetKitDetections();
    resetInstallState();
  });

  it("auto-foregrounds a registered, installed kit; unmatched titles keep the default", () => {
    // kit-a is cataloged defaultInstalled above → effective-installed by default.
    registerKitDetection({ kitId: "kit-a", titleKeywords: ["几何"], titlePatterns: [] });
    expect(activeKitIdsForSource({ title: "几何练习册", metadata: {} })).toEqual(["kit-a"]);
    // No signal → the workspace default (no localStorage here → the fallback kit).
    expect(activeKitIdsForSource({ title: "假期随笔", metadata: {} })).toEqual([FALLBACK_DEFAULT_KIT]);
    // The pin still beats the detection through the public seam.
    expect(
      activeKitIdsForSource({ title: "几何练习册", metadata: { activeKitIds: ["kit-b"] } })
    ).toEqual(["kit-b"]);
  });

  it("does not foreground a detected kit the vault uninstalled", () => {
    registerKitDetection({ kitId: "kit-a", titleKeywords: ["几何"], titlePatterns: [] });
    syncInstallState({ catalogState: { installedPlugins: [], installedKits: ["kit-b"] }, userKits: [] });
    expect(activeKitIdsForSource({ title: "几何练习册", metadata: {} })).toEqual([FALLBACK_DEFAULT_KIT]);
  });
});
