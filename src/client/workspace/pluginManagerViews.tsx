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
import { Blocks, Package, Puzzle } from "lucide-react";
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
const KIND_LABEL: Record<string, string> = {
  noteType: "Note Type",
  viewer: "Viewer",
  command: "Command",
  surface: "Surface",
  language: "Language",
  layout: "Layout",
  prompt: "Prompt",
  layerPolicy: "Layer Policy"
};

type Snapshot = {
  catalogState: CatalogState;
  userKits: readonly UserKitDef[];
  effectivePluginIds: Set<string>;
  installedKitIds: string[];
};

function KitPluginMarketView({ ctx }: { ctx: WorkspaceContext }) {
  const [tab, setTab] = useState<"installed" | "market">("installed");
  const [search, setSearch] = useState("");
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
      .catch((err) => setMarketError(err instanceof Error ? err.message : "Failed to save install state"));
  };

  return (
    <aside className="plugin-manager-panel">
      <div className="panel-title">
        <Blocks size={16} />
        Kit &amp; Plugin
      </div>

      <div className="market-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          className={`market-tab market-tab-installed${tab === "installed" ? " active" : ""}`}
          aria-selected={tab === "installed"}
          onClick={() => setTab("installed")}
        >
          已安装
        </button>
        <button
          type="button"
          role="tab"
          className={`market-tab market-tab-market${tab === "market" ? " active" : ""}`}
          aria-selected={tab === "market"}
          onClick={() => setTab("market")}
        >
          市场
        </button>
        {tab === "market" ? (
          <input
            className="market-search"
            placeholder="搜索…"
            aria-label="Search the market"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        ) : null}
      </div>

      {marketError ? <div className="error-box market-error">{marketError}</div> : null}

      {tab === "installed" ? (
        <InstalledTab ctx={ctx} snapshot={snapshot} listings={listings} persist={persist} />
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
  persist
}: {
  ctx: WorkspaceContext;
  snapshot: Snapshot;
  listings: CatalogListing[] | null;
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

  return (
    <div className="market-installed">
      <div className="plugin-manager-list record-list">
        {kitRecords.map((kit) => {
          const members = installedPlugins.filter((p) => p.kitId === kit.id && p.id !== kit.id);
          const outcome = kitRemovalOutcome(kit.id, snapshot.catalogState, snapshot.userKits);
          return (
            <div key={kit.id} className="plugin-kit-group" data-kit-id={kit.id}>
              <div className="plugin-kit-head">
                <div className="plugin-kit-name">
                  <Package size={13} /> {kit.name}
                  <span className="market-kit-count">{members.length} plugins</span>
                </div>
                <button
                  type="button"
                  className="link-button kit-uninstall-btn"
                  onClick={() => setConfirmingKitId(confirmingKitId === kit.id ? null : kit.id)}
                >
                  卸载
                </button>
              </div>
              {confirmingKitId === kit.id ? (
                <div className="kit-removal-confirm" data-kit-id={kit.id}>
                  <div className="kit-removal-title">移除 «{kit.name}»?</div>
                  <ul className="kit-removal-list">
                    {outcome.map((row) => (
                      <li key={row.pluginId} className="kit-removal-row" data-plugin-id={row.pluginId}>
                        <span className="kit-removal-name">{nameOf(row.pluginId)}</span>
                        <span className={`kit-removal-outcome ${row.kept ? "kept" : "removed"}`}>
                          {row.kept
                            ? `保留(${row.keptBy
                                .map((k) => (k === "direct" ? "直接安装" : `也在 «${nameOf(k)}»`))
                                .join("、")})`
                            : "移除"}
                        </span>
                        {/* §8.5.5: name the viewer fallback for members losing a viewer slot. */}
                        {!row.kept &&
                        installedPlugins
                          .find((p) => p.id === row.pluginId)
                          ?.contributions.some((c) => c.kind === "viewer") ? (
                          <span className="kit-removal-viewer-note">Viewer 回退到默认渲染</span>
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
                      确认卸载
                    </button>
                    <button type="button" className="link-button" onClick={() => setConfirmingKitId(null)}>
                      取消
                    </button>
                  </div>
                </div>
              ) : null}
              {members.map((plugin) => (
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

        {standalonePlugins.length > 0 ? (
          <div className="plugin-kit-group market-standalone-group">
            <div className="plugin-kit-name">
              <Puzzle size={13} /> Plugins
            </div>
            {standalonePlugins.map((plugin) => (
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

        {kitRecords.length === 0 && standalonePlugins.length === 0 ? (
          <div className="empty-state">No kits or plugins installed.</div>
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
            经 {holds.viaKits.map((kitId) => `«${nameOf(kitId)}»`).join("、")} 安装
          </span>
        ) : null}
        {!cataloged ? <span className="plugin-provenance">内置</span> : null}
        {contributions.length > 0 ? (
          <label className="plugin-contrib-toggle plugin-enable-toggle" title="启用/停用(隐藏创建入口,不影响渲染)">
            <input
              type="checkbox"
              checked={enabled}
              aria-label={`Enable ${plugin.name}`}
              onChange={(event) => toggleAll(event.target.checked)}
            />
          </label>
        ) : null}
        {holds?.direct ? (
          <button
            type="button"
            className="link-button plugin-uninstall-btn"
            title={
              holds.viaKits.length > 0
                ? "移除直接安装(仍由套件提供;要完全移除请卸载该套件)"
                : hasViewer
                  ? "卸载(其 Viewer 回退到默认渲染;已有笔记照常显示)"
                  : "卸载(已有笔记照常显示)"
            }
            onClick={() => persist(withPluginUninstalled(snapshot.catalogState, plugin.id))}
          >
            卸载
          </button>
        ) : null}
      </div>
      {contributions.length > 0 ? (
        <details className="plugin-advanced">
          <summary className="plugin-advanced-summary">Advanced</summary>
          <ul className="plugin-contrib-list">
            {contributions.map((contribution) => {
              const contributionEnabled = !disabled.has(contribution.id);
              return (
                <li key={contribution.id} className="plugin-contrib-row" data-contribution-id={contribution.id}>
                  <span className="plugin-contrib-kind">{KIND_LABEL[contribution.kind] ?? contribution.kind}</span>
                  <span className="plugin-contrib-label">{contribution.label}</span>
                  <label className="plugin-contrib-toggle">
                    <input
                      type="checkbox"
                      checked={contributionEnabled}
                      aria-label={`Toggle ${contribution.label}`}
                      onChange={(event) => setContributionEnabled(contribution.id, event.target.checked)}
                    />
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
            ["all", "All"],
            ["plugin", "Plugins"],
            ["kit", "Kits"]
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
        <div className="empty-state">Loading catalog…</div>
      ) : listings.length === 0 ? (
        <div className="empty-state">No catalog entries.</div>
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
                      <span className="market-kit-count">{listing.memberCount} plugins</span>
                    ) : null}
                  </span>
                  <span className="market-card-desc">{listing.description}</span>
                </span>
                {installed ? (
                  <span className="market-installed-badge">Installed ✓</span>
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
                    Install
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
      <div className="plugin-section-title">Viewer conflicts</div>
      {conflicts.length === 0 ? (
        <div className="empty-state">No viewer conflicts.</div>
      ) : (
        <ul className="viewer-conflict-list">
          {conflicts.map(({ contentType, candidates }) => {
            const winner = resolveViewer({ contentType }, ctx.pluginPrefs);
            const winnerLabel =
              winner.viewerId === NOTETYPE_SENTINEL
                ? "Default (note type)"
                : candidates.find((c) => c.id === winner.viewerId)?.label ?? winner.viewerId;
            return (
              <li key={contentType} className="viewer-conflict-row" data-content-type={contentType}>
                <span className="viewer-conflict-type">{contentType}</span>
                <span className="viewer-conflict-winner" title={`Resolved by: ${winner.source}`}>
                  {winnerLabel}
                </span>
                <select
                  className="viewer-conflict-picker"
                  aria-label={`Viewer for ${contentType}`}
                  value={pinnedFor(contentType)}
                  onChange={(event) => ctx.pinViewer({ contentType }, event.target.value)}
                >
                  {/* Empty = no explicit pin (resolver's automatic choice). */}
                  <option value="">Auto ({winnerLabel})</option>
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                  <option value={NOTETYPE_SENTINEL}>Default (note type)</option>
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
