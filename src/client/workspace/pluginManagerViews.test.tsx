// @vitest-environment jsdom
// Kit & Plugin MARKET view tests (M1 + MH-0): two tabs (已安装 / 市场), install /
// uninstall / enable / disable flows against the local CatalogSource + the install-state
// store, the §8.5.2 kit-removal confirmation, the relocated Advanced toggles + viewer
// conflicts — and the MH-0 acceptance (the market listing renders ONLY through
// CatalogSource("local"), never a direct catalog registry import).
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { getView, type WorkspaceContext } from "./viewRegistry";
import type { PluginRecord } from "../../kits/plugin";
import type { PluginPrefs } from "../data/entityClient";
import { registerCatalogEntry, resetCatalog } from "../../kits/catalog";
import { resetInstallState, syncInstallState, type CatalogState } from "../../kits/installState";
import "./pluginManagerViews";

// The market view's data seams: pluginPrefs (mount refresh) + putPluginCatalog (the
// install write). Mocked per-test; the mock mirrors production by syncing the
// install-state store exactly like the real entityClient does.
vi.mock("../data/entityClient", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../data/entityClient")>();
  return {
    ...mod,
    entityClient: {
      ...mod.entityClient,
      pluginPrefs: vi.fn(() => Promise.reject(new Error("not wired in this test"))),
      putPluginCatalog: vi.fn(() => Promise.reject(new Error("not wired in this test")))
    }
  };
});
import { entityClient } from "../data/entityClient";

// —— fixtures ————————————————————————————————————————————————————————————————

// A small catalog world on TOP of the bundled entries: kit-a { m1, m2 } + solo.
function catalogFixture(): void {
  registerCatalogEntry({ id: "m1", kind: "plugin", name: "M1 闪记", description: "member one", defaultInstalled: true, source: "bundled" });
  registerCatalogEntry({ id: "m2", kind: "plugin", name: "M2 测验", description: "member two", defaultInstalled: true, source: "bundled" });
  registerCatalogEntry({ id: "solo", kind: "plugin", name: "Solo 独立", description: "a standalone market plugin", defaultInstalled: false, source: "bundled" });
  registerCatalogEntry({ id: "kit-a", kind: "kit", name: "Kit A 套件", description: "bundle of m1+m2", members: ["m1", "m2"], defaultInstalled: true, source: "bundled" });
}

const M1_CONTRIBS = [
  { id: "m1:noteType:m1.block", kind: "noteType" as const, label: "Block", key: "m1.block" },
  { id: "m1:surface:m1.make", kind: "surface" as const, label: "Make", key: "m1.make" }
];

const plugins: PluginRecord[] = [
  { id: "kit-a", name: "Kit A 套件", kitId: "kit-a", contributions: [{ id: "kit-a:layout:kit-a", kind: "layout", label: "Layout", key: "kit-a" }] },
  { id: "m1", name: "M1 闪记", kitId: "kit-a", contributions: M1_CONTRIBS },
  { id: "m2", name: "M2 测验", kitId: "kit-a", contributions: [{ id: "m2:noteType:m2.block", kind: "noteType", label: "Block2", key: "m2.block" }] },
  { id: "solo", name: "Solo 独立", contributions: [{ id: "solo:noteType:solo.block", kind: "noteType", label: "SoloBlock", key: "solo.block" }] },
  { id: "core", name: "Core", contributions: [{ id: "core:noteType:markdown", kind: "noteType", label: "markdown", key: "markdown" }] }
];

function ctxWith(over: Partial<WorkspaceContext>): WorkspaceContext {
  const prefs: PluginPrefs = {
    disabledContributions: [],
    viewerAssociations: { byContentType: {}, byNoteId: {} },
    userKits: []
  };
  return {
    installedKits: [{ id: "kit-a", name: "Kit A 套件" }],
    installedPlugins: plugins,
    pluginPrefs: prefs,
    setContributionEnabled: vi.fn(),
    pinViewer: vi.fn(),
    ...over
  } as unknown as WorkspaceContext;
}

// Wire the mocked seams to a given install state; putPluginCatalog records writes AND
// syncs the store (like production), so the view re-renders on the new truth.
function wireInstallState(state: CatalogState): { writes: CatalogState[] } {
  const writes: CatalogState[] = [];
  syncInstallState({ catalogState: state, userKits: [] });
  vi.mocked(entityClient.pluginPrefs).mockImplementation(() => {
    syncInstallState({ catalogState: state, userKits: [] });
    return Promise.resolve({ prefs: { disabledContributions: [], viewerAssociations: { byContentType: {}, byNoteId: {} }, userKits: [], catalogState: state } });
  });
  vi.mocked(entityClient.putPluginCatalog).mockImplementation((body) => {
    writes.push(body.catalogState);
    syncInstallState({ catalogState: body.catalogState, userKits: body.userKits ?? [] });
    return Promise.resolve({ prefs: { disabledContributions: [], viewerAssociations: { byContentType: {}, byNoteId: {} }, userKits: [], catalogState: body.catalogState } });
  });
  return { writes };
}

async function renderPanel(ctx: WorkspaceContext): Promise<{ container: HTMLElement; cleanup: () => void }> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      getView("plugin.manager")!.render({ id: "plugin-manager", kind: "plugin.manager" } as never, ctx) as React.ReactElement
    )
  );
  // Flush the async listing + prefs effects.
  await act(async () => {});
  return {
    container,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    }
  };
}

const click = async (el: Element | null) => {
  expect(el, "expected element to click").toBeTruthy();
  await act(async () => (el as HTMLElement).click());
};

afterEach(() => {
  vi.clearAllMocks();
  resetInstallState();
  resetCatalog();
  document.body.innerHTML = "";
});

// —— tests ————————————————————————————————————————————————————————————————————

describe("plugin.manager market view — tabs", () => {
  it("renders the two tabs, 已安装 selected by default", async () => {
    catalogFixture();
    wireInstallState({ installedPlugins: [], installedKits: ["kit-a"] });
    const { container, cleanup } = await renderPanel(ctxWith({}));
    const tabs = container.querySelectorAll(".market-tab");
    expect(tabs).toHaveLength(2);
    expect(container.querySelector(".market-tab-installed")?.getAttribute("aria-selected")).toBe("true");
    expect(container.querySelector(".market-installed")).toBeTruthy();
    expect(container.querySelector(".market-browse")).toBeNull();
    cleanup();
  });
});

describe("已安装 (manage) tab", () => {
  it("groups member plugins under their installed kit; core is hidden; provenance is named", async () => {
    catalogFixture();
    wireInstallState({ installedPlugins: [], installedKits: ["kit-a"] });
    const { container, cleanup } = await renderPanel(ctxWith({}));

    const kitGroup = container.querySelector('.plugin-kit-group[data-kit-id="kit-a"]');
    expect(kitGroup).toBeTruthy();
    expect(kitGroup!.querySelector('[data-plugin-id="m1"]')).toBeTruthy();
    expect(kitGroup!.querySelector('[data-plugin-id="m2"]')).toBeTruthy();
    // Members held only via the kit say so (§8.5.2) and offer no direct uninstall.
    expect(kitGroup!.querySelector('[data-plugin-id="m1"] .plugin-provenance')?.textContent).toContain("Kit A 套件");
    expect(kitGroup!.querySelector('[data-plugin-id="m1"] .plugin-uninstall-btn')).toBeNull();
    // Core primitives never get a row (§8.1 hidden means hidden).
    expect(container.querySelector('[data-plugin-id="core"]')).toBeNull();
    // solo is NOT effective-installed → not in 已安装.
    expect(container.querySelector('[data-plugin-id="solo"]')).toBeNull();
    cleanup();
  });

  it("a directly-held plugin offers 卸载 which persists a plugin-removed catalogState", async () => {
    catalogFixture();
    const { writes } = wireInstallState({ installedPlugins: ["solo"], installedKits: ["kit-a"] });
    const { container, cleanup } = await renderPanel(ctxWith({}));

    const soloRow = container.querySelector('[data-plugin-id="solo"]');
    expect(soloRow).toBeTruthy();
    await click(soloRow!.querySelector(".plugin-uninstall-btn"));
    expect(writes).toHaveLength(1);
    expect(writes[0].installedPlugins).toEqual([]);
    expect(writes[0].installedKits).toEqual(["kit-a"]);
    // The row leaves 已安装 after the store syncs.
    expect(container.querySelector('[data-plugin-id="solo"]')).toBeNull();
    cleanup();
  });

  it("kit 卸载 shows the §8.5.2 per-member outcome, then persists the kit removal", async () => {
    catalogFixture();
    // m1 also held directly → "保留(直接安装)"; m2 kit-only → "移除".
    const { writes } = wireInstallState({ installedPlugins: ["m1"], installedKits: ["kit-a"] });
    const { container, cleanup } = await renderPanel(ctxWith({}));

    await click(container.querySelector('.plugin-kit-group[data-kit-id="kit-a"] .kit-uninstall-btn'));
    const confirm = container.querySelector(".kit-removal-confirm");
    expect(confirm).toBeTruthy();
    expect(confirm!.textContent).toContain("移除 «Kit A 套件»?");
    const m1Row = confirm!.querySelector('.kit-removal-row[data-plugin-id="m1"]');
    const m2Row = confirm!.querySelector('.kit-removal-row[data-plugin-id="m2"]');
    expect(m1Row!.textContent).toContain("保留");
    expect(m1Row!.textContent).toContain("直接安装");
    expect(m2Row!.textContent).toContain("移除");

    await click(confirm!.querySelector(".kit-removal-confirm-btn"));
    expect(writes).toHaveLength(1);
    expect(writes[0].installedKits).toEqual([]);
    expect(writes[0].installedPlugins).toEqual(["m1"]);
    // The kit group is gone; m1 survives as a standalone (direct-held) plugin row.
    expect(container.querySelector('.plugin-kit-group[data-kit-id="kit-a"]')).toBeNull();
    expect(container.querySelector('.market-standalone-group [data-plugin-id="m1"]')).toBeTruthy();
    cleanup();
  });

  it("the plugin-level enable switch toggles EVERY contribution through ctx.setContributionEnabled", async () => {
    catalogFixture();
    wireInstallState({ installedPlugins: [], installedKits: ["kit-a"] });
    const setContributionEnabled = vi.fn();
    const { container, cleanup } = await renderPanel(ctxWith({ setContributionEnabled }));

    const toggle = container.querySelector('[data-plugin-id="m1"] .plugin-enable-toggle input') as HTMLInputElement;
    expect(toggle.checked).toBe(true); // nothing disabled → enabled
    await click(toggle);
    expect(setContributionEnabled).toHaveBeenCalledTimes(M1_CONTRIBS.length);
    for (const contribution of M1_CONTRIBS) {
      expect(setContributionEnabled).toHaveBeenCalledWith(contribution.id, false);
    }
    cleanup();
  });

  it("Advanced keeps the per-contribution rows (the relocated P2 toggles)", async () => {
    catalogFixture();
    wireInstallState({ installedPlugins: [], installedKits: ["kit-a"] });
    const setContributionEnabled = vi.fn();
    const disabledPrefs: PluginPrefs = {
      disabledContributions: ["m1:surface:m1.make"],
      viewerAssociations: { byContentType: {}, byNoteId: {} },
      userKits: []
    };
    const { container, cleanup } = await renderPanel(ctxWith({ setContributionEnabled, pluginPrefs: disabledPrefs }));

    const row = container.querySelector('[data-contribution-id="m1:surface:m1.make"] input') as HTMLInputElement;
    expect(row).toBeTruthy();
    expect(row.checked).toBe(false); // reflects the disabled set
    await click(row);
    expect(setContributionEnabled).toHaveBeenCalledWith("m1:surface:m1.make", true);
    cleanup();
  });

  it("keeps the Viewer conflicts section (the §8.5.5 Defaults surface)", async () => {
    catalogFixture();
    wireInstallState({ installedPlugins: [], installedKits: ["kit-a"] });
    const { container, cleanup } = await renderPanel(ctxWith({}));
    expect(container.textContent).toContain("Viewer conflicts");
    cleanup();
  });
});

describe("市场 (browse) tab", () => {
  it("renders listings, install badges, and installs a plugin as a DIRECT hold (materialized)", async () => {
    catalogFixture();
    const { writes } = wireInstallState({ installedPlugins: [], installedKits: ["kit-a"] });
    const { container, cleanup } = await renderPanel(ctxWith({}));

    await click(container.querySelector(".market-tab-market"));
    expect(container.querySelector(".market-browse")).toBeTruthy();

    // Cards come from CatalogSource("local"): bundled + the fixture entries.
    const soloCard = container.querySelector('.market-card[data-entry-id="solo"]');
    expect(soloCard).toBeTruthy();
    expect(soloCard!.textContent).toContain("a standalone market plugin");
    // m1 is effective via kit-a → Installed badge, no button.
    const m1Card = container.querySelector('.market-card[data-entry-id="m1"]');
    expect(m1Card!.querySelector(".market-installed-badge")).toBeTruthy();
    expect(m1Card!.querySelector(".market-install-btn")).toBeNull();

    await click(soloCard!.querySelector(".market-install-btn"));
    expect(writes).toHaveLength(1);
    expect(writes[0].installedPlugins).toEqual(["solo"]); // concrete array, delta applied
    expect(writes[0].installedKits).toEqual(["kit-a"]);
    // Badge flips after the store syncs.
    expect(container.querySelector('.market-card[data-entry-id="solo"] .market-installed-badge')).toBeTruthy();
    cleanup();
  });

  it("installs a KIT by adding its id (members become effective via the union)", async () => {
    catalogFixture();
    const { writes } = wireInstallState({ installedPlugins: [], installedKits: [] });
    const { container, cleanup } = await renderPanel(ctxWith({}));

    await click(container.querySelector(".market-tab-market"));
    const kitCard = container.querySelector('.market-card[data-entry-id="kit-a"]');
    expect(kitCard!.getAttribute("data-kind")).toBe("kit");
    expect(kitCard!.textContent).toContain("2 plugins");
    await click(kitCard!.querySelector(".market-install-btn"));
    expect(writes[0].installedKits).toEqual(["kit-a"]);

    // Members show Installed now (effective via the kit).
    expect(container.querySelector('.market-card[data-entry-id="m1"] .market-installed-badge')).toBeTruthy();
    cleanup();
  });

  it("kind filter + search go through the SAME CatalogSource query", async () => {
    catalogFixture();
    wireInstallState({ installedPlugins: [], installedKits: ["kit-a"] });
    const { container, cleanup } = await renderPanel(ctxWith({}));

    await click(container.querySelector(".market-tab-market"));
    // Filter to kits only.
    const kitChip = Array.from(container.querySelectorAll(".market-kind-chip")).find((b) => b.textContent === "Kits");
    await click(kitChip!);
    await act(async () => {});
    const kinds = Array.from(container.querySelectorAll(".market-card")).map((c) => c.getAttribute("data-kind"));
    expect(kinds.length).toBeGreaterThan(0);
    expect(kinds.every((k) => k === "kit")).toBe(true);

    // Search narrows by title/description.
    const search = container.querySelector(".market-search") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(search, "独立");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {});
    // "Solo 独立" is a plugin — with the kit filter on, nothing matches.
    expect(container.querySelectorAll(".market-card")).toHaveLength(0);
    cleanup();
  });
});

describe("MH-0 acceptance — no direct registry import for the market listing", () => {
  it("pluginManagerViews imports the CatalogSource seam, never the catalog registry", () => {
    const source = readFileSync(path.join(__dirname, "pluginManagerViews.tsx"), "utf8");
    // The one allowed catalog surface: the CatalogSource contract module.
    expect(source).toMatch(/from "\.\.\/\.\.\/kits\/catalogSource"/);
    // The catalog registry itself must NOT be imported (listings flow through the
    // source; install state + read model are manager-side by contract).
    expect(source).not.toMatch(/from "\.\.\/\.\.\/kits\/catalog"/);
    expect(source).not.toMatch(/listCatalogEntries|BUNDLED_CATALOG|providerOf/);
    // And the market list renders from catalogSource("local").
    expect(source).toMatch(/catalogSource\("local"\)\s*\n?\s*\.list\(|catalogSource\("local"\)\.list\(/);
  });
});
