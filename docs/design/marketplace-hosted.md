# Hosted Marketplace — 插件市场 + 笔记市场 (web storefront, client install)

One backend, two frontends: the WEB owns discovery/publishing/checkout (a marketplace is a
GROWTH LOOP — a teacher shares a pack link into a WeChat group and non-users see a landing
page; a client-only market has no link to share). The CLIENT owns install/update/use via the
existing Kit&Plugin manager + svpack import. P3 per product-kernel §3 — the user has said V1
will NOT build this; this doc pins the shape + the one cheap hook M1 must leave. Grounded
2026-07.

## 1. The substrate is already paid for
| Need | Already built |
|---|---|
| trust chain for sellable content | svpack: signing, publisher identity (Tier-B real-name), publish ledger, validity windows, zero-width watermark traceability — the DEFERRED svpack server tier IS this marketplace's content half |
| accounts + money | G-gateway: phone+SMS auth, HMAC tokens, credits ledger (hold/settle/refund), payment webhook (mock), moderation adapter slot — market goods and AI credits share one wallet |
| client-side install surface | Kit&Plugin manager (M1's territory) + svpack import dialogs (shipped) |
| catalog-ready metadata | packs already carry contentTypes summary + publisher info |

## 2. The two goods, one catalog
- **笔记市场 = svpack packs.** Listing = pack metadata + price (or free) + license window;
  delivery = the signed pack + an entitlement record; renewal rides the existing signed-code
  validity mechanism.
- **插件市场 = DATA-ONLY plugins.** Kit configs, operations (prompts-as-data), taxonomies,
  题型 templates — things the registries already load as data. **No arbitrary code**: this
  dodges the sandbox/security project entirely, fits the kernel law, and covers the real
  education use cases (a teacher's operation pack IS a plugin). Code plugins = explicitly out
  of scope until proven demand.

## 3. Split of responsibilities
- **Web storefront:** browse/search, pack landing pages (shareable, SEO), publisher dashboard
  (upload svpack / operation pack, price, sales, takedown), checkout (WeChat Pay via the
  gateway), account = the same phone-number identity as managed AI.
- **Client:** "获取" deep-links `growte://install/<listingId>` → client fetches via the catalog
  API + installs through the existing import/manager paths; desktop MAY embed the web catalog
  as a tab (one catalog UI, never two).
- **One catalog API** (`GET /catalog/listings`, `GET /catalog/listings/:id`,
  `POST /catalog/entitlements` …) served beside the gateway; web and client are both clients
  of it.

## 4. Platform + compliance gotchas (known up front)
1. **Apple IAP**: digital-goods purchase inside the iOS app must use IAP or be absent (view +
   "restore purchases" only); Android/desktop unaffected. Market entry点 forks per platform at
   X2 time.
2. **UGC obligations**: selling third-party content = platform duties — ICP 备案, content
   moderation (the gateway's moderation slot), publisher real-name (svpack Tier-B), takedown +
   refund flows. Rides the same 个体工商户/license chain as managed AI.
3. **Entitlement ≠ DRM**: svpack's existing protection (sealed runtime, watermark, no re-export)
   is the enforcement; the marketplace only decides WHO gets a pack + for how long.

## 5. Phasing (all P3 except the M1 hook)
- **MH-0 (rides M1, P2 — the one thing to do NOW):** the client market lists through a
  `CatalogSource` interface — `local` (bundled/registry) today, `remote` (catalog API) later.
  One seam, zero extra UI. M1's acceptance includes it. **The contract:**
  ```ts
  type CatalogListing = {
    id: string;                            // local: kit/plugin id · remote: listing id
    kind: "kit" | "plugin" | "pack";       // 插件市场 goods vs 笔记市场 packs
    title: string;
    description?: string;
    version?: string;
    contentTypes?: string[];               // what it registers/contains (packs carry this already)
    publisher?: { id: string; name: string; verified?: boolean };  // remote only (Tier-B)
    pricing?: { kind: "free" } | { kind: "credits"; amount: number };  // remote only
  };
  interface CatalogSource {
    id: string;                            // "local" | "remote-official" | ...
    list(q?: { kind?: CatalogListing["kind"]; search?: string }): Promise<CatalogListing[]>;
    get(id: string): Promise<CatalogListing | null>;
    fetchArtifact?(id: string): Promise<CatalogArtifact>;  // remote only — the installable
  }                                        // bytes (svpack / kit-data JSON); entitlement is
                                           // checked HERE (typed 402-equivalent error, MH-2)
  ```
  **Contract rules:** a source is a READ-ONLY listing provider — install/enable/uninstall and
  install-state stay in the client manager (F4 effective-installed), which is what keeps local
  and remote symmetric; local listings simply omit publisher/pricing (one renderer, optional
  fields); artifacts are fetched separately from listings (local artifacts are already
  in-process registrations, so `fetchArtifact` is absent). M1 acceptance = the manager renders
  from `CatalogSource("local")` instead of importing registries directly.
- **MH-1:** read-only hosted catalog + FREE packs (publish→browse→deep-link install), no money.
  Proves the loop with zero payment/compliance surface.
- **MH-2:** entitlements + payments through the gateway (credits or direct), license windows,
  publisher dashboard v1.
- **MH-3:** data-plugin goods + revenue share + moderation workflow hardening.

## 6. Tests (when built)
Catalog API contract tests; entitlement issuance idempotency (gateway ledger idioms); deep-link
install e2e (web listing → growte:// → installed kit/pack appears in manager); iOS build hides
purchase entry (flag test); moderation/takedown state machine.
