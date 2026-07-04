// @vitest-environment jsdom
// KIT manager view tests (FLAT-1 — kit-flatten §2, carrying MH-0): the single-screen
// kit manager — kit cards with enable/disable, the capability-group breakdown with
// per-group toggles, uninstall, NO separate plugin list — plus the kit-only 市场 tab
// and the MH-0 acceptance (the market listing renders ONLY through
// CatalogSource("local"), never a direct catalog registry import). Bilingual chrome:
// zh and en assert their OWN strings (no mixing).
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { getView, type WorkspaceContext } from "./viewRegistry";
import type { PluginRecord } from "../../kits/plugin";
import type { PluginPrefs } from "../data/entityClient";
import { registerCatalogEntry, resetCatalog } from "../../kits/catalog";
import { resetInstallState, syncInstallState, type CatalogState, type UserKitDef } from "../../kits/installState";
import { setLocale } from "../i18n";
import "./pluginManagerViews";

// The manager's data seams: pluginPrefs (mount refresh) + putPluginCatalog (the
// install-state write). Mocked per-test; the mock mirrors production by syncing the
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

// A small catalog world on TOP of the bundled entries: kit-a with two capability
// groups (g2 opt-in/default-disabled), whose member plugin ids are m1/m2.
function catalogFixture(): void {
  registerCatalogEntry({ id: "m1", kind: "plugin", name: "M1 闪记", description: "member one", defaultInstalled: false, source: "bundled" });
  registerCatalogEntry({ id: "m2", kind: "plugin", name: "M2 测验", description: "member two", defaultInstalled: false, source: "bundled" });
  registerCatalogEntry({
    id: "kit-a",
    kind: "kit",
    name: "Kit A 套件",
    description: "bundle of m1+m2",
    members: ["m1", "m2"],
    groups: [
      { id: "g1", name: { zh: "闪记组", en: "Flash group" }, members: ["m1"] },
      { id: "g2", name: { zh: "测验组", en: "Quiz group" }, members: ["m2"], defaultEnabled: false }
    ],
    defaultInstalled: true,
    source: "bundled"
  });
}

const plugins: PluginRecord[] = [
  { id: "kit-a", name: "Kit A 套件", kitId: "kit-a", contributions: [{ id: "kit-a:layout:kit-a", kind: "layout", label: "Layout", key: "kit-a" }] },
  { id: "m1", name: "M1 闪记", kitId: "kit-a", contributions: [{ id: "m1:noteType:m1.block", kind: "noteType", label: "Block", key: "m1.block" }] },
  { id: "m2", name: "M2 测验", kitId: "kit-a", contributions: [{ id: "m2:noteType:m2.block", kind: "noteType", label: "Block2", key: "m2.block" }] },
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
function wireInstallState(state: CatalogState, userKits: UserKitDef[] = []): { writes: CatalogState[] } {
  const writes: CatalogState[] = [];
  syncInstallState({ catalogState: state, userKits });
  vi.mocked(entityClient.pluginPrefs).mockImplementation(() => {
    syncInstallState({ catalogState: state, userKits });
    return Promise.resolve({ prefs: { disabledContributions: [], viewerAssociations: { byContentType: {}, byNoteId: {} }, userKits, catalogState: state } });
  });
  vi.mocked(entityClient.putPluginCatalog).mockImplementation((body) => {
    writes.push(body.catalogState);
    syncInstallState({ catalogState: body.catalogState, userKits: body.userKits ?? userKits });
    return Promise.resolve({ prefs: { disabledContributions: [], viewerAssociations: { byContentType: {}, byNoteId: {} }, userKits, catalogState: body.catalogState } });
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

beforeEach(() => {
  setLocale("zh");
});

// —— tests ————————————————————————————————————————————————————————————————————

describe("plugin.manager kit view — chrome", () => {
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

  it("keeps search collapsed as a top-row icon and expands an input below the tabs", async () => {
    catalogFixture();
    wireInstallState({ installedPlugins: [], installedKits: ["kit-a"] });
    const { container, cleanup } = await renderPanel(ctxWith({}));

    expect(container.querySelector(".plugin-search-toggle")).toBeTruthy();
    expect(container.querySelector(".plugin-search-row")).toBeNull();
    await click(container.querySelector(".plugin-search-toggle"));
    const input = container.querySelector<HTMLInputElement>(".plugin-search-row .market-search");
    expect(input).toBeTruthy();
    expect(input!.getAttribute("aria-label")).toBe("搜索已安装套件");

    await click(container.querySelector(".market-tab-market"));
    expect(container.querySelector<HTMLInputElement>(".plugin-search-row .market-search")!.getAttribute("aria-label")).toBe("搜索市场");
    cleanup();
  });

  it("zh and en each render their OWN strings — no locale mixing", async () => {
    catalogFixture();
    wireInstallState({ installedPlugins: [], installedKits: ["kit-a"] });
    const zh = await renderPanel(ctxWith({}));
    expect(zh.container.querySelector(".panel-title")!.textContent).toContain("套件");
    expect(zh.container.querySelector(".market-tab-installed")!.textContent).toBe("已安装");
    // The capability-group names resolve in zh — the en label must NOT leak.
    expect(zh.container.textContent).toContain("闪记组");
    expect(zh.container.textContent).not.toContain("Flash group");
    expect(zh.container.textContent).toContain("个能力组");
    zh.cleanup();

    setLocale("en");
    const en = await renderPanel(ctxWith({}));
    expect(en.container.querySelector(".panel-title")!.textContent).toContain("Kits");
    expect(en.container.querySelector(".market-tab-installed")!.textContent).toBe("Installed");
    expect(en.container.textContent).toContain("Flash group");
    expect(en.container.textContent).not.toContain("闪记组");
    expect(en.container.textContent).toContain("capability groups");
    await click(en.container.querySelector(".plugin-search-toggle"));
    expect(en.container.querySelector<HTMLInputElement>(".plugin-search-row .market-search")!.getAttribute("aria-label")).toBe(
      "Search installed kits"
    );
    en.cleanup();
  });
});

describe("已安装 (manage) tab — kit cards", () => {
  it("one card per installed kit with the capability-group breakdown; NO plugin list", async () => {
    catalogFixture();
    wireInstallState({ installedPlugins: [], installedKits: ["kit-a"] });
    const { container, cleanup } = await renderPanel(ctxWith({}));

    const card = container.querySelector('.kit-card[data-kit-id="kit-a"]');
    expect(card).toBeTruthy();
    expect(card!.textContent).toContain("Kit A 套件");
    expect(card!.textContent).toContain("2 个能力组");
    // Group breakdown rows with their toggle state: g1 on (default), g2 off (opt-in).
    const g1 = card!.querySelector('.kit-group-row[data-group-id="g1"] input') as HTMLInputElement;
    const g2 = card!.querySelector('.kit-group-row[data-group-id="g2"] input') as HTMLInputElement;
    expect(g1.checked).toBe(true);
    expect(g2.checked).toBe(false);
    // FLAT: the plugin list is GONE — no member/standalone plugin rows anywhere.
    expect(container.querySelector(".plugin-row")).toBeNull();
    expect(container.querySelector(".market-standalone-group")).toBeNull();
    expect(container.querySelector('[data-plugin-id]')).toBeNull();
    cleanup();
  });

  it("a group toggle persists the disabledGroups switchboard through the catalog seam", async () => {
    catalogFixture();
    const { writes } = wireInstallState({ installedPlugins: [], installedKits: ["kit-a"] });
    const { container, cleanup } = await renderPanel(ctxWith({}));

    // Enable the opt-in g2: the per-kit key materializes from the defaults minus g2.
    await click(container.querySelector('.kit-group-row[data-group-id="g2"] input'));
    expect(writes).toHaveLength(1);
    expect(writes[0].disabledGroups?.["kit-a"]).toEqual([]);
    expect(
      (container.querySelector('.kit-group-row[data-group-id="g2"] input') as HTMLInputElement).checked
    ).toBe(true);

    // Disable g1 on the new truth.
    await click(container.querySelector('.kit-group-row[data-group-id="g1"] input'));
    expect(writes[1].disabledGroups?.["kit-a"]).toEqual(["g1"]);
    cleanup();
  });

  it("the kit-level switch disables EVERY group / re-enables back to the group defaults", async () => {
    catalogFixture();
    const { writes } = wireInstallState({ installedPlugins: [], installedKits: ["kit-a"] });
    const { container, cleanup } = await renderPanel(ctxWith({}));

    const kitSwitch = container.querySelector('.kit-card[data-kit-id="kit-a"] .kit-enable-toggle input') as HTMLInputElement;
    expect(kitSwitch.checked).toBe(true); // g1 enabled ⇒ kit enabled
    await click(kitSwitch);
    expect(writes[0].disabledGroups?.["kit-a"]).toEqual(["g1", "g2"]);
    expect(container.querySelector(".kit-card-disabled-note")).toBeTruthy();

    await click(container.querySelector('.kit-card[data-kit-id="kit-a"] .kit-enable-toggle input'));
    expect(writes[1].disabledGroups?.["kit-a"]).toBeUndefined(); // back to defaults
    cleanup();
  });

  it("uninstall confirms, notes that notes keep rendering, then persists the kit removal", async () => {
    catalogFixture();
    const { writes } = wireInstallState({ installedPlugins: [], installedKits: ["kit-a"] });
    const { container, cleanup } = await renderPanel(ctxWith({}));

    await click(container.querySelector('.kit-card[data-kit-id="kit-a"] .kit-uninstall-btn'));
    const confirm = container.querySelector(".kit-removal-confirm");
    expect(confirm).toBeTruthy();
    expect(confirm!.textContent).toContain("移除 «Kit A 套件»?");
    expect(confirm!.textContent).toContain("已生成的笔记照常显示");

    await click(confirm!.querySelector(".kit-removal-confirm-btn"));
    expect(writes).toHaveLength(1);
    expect(writes[0].installedKits).toEqual([]);
    expect(container.querySelector('.kit-card[data-kit-id="kit-a"]')).toBeNull();
    expect(container.textContent).toContain("还没有安装套件。");
    cleanup();
  });

  it("a USER kit renders as a card whose members are implicit groups (names from the read model)", async () => {
    catalogFixture();
    wireInstallState(
      { installedPlugins: [], installedKits: ["user:exam"] },
      [{ id: "user:exam", name: "Exam Prep", members: ["m1"] }]
    );
    const { container, cleanup } = await renderPanel(ctxWith({}));
    const card = container.querySelector('.kit-card[data-kit-id="user:exam"]');
    expect(card).toBeTruthy();
    expect(card!.textContent).toContain("Exam Prep");
    const row = card!.querySelector('.kit-group-row[data-group-id="m1"]');
    expect(row).toBeTruthy();
    expect(row!.textContent).toContain("M1 闪记"); // resolved via installedPlugins, not the catalog
    cleanup();
  });

  it("search filters the kit cards (name/desc/group names)", async () => {
    catalogFixture();
    wireInstallState({ installedPlugins: [], installedKits: ["kit-a", "textbook-learning"] });
    const { container, cleanup } = await renderPanel(ctxWith({}));
    expect(container.querySelectorAll(".kit-card")).toHaveLength(2);

    await click(container.querySelector(".plugin-search-toggle"));
    const search = container.querySelector(".market-search") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(search, "闪记组");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {});
    const cards = Array.from(container.querySelectorAll(".kit-card"));
    expect(cards).toHaveLength(1);
    expect(cards[0].getAttribute("data-kit-id")).toBe("kit-a");
    cleanup();
  });

  it("keeps the Viewer conflicts section (the §8.5.5 Defaults surface)", async () => {
    catalogFixture();
    wireInstallState({ installedPlugins: [], installedKits: ["kit-a"] });
    const { container, cleanup } = await renderPanel(ctxWith({}));
    expect(container.textContent).toContain("Viewer 冲突");
    cleanup();
  });
});

describe("市场 (browse) tab — kits only", () => {
  it("lists KIT cards only, badges installed kits, installs by kit id", async () => {
    catalogFixture();
    const { writes } = wireInstallState({ installedPlugins: [], installedKits: ["kit-a"] });
    const { container, cleanup } = await renderPanel(ctxWith({}));

    await click(container.querySelector(".market-tab-market"));
    expect(container.querySelector(".market-browse")).toBeTruthy();
    // Kits only — no plugin cards, no kind filter chips.
    const kinds = Array.from(container.querySelectorAll(".market-card")).map((c) => c.getAttribute("data-kind"));
    expect(kinds.length).toBeGreaterThan(0);
    expect(kinds.every((k) => k === "kit")).toBe(true);
    expect(container.querySelector('.market-card[data-entry-id="m1"]')).toBeNull();
    expect(container.querySelector(".market-kind-filter")).toBeNull();

    // kit-a is installed → badge; the bundled Textbook Kit is not (in this state) → install.
    expect(container.querySelector('.market-card[data-entry-id="kit-a"] .market-installed-badge')).toBeTruthy();
    const textbook = container.querySelector('.market-card[data-entry-id="textbook-learning"]');
    expect(textbook!.textContent).toContain("10 个能力组");
    await click(textbook!.querySelector(".market-install-btn"));
    expect(writes).toHaveLength(1);
    expect(writes[0].installedKits).toEqual(["kit-a", "textbook-learning"]);
    expect(container.querySelector('.market-card[data-entry-id="textbook-learning"] .market-installed-badge')).toBeTruthy();
    cleanup();
  });

  it("search goes through the SAME CatalogSource query", async () => {
    catalogFixture();
    wireInstallState({ installedPlugins: [], installedKits: ["kit-a"] });
    const { container, cleanup } = await renderPanel(ctxWith({}));

    await click(container.querySelector(".market-tab-market"));
    await click(container.querySelector(".plugin-search-toggle"));
    const search = container.querySelector(".market-search") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(search, "bundle of m1");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {});
    const cards = Array.from(container.querySelectorAll(".market-card"));
    expect(cards).toHaveLength(1);
    expect(cards[0].getAttribute("data-entry-id")).toBe("kit-a");
    cleanup();
  });
});

describe("MH-0 acceptance — no direct registry import for the market listing", () => {
  it("pluginManagerViews imports the CatalogSource seam, never the catalog registry", () => {
    const source = readFileSync(path.join(__dirname, "pluginManagerViews.tsx"), "utf8");
    // The one allowed catalog surface: the CatalogSource contract module.
    expect(source).toMatch(/from "\.\.\/\.\.\/kits\/catalogSource"/);
    // The catalog registry itself must NOT be imported (listings flow through the
    // source; install state + groups flow through the installState seam).
    expect(source).not.toMatch(/from "\.\.\/\.\.\/kits\/catalog"/);
    expect(source).not.toMatch(/listCatalogEntries|BUNDLED_CATALOG|providerOf/);
    // And the market list renders from catalogSource("local").
    expect(source).toMatch(/catalogSource\("local"\)\s*\n?\s*\.list\(|catalogSource\("local"\)\.list\(/);
  });
});
