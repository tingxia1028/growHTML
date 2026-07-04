// Kit & Plugin MARKET (M1 — docs/design/plugin-viewer-model.md §8.4/§8.5, carrying the
// MH-0 CatalogSource seam of docs/design/marketplace-hosted.md §5). The left-rail entry
// and the view kind stay `plugin.manager` (presets/workspace.json need no migration);
// the P2 flat panel is superseded: its contribution-toggle rows + the ViewerConflicts
// picker live on INSIDE the 已安装 tab (the relocated "Advanced" / "Defaults" sections).
//
// Two tabs:
//   已安装 (manage)  — the effective-installed set: kit groups + standalone plugins,
//                      plugin enable/disable (= all its contributions), per-contribution
//                      Advanced toggles, uninstall with the §8.5.2 per-member outcome
//                      confirmation, viewer-conflict surfacing (§8.5.5).
//   市场   (browse)  — installable entries. MH-0 ACCEPTANCE: this listing renders ONLY
//                      through `catalogSource("local")` — the read-only CatalogSource
//                      contract — never by importing the catalog registry directly.
//                      Local listings omit publisher/pricing (optional fields).
//
// Data seams (the P2 iron law, amended for M1): panel-owned prefs (disabled set +
// viewer pins) still go ONLY through ctx.setContributionEnabled / ctx.pinViewer.
// MARKET install state is manager-side (marketplace-hosted §5) and WorkspaceContext
// does not own it, so this view reads/writes it through entityClient's dedicated
// catalog seam (`putPluginCatalog` → PUT /api/plugin-prefs/catalog) + the module-scope
// install-state store — the server keeps the two writers from clobbering each other
// (single-writer-per-field-group, see src/server/services/workspace.ts).
//
// Rendering is NEVER touched by install state: uninstall hides CREATE affordances only
// (kitSurfaceItems / slash palette / viewer eligibility); getNoteType() stays registered
// (the adaptive-note contract).

import { useEffect, useMemo, useState } from "react";
import { Blocks, Package, Puzzle, Search } from "lucide-react";
import { defineMessages, t, useLocale, type Message } from "../i18n";
import { registerView, type WorkspaceContext } from "./viewRegistry";
import type { PluginRecord } from "../../kits/plugin";
import { listViewers, resolveViewer, NOTETYPE_SENTINEL } from "../notes/viewerRegistry";
import { catalogSource, type CatalogListing } from "../../kits/catalogSource";
import {
  installStateSnapshot,
  holdsOf,
  kitRemovalOutcome,
  withKitInstalled,
  withKitUninstalled,
  withPluginInstalled,
  withPluginUninstalled,
  type CatalogState,
  type UserKitDef
} from "../../kits/installState";
import { entityClient } from "../data/entityClient";

// A short human label for a contribution kind (the row's kind badge).
const pluginManagerMessages = defineMessages({
  title: { zh: "插件", en: "Kit & Plugin" },
  installedTab: { zh: "已安装", en: "Installed" },
  marketTab: { zh: "市场", en: "Market" },
  hideSearch: { zh: "收起插件搜索", en: "Hide plugin search" },
  showSearch: { zh: "搜索插件", en: "Search plugins" },
  searchMarket: { zh: "搜索市场…", en: "Search market…" },
  searchInstalled: { zh: "搜索已安装…", en: "Search installed…" },
  searchMarketLabel: { zh: "搜索市场", en: "Search the market" },
  searchInstalledLabel: { zh: "搜索已安装插件", en: "Search installed plugins" },
  saveInstallFailed: { zh: "保存安装状态失败", en: "Failed to save install state" },
  pluginCount: { zh: "个插件", en: "plugins" },
  uninstall: { zh: "卸载", en: "Uninstall" },
  removeKit: { zh: "移除", en: "Remove" },
  keep: { zh: "保留", en: "Keep" },
  listSeparator: { zh: "、", en: ", " },
  remove: { zh: "移除", en: "Remove" },
  directInstall: { zh: "直接安装", en: "direct install" },
  alsoIn: { zh: "也在", en: "also in" },
  viewerFallback: { zh: "Viewer 回退到默认渲染", en: "Viewer falls back to the default renderer" },
  confirmUninstall: { zh: "确认卸载", en: "Confirm uninstall" },
  cancel: { zh: "取消", en: "Cancel" },
  standalonePlugins: { zh: "插件", en: "Plugins" },
  noInstalled: { zh: "还没有安装套件或插件。", en: "No kits or plugins installed." },
  noInstalledMatches: { zh: "没有匹配的已安装插件。", en: "No installed plugins match this search." },
  installedVia: { zh: "经", en: "Installed via" },
  builtin: { zh: "内置", en: "Built in" },
  enableToggleTitle: {
    zh: "启用/停用（隐藏创建入口，不影响渲染）",
    en: "Enable/disable creation entry points without changing rendering"
  },
  removeDirectTitle: {
    zh: "移除直接安装（仍由套件提供；要完全移除请卸载该套件）",
    en: "Remove the direct install. The kit still provides it; uninstall the kit to remove it fully."
  },
  uninstallViewerTitle: {
    zh: "卸载（其 Viewer 回退到默认渲染；已有笔记照常显示）",
    en: "Uninstall. Its viewer falls back to default rendering; existing notes still display."
  },
  uninstallTitle: {
    zh: "卸载（已有笔记照常显示）",
    en: "Uninstall. Existing notes still display."
  },
  advanced: { zh: "高级", en: "Advanced" },
  enablePrefix: { zh: "启用", en: "Enable" },
  togglePrefix: { zh: "切换", en: "Toggle" },
  all: { zh: "全部", en: "All" },
  plugins: { zh: "插件", en: "Plugins" },
  kits: { zh: "套件", en: "Kits" },
  loadingCatalog: { zh: "正在载入市场…", en: "Loading catalog…" },
  noCatalogEntries: { zh: "暂无市场条目。", en: "No catalog entries." },
  installedBadge: { zh: "已安装 ✓", en: "Installed ✓" },
  install: { zh: "安装", en: "Install" },
  viewerConflicts: { zh: "Viewer 冲突", en: "Viewer conflicts" },
  noViewerConflicts: { zh: "没有 Viewer 冲突。", en: "No viewer conflicts." },
  defaultNoteType: { zh: "默认（笔记类型）", en: "Default (note type)" },
  resolvedBy: { zh: "解析来源:", en: "Resolved by:" },
  viewerFor: { zh: "Viewer:", en: "Viewer for" },
  auto: { zh: "自动", en: "Auto" },
  noteTypeKind: { zh: "笔记类型", en: "Note Type" },
  viewerKind: { zh: "Viewer", en: "Viewer" },
  commandKind: { zh: "命令", en: "Command" },
  surfaceKind: { zh: "入口", en: "Surface" },
  languageKind: { zh: "语言", en: "Language" },
  layoutKind: { zh: "布局", en: "Layout" },
  promptKind: { zh: "提示词", en: "Prompt" },
  layerPolicyKind: { zh: "层策略", en: "Layer Policy" }
});

const KIND_LABEL: Record<string, Message> = {
  noteType: pluginManagerMessages.noteTypeKind,
  viewer: pluginManagerMessages.viewerKind,
  command: pluginManagerMessages.commandKind,
  surface: pluginManagerMessages.surfaceKind,
  language: pluginManagerMessages.languageKind,
  layout: pluginManagerMessages.layoutKind,
  prompt: pluginManagerMessages.promptKind,
  layerPolicy: pluginManagerMessages.layerPolicyKind
};

type Snapshot = {
  catalogState: CatalogState;
  userKits: readonly UserKitDef[];
  effectivePluginIds: Set<string>;
  installedKitIds: string[];
};

function KitPluginMarketView({ ctx }: { ctx: WorkspaceContext }) {
  useLocale();
  const [tab, setTab] = useState<"installed" | "market">("installed");
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [kindFilter, setKindFilter] = useState<"all" | "plugin" | "kit">("all");
  const [listings, setListings] = useState<CatalogListing[] | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot>(() => installStateSnapshot());
  const [marketError, setMarketError] = useState("");

  // MH-0: the market listing comes ONLY through CatalogSource("local"). Re-queried on
  // search/kind so the SAME call shape works against a remote source later.
  useEffect(() => {
    let live = true;
    void catalogSource("local")
      .list({ kind: kindFilter === "all" ? undefined : kindFilter, search: search || undefined })
      .then((all) => {
        if (live) setListings(all);
      })
      .catch(() => {
        if (live) setListings([]);
      });
    return () => {
      live = false;
    };
  }, [kindFilter, search]);

  // Refresh the install state from the vault on mount (entityClient syncs the module
  // store from the response). Best-effort: on failure the store's default —
  // null state = the default-installed set — keeps today's behavior.
  useEffect(() => {
    let live = true;
    entityClient
      .pluginPrefs()
      .then(() => {
        if (live) setSnapshot(installStateSnapshot());
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  // The ONE market write seam: persist the next catalogState, then re-read the synced
  // module store (the response refreshed it) so this view re-renders on truth.
  const persist = (next: CatalogState) => {
    setMarketError("");
    entityClient
      .putPluginCatalog({ catalogState: next })
      .then(() => setSnapshot(installStateSnapshot()))
      .catch((err) => setMarketError(err instanceof Error ? err.message : t(pluginManagerMessages.saveInstallFailed)));
  };

  return (
    <aside className="plugin-manager-panel">
      <div className="panel-title">
        <Blocks size={16} />
        {t(pluginManagerMessages.title)}
      </div>

      <div className="plugin-manager-tabs-row">
        <div className="market-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            className={`market-tab market-tab-installed${tab === "installed" ? " active" : ""}`}
            aria-selected={tab === "installed"}
            onClick={() => setTab("installed")}
          >
            {t(pluginManagerMessages.installedTab)}
          </button>
          <button
            type="button"
            role="tab"
            className={`market-tab market-tab-market${tab === "market" ? " active" : ""}`}
            aria-selected={tab === "market"}
            onClick={() => setTab("market")}
          >
            {t(pluginManagerMessages.marketTab)}
          </button>
        </div>
        <button
          type="button"
          className={`plugin-search-toggle${searchOpen ? " active" : ""}`}
          aria-label={searchOpen ? t(pluginManagerMessages.hideSearch) : t(pluginManagerMessages.showSearch)}
          aria-pressed={searchOpen}
          onClick={() => {
            if (searchOpen) setSearch("");
            setSearchOpen((open) => !open);
          }}
        >
          <Search size={15} />
        </button>
      </div>

      {searchOpen ? (
        <div className="plugin-search-row">
          <Search size={14} aria-hidden="true" />
          <input
            className="market-search"
            placeholder={tab === "market" ? t(pluginManagerMessages.searchMarket) : t(pluginManagerMessages.searchInstalled)}
            aria-label={tab === "market" ? t(pluginManagerMessages.searchMarketLabel) : t(pluginManagerMessages.searchInstalledLabel)}
            value={search}
            autoFocus
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      ) : null}

      {marketError ? <div className="error-box market-error">{marketError}</div> : null}

      {tab === "installed" ? (
        <InstalledTab ctx={ctx} snapshot={snapshot} listings={listings} search={search} persist={persist} />
      ) : (
        <MarketTab
          snapshot={snapshot}
          listings={listings}
          kindFilter={kindFilter}
          setKindFilter={setKindFilter}
          persist={persist}
        />
      )}
    </aside>
  );
}

// —— 已安装 (manage) ————————————————————————————————————————————————————————

function InstalledTab({
  ctx,
  snapshot,
  listings,
  search,
  persist
}: {
  ctx: WorkspaceContext;
  snapshot: Snapshot;
  listings: CatalogListing[] | null;
  search: string;
  persist(next: CatalogState): void;
}) {
  const { installedPlugins } = ctx;
  const [confirmingKitId, setConfirmingKitId] = useState<string | null>(null);
  // Cataloged-ness WITHOUT importing the catalog registry: the loaded market listings
  // cover every cataloged id (kits + plugins). Uncataloged runtime plugins (test kits,
  // the synthetic "core") are always-on — shown without install controls.
  const catalogedIds = useMemo(() => new Set((listings ?? []).map((l) => l.id)), [listings]);
  const isKitInstalledNow = (kitId: string): boolean => snapshot.installedKitIds.includes(kitId);

  const nameOf = (pluginId: string): string =>
    installedPlugins.find((p) => p.id === pluginId)?.name ??
    (listings ?? []).find((l) => l.id === pluginId)?.title ??
    pluginId;
  const query = search.trim().toLowerCase();
  const matches = (...parts: Array<string | undefined>): boolean =>
    !query || parts.some((part) => (part ?? "").toLowerCase().includes(query));
  const pluginMatches = (plugin: PluginRecord): boolean =>
    matches(
      plugin.name,
      plugin.id,
      plugin.kitId,
      ...plugin.contributions.flatMap((contribution) => [contribution.label, contribution.key, contribution.kind])
    );

  // Kit groups = kit records whose kit is INSTALLED; their members are the read-model
  // plugins tagged with that kitId. Everything else effective-installed lists as a
  // standalone plugin row (incl. members of an uninstalled kit that are held directly).
  const kitRecords = installedPlugins.filter(
    (p) => p.kitId === p.id && catalogedIds.has(p.id) && isKitInstalledNow(p.id)
  );
  const memberOfInstalledKit = (p: PluginRecord): boolean =>
    !!p.kitId && p.kitId !== p.id && kitRecords.some((kit) => kit.id === p.kitId);
  const standalonePlugins = installedPlugins.filter((p) => {
    if (p.id === "core") return false; // core primitives: hidden (§8.1)
    if (p.kitId === p.id) return false; // a kit record
    if (memberOfInstalledKit(p)) return false; // rendered inside its kit group
    // Cataloged → must be effective-installed to appear here; uncataloged → always-on.
    return catalogedIds.has(p.id) ? snapshot.effectivePluginIds.has(p.id) : true;
  });
  const visibleKitGroups = kitRecords
    .map((kit) => {
      const members = installedPlugins.filter((p) => p.kitId === kit.id && p.id !== kit.id);
      const kitMatches = pluginMatches(kit);
      const visibleMembers = kitMatches ? members : members.filter(pluginMatches);
      return { kit, members, visibleMembers, visible: kitMatches || visibleMembers.length > 0 };
    })
    .filter((entry) => entry.visible);
  const visibleStandalonePlugins = standalonePlugins.filter(pluginMatches);
  const hasInstalledItems = kitRecords.length > 0 || standalonePlugins.length > 0;
  const hasVisibleItems = visibleKitGroups.length > 0 || visibleStandalonePlugins.length > 0;

  return (
    <div className="market-installed">
      <div className="plugin-manager-list record-list">
        {visibleKitGroups.map(({ kit, members, visibleMembers }) => {
          const outcome = kitRemovalOutcome(kit.id, snapshot.catalogState, snapshot.userKits);
          return (
            <div key={kit.id} className="plugin-kit-group" data-kit-id={kit.id}>
              <div className="plugin-kit-head">
                <div className="plugin-kit-name">
                  <Package size={13} /> {kit.name}
                  <span className="market-kit-count">{members.length} {t(pluginManagerMessages.pluginCount)}</span>
                </div>
                <button
                  type="button"
                  className="link-button kit-uninstall-btn"
                  onClick={() => setConfirmingKitId(confirmingKitId === kit.id ? null : kit.id)}
                >
                  {t(pluginManagerMessages.uninstall)}
                </button>
              </div>
              {confirmingKitId === kit.id ? (
                <div className="kit-removal-confirm" data-kit-id={kit.id}>
                  <div className="kit-removal-title">{t(pluginManagerMessages.removeKit)} «{kit.name}»?</div>
                  <ul className="kit-removal-list">
                    {outcome.map((row) => (
                      <li key={row.pluginId} className="kit-removal-row" data-plugin-id={row.pluginId}>
                        <span className="kit-removal-name">{nameOf(row.pluginId)}</span>
                        <span className={`kit-removal-outcome ${row.kept ? "kept" : "removed"}`}>
                          {row.kept
                            ? `${t(pluginManagerMessages.keep)}(${row.keptBy
                                .map((k) => (k === "direct" ? t(pluginManagerMessages.directInstall) : `${t(pluginManagerMessages.alsoIn)} «${nameOf(k)}»`))
                                .join(t(pluginManagerMessages.listSeparator))})`
                            : t(pluginManagerMessages.remove)}
                        </span>
                        {/* §8.5.5: name the viewer fallback for members losing a viewer slot. */}
                        {!row.kept &&
                        installedPlugins
                          .find((p) => p.id === row.pluginId)
                          ?.contributions.some((c) => c.kind === "viewer") ? (
                          <span className="kit-removal-viewer-note">{t(pluginManagerMessages.viewerFallback)}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  <div className="kit-removal-actions">
                    <button
                      type="button"
                      className="kit-removal-confirm-btn"
                      onClick={() => {
                        setConfirmingKitId(null);
                        persist(withKitUninstalled(snapshot.catalogState, kit.id));
                      }}
                    >
                      {t(pluginManagerMessages.confirmUninstall)}
                    </button>
                    <button type="button" className="link-button" onClick={() => setConfirmingKitId(null)}>
                      {t(pluginManagerMessages.cancel)}
                    </button>
                  </div>
                </div>
              ) : null}
              {visibleMembers.map((plugin) => (
                <InstalledPluginRow
                  key={plugin.id}
                  ctx={ctx}
                  plugin={plugin}
                  snapshot={snapshot}
                  cataloged={catalogedIds.has(plugin.id)}
                  nameOf={nameOf}
                  persist={persist}
                />
              ))}
            </div>
          );
        })}

        {visibleStandalonePlugins.length > 0 ? (
          <div className="plugin-kit-group market-standalone-group">
            <div className="plugin-kit-name">
              <Puzzle size={13} /> {t(pluginManagerMessages.standalonePlugins)}
            </div>
            {visibleStandalonePlugins.map((plugin) => (
              <InstalledPluginRow
                key={plugin.id}
                ctx={ctx}
                plugin={plugin}
                snapshot={snapshot}
                cataloged={catalogedIds.has(plugin.id)}
                nameOf={nameOf}
                persist={persist}
              />
            ))}
          </div>
        ) : null}

        {!hasInstalledItems ? (
          <div className="empty-state">{t(pluginManagerMessages.noInstalled)}</div>
        ) : null}
        {query && !hasVisibleItems ? (
          <div className="empty-state">{t(pluginManagerMessages.noInstalledMatches)}</div>
        ) : null}
      </div>

      <ViewerConflicts ctx={ctx} plugins={installedPlugins} />
    </div>
  );
}

// One installed plugin row: name · provenance · enable switch (= all contributions) ·
// uninstall (direct holds only, §8.5.2) · <details> Advanced (the relocated P2 rows).
function InstalledPluginRow({
  ctx,
  plugin,
  snapshot,
  cataloged,
  nameOf,
  persist
}: {
  ctx: WorkspaceContext;
  plugin: PluginRecord;
  snapshot: Snapshot;
  cataloged: boolean;
  nameOf(id: string): string;
  persist(next: CatalogState): void;
}) {
  const { pluginPrefs, setContributionEnabled } = ctx;
  const disabled = new Set(pluginPrefs.disabledContributions);
  const holds = cataloged ? holdsOf(plugin.id, snapshot.catalogState, snapshot.userKits) : null;
  const contributions = plugin.contributions;
  // Plugin-level enabled = at least one contribution enabled (a zero-contribution
  // record has no switch). Toggling writes EVERY contribution through the P2 seam —
  // "uninstalled behaves like every authoring contribution disabled" (§8.5.1), and
  // enable/disable is exactly that, reversibly, without touching install state.
  const enabled = contributions.some((c) => !disabled.has(c.id));
  const toggleAll = (next: boolean) => {
    for (const contribution of contributions) setContributionEnabled(contribution.id, next);
  };
  const hasViewer = contributions.some((c) => c.kind === "viewer");

  return (
    <div className="plugin-row installed-plugin-row" data-plugin-id={plugin.id}>
      <div className="installed-plugin-head">
        <span className="plugin-name">{plugin.name}</span>
        {holds && !holds.direct && holds.viaKits.length > 0 ? (
          <span className="plugin-provenance">
            {t(pluginManagerMessages.installedVia)} {holds.viaKits.map((kitId) => `«${nameOf(kitId)}»`).join(t(pluginManagerMessages.listSeparator))}
          </span>
        ) : null}
        {!cataloged ? <span className="plugin-provenance">{t(pluginManagerMessages.builtin)}</span> : null}
        {contributions.length > 0 ? (
          <label className="plugin-contrib-toggle plugin-enable-toggle sv-switch" title={t(pluginManagerMessages.enableToggleTitle)}>
            <input
              type="checkbox"
              className="sv-switch-input"
              checked={enabled}
              aria-label={`${t(pluginManagerMessages.enablePrefix)} ${plugin.name}`}
              onChange={(event) => toggleAll(event.target.checked)}
            />
            <span className="sv-switch-track" aria-hidden="true" />
          </label>
        ) : null}
        {holds?.direct ? (
          <button
            type="button"
            className="link-button plugin-uninstall-btn"
            title={
              holds.viaKits.length > 0
                ? t(pluginManagerMessages.removeDirectTitle)
                : hasViewer
                  ? t(pluginManagerMessages.uninstallViewerTitle)
                  : t(pluginManagerMessages.uninstallTitle)
            }
            onClick={() => persist(withPluginUninstalled(snapshot.catalogState, plugin.id))}
          >
            {t(pluginManagerMessages.uninstall)}
          </button>
        ) : null}
      </div>
      {contributions.length > 0 ? (
        <details className="plugin-advanced">
          <summary className="plugin-advanced-summary">{t(pluginManagerMessages.advanced)}</summary>
          <ul className="plugin-contrib-list">
            {contributions.map((contribution) => {
              const contributionEnabled = !disabled.has(contribution.id);
              return (
                <li key={contribution.id} className="plugin-contrib-row" data-contribution-id={contribution.id}>
                  <span className="plugin-contrib-kind">{KIND_LABEL[contribution.kind] ? t(KIND_LABEL[contribution.kind]) : contribution.kind}</span>
                  <span className="plugin-contrib-label">{contribution.label}</span>
                  <label className="plugin-contrib-toggle sv-switch">
                    <input
                      type="checkbox"
                      className="sv-switch-input"
                      checked={contributionEnabled}
                      aria-label={`${t(pluginManagerMessages.togglePrefix)} ${contribution.label}`}
                      onChange={(event) => setContributionEnabled(contribution.id, event.target.checked)}
                    />
                    <span className="sv-switch-track" aria-hidden="true" />
                  </label>
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

// —— 市场 (browse) ————————————————————————————————————————————————————————————

function MarketTab({
  snapshot,
  listings,
  kindFilter,
  setKindFilter,
  persist
}: {
  snapshot: Snapshot;
  listings: CatalogListing[] | null;
  kindFilter: "all" | "plugin" | "kit";
  setKindFilter(next: "all" | "plugin" | "kit"): void;
  persist(next: CatalogState): void;
}) {
  const installedKitSet = new Set(snapshot.installedKitIds);
  const isInstalled = (listing: CatalogListing): boolean =>
    listing.kind === "kit" ? installedKitSet.has(listing.id) : snapshot.effectivePluginIds.has(listing.id);

  return (
    <div className="market-browse">
      <div className="market-kind-filter">
        {(
          [
            ["all", t(pluginManagerMessages.all)],
            ["plugin", t(pluginManagerMessages.plugins)],
            ["kit", t(pluginManagerMessages.kits)]
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={`market-kind-chip${kindFilter === value ? " active" : ""}`}
            aria-pressed={kindFilter === value}
            onClick={() => setKindFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {listings === null ? (
        <div className="empty-state">{t(pluginManagerMessages.loadingCatalog)}</div>
      ) : listings.length === 0 ? (
        <div className="empty-state">{t(pluginManagerMessages.noCatalogEntries)}</div>
      ) : (
        <ul className="market-card-list">
          {listings.map((listing) => {
            const installed = isInstalled(listing);
            return (
              <li key={listing.id} className="market-card" data-entry-id={listing.id} data-kind={listing.kind}>
                <span className="market-card-icon" aria-hidden="true">
                  {listing.kind === "kit" ? <Package size={16} /> : <Puzzle size={16} />}
                </span>
                <span className="market-card-main">
                  <span className="market-card-title">
                    {listing.title}
                    {listing.kind === "kit" && typeof listing.memberCount === "number" ? (
                      <span className="market-kit-count">{listing.memberCount} {t(pluginManagerMessages.pluginCount)}</span>
                    ) : null}
                  </span>
                  <span className="market-card-desc">{listing.description}</span>
                </span>
                {installed ? (
                  <span className="market-installed-badge">{t(pluginManagerMessages.installedBadge)}</span>
                ) : (
                  <button
                    type="button"
                    className="market-install-btn"
                    onClick={() =>
                      persist(
                        listing.kind === "kit"
                          ? withKitInstalled(snapshot.catalogState, listing.id)
                          : withPluginInstalled(snapshot.catalogState, listing.id)
                      )
                    }
                  >
                    {t(pluginManagerMessages.install)}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// —— Viewer conflicts (plugin-viewer-model §4 / §8.5.5 "Defaults / conflicts") ————
// Relocated from the P2 panel unchanged in semantics: for each contentType that ≥2
// viewers are willing to handle, show the current WINNER (from resolveViewer) and a
// picker that pins a per-contentType association via ctx.pinViewer.
function ViewerConflicts({ ctx, plugins }: { ctx: WorkspaceContext; plugins: readonly PluginRecord[] }) {
  // Every contentType a note-type contribution declares (the universe of types that could
  // be viewed), de-duped.
  const contentTypes = Array.from(
    new Set(
      plugins.flatMap((p) => p.contributions.filter((c) => c.kind === "noteType" && c.key).map((c) => c.key as string))
    )
  ).sort();

  const viewers = listViewers();
  // Per-type candidate viewers = those whose match({contentType}) > 0. Only types with ≥2
  // candidates are a CONFLICT the user resolves here.
  const conflicts = contentTypes
    .map((contentType) => {
      const candidates = viewers.filter((v) => {
        try {
          return v.match({ contentType }) > 0;
        } catch {
          return false;
        }
      });
      return { contentType, candidates };
    })
    .filter((entry) => entry.candidates.length > 1);

  const pinnedFor = (contentType: string): string =>
    ctx.pluginPrefs.viewerAssociations?.byContentType?.[contentType] ?? "";

  return (
    <div className="plugin-viewer-conflicts">
      <div className="plugin-section-title">{t(pluginManagerMessages.viewerConflicts)}</div>
      {conflicts.length === 0 ? (
        <div className="empty-state">{t(pluginManagerMessages.noViewerConflicts)}</div>
      ) : (
        <ul className="viewer-conflict-list">
          {conflicts.map(({ contentType, candidates }) => {
            const winner = resolveViewer({ contentType }, ctx.pluginPrefs);
            const winnerLabel =
              winner.viewerId === NOTETYPE_SENTINEL
                ? t(pluginManagerMessages.defaultNoteType)
                : candidates.find((c) => c.id === winner.viewerId)?.label ?? winner.viewerId;
            return (
              <li key={contentType} className="viewer-conflict-row" data-content-type={contentType}>
                <span className="viewer-conflict-type">{contentType}</span>
                <span className="viewer-conflict-winner" title={`${t(pluginManagerMessages.resolvedBy)} ${winner.source}`}>
                  {winnerLabel}
                </span>
                <select
                  className="viewer-conflict-picker"
                  aria-label={`${t(pluginManagerMessages.viewerFor)} ${contentType}`}
                  value={pinnedFor(contentType)}
                  onChange={(event) => ctx.pinViewer({ contentType }, event.target.value)}
                >
                  {/* Empty = no explicit pin (resolver's automatic choice). */}
                  <option value="">{t(pluginManagerMessages.auto)} ({winnerLabel})</option>
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                  <option value={NOTETYPE_SENTINEL}>{t(pluginManagerMessages.defaultNoteType)}</option>
                </select>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

registerView({ kind: "plugin.manager", render: (_node, ctx) => <KitPluginMarketView ctx={ctx} /> });
