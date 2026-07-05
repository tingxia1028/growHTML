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
import { previewsFor } from "./catalogPreview";

/** A market detail-page preview (M2b — §8.4.3): a sample note rendered THROUGH the
    providing plugin's own registered renderer. `sampleContent` validates against the
    core NoteContentSpec for `contentType` (locked by catalogPreview.test.ts). Rides the
    LISTING so the market view reads it via the CatalogSource seam only — never a direct
    catalog import (the MH-0 guard). A remote source ships its own previews the same way. */
export type CatalogPreview = { contentType: string; sampleContent: unknown; label?: string };

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
  /** Detail-page live-preview fixtures (M2b, §8.4.3). Present on local listings that
      provide previewable types; absent when there is nothing to preview. */
  previews?: CatalogPreview[];
  /** Provenance for the card (§8.9): "bundled" = the in-process local catalog;
      "registry" = a remote source. The UI renders both identically (one renderer) — the
      value only drives an installability/"from a registry" hint. Absent = treat as local. */
  source?: "bundled" | "registry";
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
  // Preview fixtures ride the listing (MH-0 — the market view reads them here, never
  // from the catalog directly). `previewsFor` unions the kit's members' provided types.
  const previews = previewsFor(entry.id);
  return {
    id: entry.id,
    kind: entry.kind,
    title: entry.name,
    description: entry.description,
    version: entry.version,
    contentTypes,
    icon: entry.icon,
    memberCount: entry.kind === "kit" ? (entry.members ?? []).length : undefined,
    groupCount: entry.kind === "kit" ? (entry.groups ?? entry.members ?? []).length : undefined,
    previews: previews.length > 0 ? previews : undefined,
    source: "bundled"
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

/** Remove a registered source (never the built-in local one) — the test-cleanup seam so a
    registered extra doesn't leak across tests. */
export function unregisterCatalogSource(id: string): void {
  if (id !== localCatalogSource.id) sources.delete(id);
}

/** Every registered source (local first) — the market merges their listings (M6). */
export function listCatalogSources(): CatalogSource[] {
  return Array.from(sources.values());
}

/** The source the market renders from. Unknown ids fall back to local (defensive). */
export function catalogSource(id: string = "local"): CatalogSource {
  return sources.get(id) ?? localCatalogSource;
}

// —— the mock REMOTE source (dev/test only — the external boundary, mocked) ————————
// docs/design/plugin-viewer-model.md §8.9 — CI-verifiable proof a real remote registry
// slots into the SAME CatalogSource contract unchanged. It LISTS fabricated
// `source:"registry"` goods (with the remote-only publisher/pricing fields the local
// source omits), which the market renders identically to bundled cards; and its
// `fetchArtifact` — the future download-on-install / entitlement boundary (MH-2) —
// THROWS a typed "not available in V1" error (no remote code download is allowed in V1,
// locked). Registered ONLY behind an explicit dev/test flag (production shows only local).

/** The typed error the mock remote's fetchArtifact throws — the future 402/remote-fetch
    boundary, surfaced as a stable, catchable type (never a bare Error string match). */
export class NotAvailableInV1Error extends Error {
  readonly code = "not-available-in-v1" as const;
  constructor(readonly listingId: string) {
    super(`Remote artifact "${listingId}" is not available in V1 (no remote code download — locked, §8.9).`);
    this.name = "NotAvailableInV1Error";
  }
}

const REMOTE_MOCK_LISTINGS: CatalogListing[] = [
  {
    id: "registry:exam-cram",
    kind: "kit",
    title: "Exam Cram (registry demo)",
    description: "A fabricated remote kit — proves a registry listing renders like a bundled one.",
    version: "1.0.0",
    contentTypes: ["flashcard", "quiz"],
    publisher: { id: "acme-edu", name: "Acme Edu", verified: true },
    pricing: { kind: "free" },
    memberCount: 2,
    groupCount: 2,
    source: "registry"
  },
  {
    id: "registry:pro-diagrams",
    kind: "kit",
    title: "Pro Diagrams (registry demo)",
    description: "A fabricated paid remote kit — the 402/entitlement path lives in fetchArtifact.",
    version: "2.1.0",
    contentTypes: ["mermaid", "markmap"],
    publisher: { id: "acme-edu", name: "Acme Edu", verified: true },
    pricing: { kind: "credits", amount: 5 },
    memberCount: 1,
    groupCount: 1,
    source: "registry"
  }
];

export const remoteMockCatalogSource: CatalogSource = {
  id: "remote-mock",
  list: (q) => Promise.resolve(REMOTE_MOCK_LISTINGS.filter((l) => matches(l, q))),
  get: (id) => Promise.resolve(REMOTE_MOCK_LISTINGS.find((l) => l.id === id) ?? null),
  // The remote-fetch boundary: always rejects with the typed stub in V1.
  fetchArtifact: (id) => Promise.reject(new NotAvailableInV1Error(id))
};

/** Whether the mock remote source should be registered — a dev/test flag ONLY.
    Production leaves it off, so the market shows the local (bundled) source alone. */
export function shouldRegisterRemoteMock(): boolean {
  // Vite exposes import.meta.env; guard for non-Vite (node/test) runtimes.
  const env = (import.meta as unknown as { env?: Record<string, unknown> }).env;
  return env?.DEV === true || env?.VITE_REMOTE_MOCK_CATALOG === "1";
}

/** Register the mock remote source iff the dev/test flag is on (idempotent — the source
    map de-dupes by id). Callers: the market view on mount + tests (which call it directly).*/
export function registerRemoteMockIfEnabled(): void {
  if (shouldRegisterRemoteMock()) registerCatalogSource(remoteMockCatalogSource);
}
