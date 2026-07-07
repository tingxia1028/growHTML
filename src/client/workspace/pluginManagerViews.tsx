// KIT manager (FLAT-1 — docs/design/kit-flatten-and-core-review.md §2, carrying the
// MH-0 CatalogSource seam of docs/design/marketplace-hosted.md §5). The view kind stays
// `plugin.manager` (presets/workspace.json/the SHELL-4 modal need no migration), but the
// user-facing extension unit is now the KIT ONLY: the old plugin list is gone — member
// plugins live on as CAPABILITY GROUPS inside their kit (internal plugin ids preserved
// for contribution wiring; presentation + install state flatten to the kit).
//
// Two tabs:
//   已安装 (manage)  — one card per installed kit: enable/disable (all groups), the
//                      capability-group breakdown with per-group toggles, uninstall
//                      (existing notes keep rendering — the adaptive-note law), plus
//                      the viewer-conflict surface (§8.5.5, 独占 slots at kit level).
//   市场   (browse)  — installable KITS. MH-0 ACCEPTANCE: this listing renders ONLY
//                      through `catalogSource("local")` — the read-only CatalogSource
//                      contract — never by importing the catalog registry directly.
//
// Data seams: install state (installedKits + disabledGroups) reads/writes through the
// sanctioned pluginCatalogIo seam (`pluginPrefs` mount refresh + `putPluginCatalog` →
// PUT /api/plugin-prefs/catalog) + the module-scope install-state store (both entityClient
// methods run syncInstallStateFrom, so the store stays in sync through the facade); viewer
// pins keep the P2 panel seam
// (ctx.pinViewer). Rendering is NEVER touched by install state: disabling a group or
// uninstalling a kit hides CREATE affordances only — getNoteType() stays registered.

import { useEffect, useMemo, useState } from "react";
import { Blocks, Package, Search } from "lucide-react";
import { defineMessages, t, useLocale, type Locale } from "../i18n";
import { registerView, type WorkspaceContext } from "./viewRegistry";
import type { PluginRecord } from "../../kits/plugin";
import { listViewers, resolveViewer, NOTETYPE_SENTINEL } from "../notes/viewerRegistry";
import { getNoteType } from "../notes/noteTypeRegistry";
import { InertNote } from "../notes/builtinNoteTypes";
import {
  catalogSource,
  listCatalogSources,
  type CatalogListing,
  type CatalogPreview
} from "../../kits/catalogSource";
import {
  installStateSnapshot,
  isKitEnabled,
  isKitGroupEnabled,
  kitGroupsFor,
  withKitDisabled,
  withKitEnabled,
  withKitGroupDisabled,
  withKitGroupEnabled,
  withKitInstalled,
  withKitUninstalled,
  type CatalogState,
  type UserKitDef
} from "../../kits/installState";
import { pluginCatalogIo } from "./pluginCatalogIo";
import "./kitManager.css";

const kitManagerMessages = defineMessages({
  title: { zh: "套件", en: "Kits" },
  installedTab: { zh: "已安装", en: "Installed" },
  marketTab: { zh: "市场", en: "Market" },
  hideSearch: { zh: "收起套件搜索", en: "Hide kit search" },
  showSearch: { zh: "搜索套件", en: "Search kits" },
  searchMarket: { zh: "搜索市场…", en: "Search market…" },
  searchInstalled: { zh: "搜索已安装…", en: "Search installed…" },
  searchMarketLabel: { zh: "搜索市场", en: "Search the market" },
  searchInstalledLabel: { zh: "搜索已安装套件", en: "Search installed kits" },
  saveInstallFailed: { zh: "保存安装状态失败", en: "Failed to save install state" },
  groupCount: { zh: "个能力组", en: "capability groups" },
  uninstall: { zh: "卸载", en: "Uninstall" },
  removeKit: { zh: "移除", en: "Remove" },
  uninstallNote: {
    zh: "已生成的笔记照常显示（渲染永不卸载）；套件的创建入口将被移除。",
    en: "Existing notes keep rendering (rendering is never uninstalled); the kit's creation entry points are removed."
  },
  confirmUninstall: { zh: "确认卸载", en: "Confirm uninstall" },
  cancel: { zh: "取消", en: "Cancel" },
  enableKitTitle: {
    zh: "启用/停用整个套件（隐藏创建入口，不影响渲染）",
    en: "Enable/disable the whole kit — hides creation entry points, never affects rendering"
  },
  enablePrefix: { zh: "启用", en: "Enable" },
  toggleGroupPrefix: { zh: "切换能力组", en: "Toggle capability group" },
  kitDisabledNote: { zh: "已停用 — 所有能力组已关闭。", en: "Disabled — all capability groups are off." },
  noInstalled: { zh: "还没有安装套件。", en: "No kits installed." },
  noInstalledMatches: { zh: "没有匹配的已安装套件。", en: "No installed kits match this search." },
  loadingCatalog: { zh: "正在载入市场…", en: "Loading catalog…" },
  noCatalogEntries: { zh: "暂无市场条目。", en: "No catalog entries." },
  installedBadge: { zh: "已安装 ✓", en: "Installed ✓" },
  install: { zh: "安装", en: "Install" },
  preview: { zh: "预览", en: "Preview" },
  previewHint: {
    zh: "示例笔记 — 由套件自己的渲染器绘制。",
    en: "Sample notes — drawn by the kit's own renderer."
  },
  newKit: { zh: "+ 新建套件", en: "+ New kit" },
  newKitTitle: { zh: "新建自定义套件", en: "New custom kit" },
  kitNameLabel: { zh: "名称", en: "Name" },
  kitNamePlaceholder: { zh: "例如:考前冲刺", en: "e.g. Exam Prep" },
  kitDescLabel: { zh: "描述(可选)", en: "Description (optional)" },
  pickMembers: { zh: "选择成员插件", en: "Pick member plugins" },
  noPickableMembers: { zh: "没有可选的成员插件。", en: "No member plugins available to pick." },
  createKit: { zh: "创建", en: "Create" },
  nameRequired: { zh: "请填写名称。", en: "Please enter a name." },
  membersRequired: { zh: "请至少选择一个成员。", en: "Pick at least one member." },
  viewerConflicts: { zh: "Viewer 冲突", en: "Viewer conflicts" },
  noViewerConflicts: { zh: "没有 Viewer 冲突。", en: "No viewer conflicts." },
  defaultNoteType: { zh: "默认（笔记类型）", en: "Default (note type)" },
  resolvedBy: { zh: "解析来源:", en: "Resolved by:" },
  viewerFor: { zh: "Viewer:", en: "Viewer for" },
  auto: { zh: "自动", en: "Auto" }
});

type Snapshot = {
  catalogState: CatalogState;
  userKits: readonly UserKitDef[];
  effectivePluginIds: Set<string>;
  installedKitIds: string[];
};

function KitManagerView({ ctx }: { ctx: WorkspaceContext }) {
  useLocale();
  const [tab, setTab] = useState<"installed" | "market">("installed");
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [listings, setListings] = useState<CatalogListing[] | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot>(() => installStateSnapshot());
  const [marketError, setMarketError] = useState("");

  // MH-0: market listings come ONLY through the CatalogSource contract (never a direct
  // catalog import). The LOCAL source (bundled kits, FLAT §2) is always listed via
  // catalogSource("local").list(...); any registered EXTRA sources (a real registry later)
  // merge their listings through the SAME
  // call shape + type, deduped by id (local wins on collision). Re-queried on search.
  useEffect(() => {
    let live = true;
    const query = { search: search || undefined };
    const local = catalogSource("local").list(query);
    const extras = listCatalogSources()
      .filter((s) => s.id !== "local")
      .map((s) => s.list(query).catch(() => [] as CatalogListing[]));
    void Promise.all([local, ...extras])
      .then((groups) => {
        if (!live) return;
        const byId = new Map<string, CatalogListing>();
        for (const listing of groups.flat()) if (!byId.has(listing.id)) byId.set(listing.id, listing);
        setListings(Array.from(byId.values()));
      })
      .catch(() => {
        if (live) setListings([]);
      });
    return () => {
      live = false;
    };
  }, [search]);

  // Refresh the install state from the vault on mount (entityClient syncs the module
  // store from the response — the server has already applied the FLAT migration
  // write-back by then). Best-effort: on failure the store default keeps behaving.
  useEffect(() => {
    let live = true;
    pluginCatalogIo
      .pluginPrefs()
      .then(() => {
        if (live) setSnapshot(installStateSnapshot());
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  // The ONE install-state write seam: persist the next catalogState (+ optionally the
  // userKits list, for the composer create/removal), then re-read the synced module store
  // (the response refreshed it) so this view re-renders on truth.
  const persist = (next: CatalogState, userKits?: readonly UserKitDef[]) => {
    setMarketError("");
    pluginCatalogIo
      .putPluginCatalog(userKits ? { catalogState: next, userKits: [...userKits] } : { catalogState: next })
      .then(() => setSnapshot(installStateSnapshot()))
      .catch((err) => setMarketError(err instanceof Error ? err.message : t(kitManagerMessages.saveInstallFailed)));
  };

  return (
    <aside className="plugin-manager-panel">
      <div className="panel-title">
        <Blocks size={16} />
        {t(kitManagerMessages.title)}
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
            {t(kitManagerMessages.installedTab)}
          </button>
          <button
            type="button"
            role="tab"
            className={`market-tab market-tab-market${tab === "market" ? " active" : ""}`}
            aria-selected={tab === "market"}
            onClick={() => setTab("market")}
          >
            {t(kitManagerMessages.marketTab)}
          </button>
        </div>
        <button
          type="button"
          className={`plugin-search-toggle${searchOpen ? " active" : ""}`}
          aria-label={searchOpen ? t(kitManagerMessages.hideSearch) : t(kitManagerMessages.showSearch)}
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
            placeholder={tab === "market" ? t(kitManagerMessages.searchMarket) : t(kitManagerMessages.searchInstalled)}
            aria-label={tab === "market" ? t(kitManagerMessages.searchMarketLabel) : t(kitManagerMessages.searchInstalledLabel)}
            value={search}
            autoFocus
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      ) : null}

      {marketError ? <div className="error-box market-error">{marketError}</div> : null}

      {tab === "installed" ? (
        <InstalledKitsTab ctx={ctx} snapshot={snapshot} listings={listings} search={search} persist={persist} />
      ) : (
        <MarketTab snapshot={snapshot} listings={listings} persist={persist} />
      )}
    </aside>
  );
}

// —— + New kit composer (M2c — §8.5.4) ————————————————————————————————————————
// A user kit = a named bundle of member plugin ids picked from THIS vault's installed
// plugins (the read model — MH-0-safe; never a catalog import). Persisted as a userKits[]
// entry (id = "user:<slug>") whose id also enters installedKits, so it installs/uninstalls
// and refcounts exactly like a catalog kit (§8.3). Members surface as implicit capability
// groups in 已安装 (kitGroupsFor treats a user kit's members as one-member groups).

/** A stable-ish "user:"-prefixed id from a display name (+ a uniqueness suffix). */
function userKitId(name: string, existing: readonly UserKitDef[]): string {
  const slug =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "kit";
  let id = `user:${slug}`;
  let n = 2;
  const taken = new Set(existing.map((k) => k.id));
  while (taken.has(id)) id = `user:${slug}-${n++}`;
  return id;
}

function NewKitComposer({
  ctx,
  snapshot,
  persist
}: {
  ctx: WorkspaceContext;
  snapshot: Snapshot;
  persist(next: CatalogState, userKits?: readonly UserKitDef[]): void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [members, setMembers] = useState<string[]>([]);
  const [error, setError] = useState("");

  // Pickable members = installed plugins that contribute a note type (the meaningful
  // capability units), de-duped by id — straight off the runtime read model (MH-0).
  const pickable = useMemo(() => {
    const seen = new Set<string>();
    return ctx.installedPlugins
      .filter((p) => p.id !== "core" && p.contributions.some((c) => c.kind === "noteType"))
      .filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
  }, [ctx.installedPlugins]);

  const toggle = (id: string) =>
    setMembers((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const reset = () => {
    setName("");
    setDescription("");
    setMembers([]);
    setError("");
    setOpen(false);
  };

  const create = () => {
    if (!name.trim()) return setError(t(kitManagerMessages.nameRequired));
    if (members.length === 0) return setError(t(kitManagerMessages.membersRequired));
    const def: UserKitDef = {
      id: userKitId(name, snapshot.userKits),
      name: name.trim(),
      description: description.trim() || undefined,
      members
    };
    // Persist: add the def to userKits AND install it (its id enters installedKits).
    persist(withKitInstalled(snapshot.catalogState, def.id), [...snapshot.userKits, def]);
    reset();
  };

  if (!open) {
    return (
      <button type="button" className="new-kit-open-btn link-button" onClick={() => setOpen(true)}>
        {t(kitManagerMessages.newKit)}
      </button>
    );
  }

  return (
    <div className="new-kit-composer">
      <div className="new-kit-title">{t(kitManagerMessages.newKitTitle)}</div>
      <label className="new-kit-field">
        <span className="new-kit-label">{t(kitManagerMessages.kitNameLabel)}</span>
        <input
          className="new-kit-name-input"
          value={name}
          placeholder={t(kitManagerMessages.kitNamePlaceholder)}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="new-kit-field">
        <span className="new-kit-label">{t(kitManagerMessages.kitDescLabel)}</span>
        <input className="new-kit-desc-input" value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <div className="new-kit-members">
        <div className="new-kit-label">{t(kitManagerMessages.pickMembers)}</div>
        {pickable.length === 0 ? (
          <div className="empty-state">{t(kitManagerMessages.noPickableMembers)}</div>
        ) : (
          <ul className="new-kit-member-list">
            {pickable.map((plugin) => (
              <li key={plugin.id} className="new-kit-member-row">
                <label className="new-kit-member-row-label sv-check">
                  <input
                    type="checkbox"
                    className="new-kit-member-check sv-check-input"
                    data-member-id={plugin.id}
                    checked={members.includes(plugin.id)}
                    onChange={() => toggle(plugin.id)}
                  />
                  <span className="sv-check-box" aria-hidden="true" />
                  <span className="new-kit-member-name">{plugin.name}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error ? <div className="error-box new-kit-error">{error}</div> : null}
      <div className="new-kit-actions">
        <button type="button" className="new-kit-create-btn" onClick={create}>
          {t(kitManagerMessages.createKit)}
        </button>
        <button type="button" className="link-button" onClick={reset}>
          {t(kitManagerMessages.cancel)}
        </button>
      </div>
    </div>
  );
}

// —— 已安装 (manage): one card per installed kit ————————————————————————————————

function InstalledKitsTab({
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
  persist(next: CatalogState, userKits?: readonly UserKitDef[]): void;
}) {
  const locale = useLocale();
  const [confirmingKitId, setConfirmingKitId] = useState<string | null>(null);
  const listingById = useMemo(() => new Map((listings ?? []).map((l) => [l.id, l])), [listings]);
  // Group members are INTERNAL plugin ids — resolve display names for user-kit rows
  // through the runtime read model (never a catalog import; MH-0 stays intact).
  const memberName = (pluginId: string): string =>
    ctx.installedPlugins.find((p) => p.id === pluginId)?.name ?? pluginId;

  const cards = snapshot.installedKitIds.map((kitId) => {
    const listing = listingById.get(kitId);
    const userKit = snapshot.userKits.find((k) => k.id === kitId);
    const groups = kitGroupsFor(kitId, snapshot.userKits);
    return {
      kitId,
      name: listing?.title ?? userKit?.name ?? kitId,
      description: listing?.description ?? userKit?.description ?? "",
      groups,
      enabled: isKitEnabled(snapshot.catalogState, kitId, snapshot.userKits)
    };
  });

  const query = search.trim().toLowerCase();
  const groupLabel = (group: { id: string; name: { zh: string; en: string } }, isUserKit: boolean): string =>
    isUserKit ? memberName(group.id) : localized(group.name, locale);
  const visibleCards = cards.filter((card) => {
    if (!query) return true;
    const haystack = [
      card.name,
      card.kitId,
      card.description,
      ...card.groups.flatMap((g) => [g.id, g.name.zh, g.name.en])
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });

  return (
    <div className="market-installed">
      <NewKitComposer ctx={ctx} snapshot={snapshot} persist={persist} />
      <div className="plugin-manager-list record-list">
        {visibleCards.map((card) => {
          const isUserKit = snapshot.userKits.some((k) => k.id === card.kitId);
          return (
            <div key={card.kitId} className="kit-card" data-kit-id={card.kitId}>
              <div className="kit-card-head">
                <span className="kit-card-name">
                  <Package size={14} /> {card.name}
                  {card.groups.length > 0 ? (
                    <span className="kit-group-count">
                      {card.groups.length} {t(kitManagerMessages.groupCount)}
                    </span>
                  ) : null}
                </span>
                {card.groups.length > 0 ? (
                  <label className="kit-enable-toggle sv-switch" title={t(kitManagerMessages.enableKitTitle)}>
                    <input
                      type="checkbox"
                      className="sv-switch-input"
                      checked={card.enabled}
                      aria-label={`${t(kitManagerMessages.enablePrefix)} ${card.name}`}
                      onChange={(event) =>
                        persist(
                          event.target.checked
                            ? withKitEnabled(snapshot.catalogState, card.kitId)
                            : withKitDisabled(snapshot.catalogState, card.kitId, snapshot.userKits)
                        )
                      }
                    />
                    <span className="sv-switch-track" aria-hidden="true" />
                  </label>
                ) : null}
                <button
                  type="button"
                  className="link-button kit-uninstall-btn"
                  onClick={() => setConfirmingKitId(confirmingKitId === card.kitId ? null : card.kitId)}
                >
                  {t(kitManagerMessages.uninstall)}
                </button>
              </div>

              {card.description ? <p className="kit-card-desc">{card.description}</p> : null}
              {!card.enabled ? <div className="kit-card-disabled-note">{t(kitManagerMessages.kitDisabledNote)}</div> : null}

              {confirmingKitId === card.kitId ? (
                <div className="kit-removal-confirm" data-kit-id={card.kitId}>
                  <div className="kit-removal-title">
                    {t(kitManagerMessages.removeKit)} «{card.name}»?
                  </div>
                  <div className="kit-uninstall-note">{t(kitManagerMessages.uninstallNote)}</div>
                  <div className="kit-removal-actions">
                    <button
                      type="button"
                      className="kit-removal-confirm-btn"
                      onClick={() => {
                        setConfirmingKitId(null);
                        persist(withKitUninstalled(snapshot.catalogState, card.kitId));
                      }}
                    >
                      {t(kitManagerMessages.confirmUninstall)}
                    </button>
                    <button type="button" className="link-button" onClick={() => setConfirmingKitId(null)}>
                      {t(kitManagerMessages.cancel)}
                    </button>
                  </div>
                </div>
              ) : null}

              {card.groups.length > 0 ? (
                <ul className="kit-group-list">
                  {card.groups.map((group) => {
                    const enabled = isKitGroupEnabled(snapshot.catalogState, card.kitId, group.id, snapshot.userKits);
                    const label = groupLabel(group, isUserKit);
                    return (
                      <li
                        key={group.id}
                        className={`kit-group-row${enabled ? "" : " disabled"}`}
                        data-group-id={group.id}
                      >
                        <span className="kit-group-name">{label}</span>
                        {group.description ? (
                          <span className="kit-group-desc">{localized(group.description, locale)}</span>
                        ) : null}
                        <label className="kit-group-toggle sv-switch">
                          <input
                            type="checkbox"
                            className="sv-switch-input"
                            checked={enabled}
                            aria-label={`${t(kitManagerMessages.toggleGroupPrefix)} ${label}`}
                            onChange={(event) =>
                              persist(
                                event.target.checked
                                  ? withKitGroupEnabled(snapshot.catalogState, card.kitId, group.id, snapshot.userKits)
                                  : withKitGroupDisabled(snapshot.catalogState, card.kitId, group.id, snapshot.userKits)
                              )
                            }
                          />
                          <span className="sv-switch-track" aria-hidden="true" />
                        </label>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          );
        })}

        {cards.length === 0 ? <div className="empty-state">{t(kitManagerMessages.noInstalled)}</div> : null}
        {query && cards.length > 0 && visibleCards.length === 0 ? (
          <div className="empty-state">{t(kitManagerMessages.noInstalledMatches)}</div>
        ) : null}
      </div>

      <ViewerConflicts ctx={ctx} plugins={ctx.installedPlugins} />
    </div>
  );
}

function localized(text: { zh: string; en: string }, locale: Locale): string {
  return text[locale];
}

// —— market detail preview (M2b — §8.4.3) ————————————————————————————————————————
// An expandable <details> drill-in under a market card. Each fixture renders THROUGH the
// providing plugin's OWN registered renderer (getNoteType(contentType).render) — the
// market owns NO bespoke preview renderer (the adaptive-note contract). A type with no
// registered renderer falls back to InertNote (escaped JSON), never a crash. The preview
// data arrives on the listing (CatalogSource seam) — the view never imports the catalog.
function PreviewNote({ preview }: { preview: CatalogPreview }) {
  const plugin = getNoteType(preview.contentType);
  const body = plugin?.render({ content: preview.sampleContent, mode: "card" }) ?? (
    <InertNote content={preview.sampleContent} />
  );
  return (
    <div className="market-preview-note" data-content-type={preview.contentType}>
      <span className="market-preview-type">{preview.label ?? preview.contentType}</span>
      <div className="market-preview-body">{body}</div>
    </div>
  );
}

function PreviewDrill({ previews }: { previews: CatalogPreview[] }) {
  if (previews.length === 0) return null;
  return (
    <details className="market-preview">
      <summary className="market-preview-summary">{t(kitManagerMessages.preview)}</summary>
      <div className="market-preview-hint">{t(kitManagerMessages.previewHint)}</div>
      <div className="market-preview-grid">
        {previews.map((preview) => (
          <PreviewNote key={preview.contentType} preview={preview} />
        ))}
      </div>
    </details>
  );
}

// —— 市场 (browse): kit listings only (FLAT §2) ————————————————————————————————

function MarketTab({
  snapshot,
  listings,
  persist
}: {
  snapshot: Snapshot;
  listings: CatalogListing[] | null;
  persist(next: CatalogState, userKits?: readonly UserKitDef[]): void;
}) {
  const installedKitSet = new Set(snapshot.installedKitIds);

  return (
    <div className="market-browse">
      {listings === null ? (
        <div className="empty-state">{t(kitManagerMessages.loadingCatalog)}</div>
      ) : listings.length === 0 ? (
        <div className="empty-state">{t(kitManagerMessages.noCatalogEntries)}</div>
      ) : (
        <ul className="market-card-list">
          {listings.map((listing) => {
            const installed = installedKitSet.has(listing.id);
            return (
              <li
                key={listing.id}
                className="market-card"
                data-entry-id={listing.id}
                data-kind={listing.kind}
                data-source={listing.source ?? "bundled"}
              >
                <div className="market-card-row">
                  <span className="market-card-icon" aria-hidden="true">
                    <Package size={16} />
                  </span>
                  <span className="market-card-main">
                    <span className="market-card-title">
                      {listing.title}
                      {typeof listing.groupCount === "number" ? (
                        <span className="market-kit-count">
                          {listing.groupCount} {t(kitManagerMessages.groupCount)}
                        </span>
                      ) : null}
                    </span>
                    <span className="market-card-desc">{listing.description}</span>
                  </span>
                  {installed ? (
                    <span className="market-installed-badge">{t(kitManagerMessages.installedBadge)}</span>
                  ) : (
                    <button
                      type="button"
                      className="market-install-btn"
                      onClick={() => persist(withKitInstalled(snapshot.catalogState, listing.id))}
                    >
                      {t(kitManagerMessages.install)}
                    </button>
                  )}
                </div>
                <PreviewDrill previews={listing.previews ?? []} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// —— Viewer conflicts (plugin-viewer-model §4 / §8.5.5 "Defaults / conflicts") ————
// Unchanged in semantics across FLAT: the 独占 viewer slot is resolved per contentType
// (≥2 willing viewers = a conflict), eligibility follows the kit-level effective set
// (viewerRegistry → isPluginEffectiveInstalled), and the pin writes through the P2
// panel seam (ctx.pinViewer).
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
      <div className="plugin-section-title">{t(kitManagerMessages.viewerConflicts)}</div>
      {conflicts.length === 0 ? (
        <div className="empty-state">{t(kitManagerMessages.noViewerConflicts)}</div>
      ) : (
        <ul className="viewer-conflict-list">
          {conflicts.map(({ contentType, candidates }) => {
            const winner = resolveViewer({ contentType }, ctx.pluginPrefs);
            const winnerLabel =
              winner.viewerId === NOTETYPE_SENTINEL
                ? t(kitManagerMessages.defaultNoteType)
                : candidates.find((c) => c.id === winner.viewerId)?.label ?? winner.viewerId;
            return (
              <li key={contentType} className="viewer-conflict-row" data-content-type={contentType}>
                <span className="viewer-conflict-type">{contentType}</span>
                <span className="viewer-conflict-winner" title={`${t(kitManagerMessages.resolvedBy)} ${winner.source}`}>
                  {winnerLabel}
                </span>
                <select
                  className="viewer-conflict-picker"
                  aria-label={`${t(kitManagerMessages.viewerFor)} ${contentType}`}
                  value={pinnedFor(contentType)}
                  onChange={(event) => ctx.pinViewer({ contentType }, event.target.value)}
                >
                  {/* Empty = no explicit pin (resolver's automatic choice). */}
                  <option value="">{t(kitManagerMessages.auto)} ({winnerLabel})</option>
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                  <option value={NOTETYPE_SENTINEL}>{t(kitManagerMessages.defaultNoteType)}</option>
                </select>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

registerView({ kind: "plugin.manager", render: (_node, ctx) => <KitManagerView ctx={ctx} /> });
