// CatalogSource — the MH-0 seam (docs/design/marketplace-hosted.md §5), pinned verbatim.
// The client market LISTS through this read-only interface — `local` (bundled catalog)
// today, `remote` (the hosted catalog API) later. One seam, zero extra UI change when the
// remote source lands.
//
// Contract rules (§5, locked):
//   • a source is a READ-ONLY listing provider — install/enable/uninstall and
//     install-state stay in the client manager (F4 effective-installed);
//   • local listings simply omit publisher/pricing (one renderer, optional fields);
//   • artifacts are fetched separately from listings — local artifacts are already
//     in-process registrations, so `fetchArtifact` is absent on the local source;
//   • M1 acceptance = the manager renders its market listing from CatalogSource("local")
//     instead of importing registries directly.

import { listCatalogEntries, type CatalogEntry } from "./catalog";

export type CatalogListing = {
  id: string; //                            local: kit/plugin id · remote: listing id
  kind: "kit" | "plugin" | "pack"; //       插件市场 goods vs 笔记市场 packs
  title: string;
  description?: string;
  version?: string;
  /** What it registers/contains (packs carry this already). */
  contentTypes?: string[];
  /** remote only (Tier-B). */
  publisher?: { id: string; name: string; verified?: boolean };
  /** remote only. */
  pricing?: { kind: "free" } | { kind: "credits"; amount: number };
  /** Presentation extras the local catalog carries (optional; remote may omit). */
  icon?: string;
  /** kits: member count for the "N plugins" card line. */
  memberCount?: number;
  /** kits: capability-group count for the FLAT "N 能力组" card line. */
  groupCount?: number;
};

/** The installable bytes (svpack / kit-data JSON) a REMOTE source downloads on install.
    Local artifacts are in-process registrations, so the local source never returns one. */
export type CatalogArtifact = { id: string; mediaType: string; bytes: Uint8Array };

export interface CatalogSource {
  id: string; // "local" | "remote-official" | ...
  list(q?: { kind?: CatalogListing["kind"]; search?: string }): Promise<CatalogListing[]>;
  get(id: string): Promise<CatalogListing | null>;
  /** remote only — the installable bytes; entitlement is checked HERE (typed
      402-equivalent error, MH-2). Absent on the local source. */
  fetchArtifact?(id: string): Promise<CatalogArtifact>;
}

// —— the local source: the bundled kit/plugin registrations as listings ————————

/** Map a catalog entry to its market listing — publisher/pricing deliberately OMITTED
    (local goods are bundled and free; the renderer treats both as optional). */
function toListing(entry: CatalogEntry): CatalogListing {
  const contentTypes =
    entry.kind === "kit"
      ? // a kit "contains" the union of its members' provided types
        Array.from(
          new Set(
            (entry.members ?? []).flatMap(
              (memberId) => listCatalogEntries().find((e) => e.id === memberId)?.provides ?? []
            )
          )
        )
      : entry.provides ?? [];
  return {
    id: entry.id,
    kind: entry.kind,
    title: entry.name,
    description: entry.description,
    version: entry.version,
    contentTypes,
    icon: entry.icon,
    memberCount: entry.kind === "kit" ? (entry.members ?? []).length : undefined,
    groupCount: entry.kind === "kit" ? (entry.groups ?? entry.members ?? []).length : undefined
  };
}

function matches(listing: CatalogListing, q?: { kind?: CatalogListing["kind"]; search?: string }): boolean {
  if (q?.kind && listing.kind !== q.kind) return false;
  if (q?.search) {
    const needle = q.search.trim().toLowerCase();
    if (needle) {
      const haystack = `${listing.title} ${listing.description ?? ""}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
  }
  return true;
}

export const localCatalogSource: CatalogSource = {
  id: "local",
  // async by contract (a remote source is network-bound); local resolves immediately.
  // FLAT §2: the user-facing extension unit is the KIT ONLY — the local source lists
  // kits exclusively (plugin entries stay in the catalog as the internal read model;
  // `kind` survives on the wire for remote compat, but local never emits "plugin").
  list: (q) =>
    Promise.resolve(
      listCatalogEntries()
        .filter((entry) => entry.kind === "kit")
        .map(toListing)
        .filter((l) => matches(l, q))
    ),
  get: (id) => {
    const entry = listCatalogEntries().find((e) => e.id === id && e.kind === "kit");
    return Promise.resolve(entry ? toListing(entry) : null);
  }
  // fetchArtifact intentionally absent: local artifacts are in-process registrations.
};

// Source registry — "local" now; a remote source registers here later (MH-1) without
// touching the market UI.
const sources = new Map<string, CatalogSource>([[localCatalogSource.id, localCatalogSource]]);

export function registerCatalogSource(source: CatalogSource): void {
  sources.set(source.id, source);
}

/** The source the market renders from. Unknown ids fall back to local (defensive). */
export function catalogSource(id: string = "local"): CatalogSource {
  return sources.get(id) ?? localCatalogSource;
}
