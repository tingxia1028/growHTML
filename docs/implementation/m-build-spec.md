# M — 插件市场 (marketplace) M2 + M3 + source-aware market list — BUILD SPEC

Status: Plan (code-grounded, self-verified) → **F4/F5/M1/MH-0 ALREADY SHIPPED** (the backlog's "M needs
F4/F5 first" is a stale docs-vs-code trap — the THIRD track this session where the foundation was more
complete than the backlog claimed). Remaining LOCAL/CI slice = **M2 (preview + user-defined kits) + M3
(import hints) + source-aware market merging** — small, additive, register-only, NO core refactor, NO
schema migration. ~6 commits.

## STEP 0 — VERIFY the foundation is done (do NOT rebuild; cite)
- **F4 (effective-installed) DONE**: `src/kits/activation.ts:7-9` (header: "active = FOREGROUND ORDERING, never a filter; availability = marketplace effective-installed set"); `isPluginEffectiveInstalled`(`installState.ts:427-430`) over `effectiveInstalledPluginIds` = installed-set ∪ enabled-capability-group-members (`installState.ts:136-145`); the 3 authoring seams consume it (slash `adapters.ts:34-50`, toolbars `clientContext.tsx:114-126`, `activeKitIds` passed as `foregroundKitIds` `WorkspaceContext.tsx:2264,2339`). `activeKitIds` is an ARRAY (`activation.ts:1-5`) — never a hard single-kit gate.
- **F5 (plugin==kit 1:1 split) DONE**: `KitMemberPlugin` + `ProductKit.members[]` (`types.ts:116-149`); `installClientKits` registers ONE PluginRecord per member (`clientContext.tsx:216-242`); `seedBuiltinKits` gives each builtin its own record (`:253-276`); LOCKED by `catalogAgreement.test.tsx:30-60` ("plugin==kit 1:1 is dead").
- **M1 + MH-0 DONE**: catalog read model (`catalog.ts`), install-state transitions (`installState.ts`), the `CatalogSource` seam + `registerCatalogSource` (`catalogSource.ts`), the two-tab 套件管理器 UI (`pluginManagerViews.tsx` — 市场 browse via `catalogSource("local")` :107-120, Install via `withKitInstalled` :437, 已安装 enable/disable + groups + uninstall), server `PUT /api/plugin-prefs/catalog` (`app.ts:1390-1395`, split-write guarded `app.test.ts:1173-1238`). Confirmed shipped `plugin-viewer-model.md:326`.
If any of these is NOT as described, STOP and report (don't build atop a phantom). Otherwise: DO NOT rebuild them.

## CORE-vs-KIT (verified): catalog/installState/catalogSource = CORE ORGAN (registry infra); the market UI (`pluginManagerViews.tsx`) = CORE-CLIENT (host surface for ALL kits, NOT codex-owned — safe to extend); preview render + import-hint = CORE-CLIENT reusing `getNoteType().render`/`ArtifactCard`/`InertNote`; future external registries attach behind `registerCatalogSource`. No new entity/type/kit; server schema already carries `catalogState`/`userKits`.

## Commit sequence (each compiles + FULL vitest green; baseline 265f/2705t; ALL additive/register-only)
**M.1 — M2a: preview fixtures on the catalog + a pure selector.**
- Add `previewFixtures` to the bundled kit entries in `catalog.ts` (the field already exists ~`:49-50`, marked "Unused in M1"): for each kit, a union of its members' `provides` contentTypes + a schema-VALID `sampleContent` each (REUSE the deterministic `mockContent` shapes the kits already ship in their `KitPrompt.mockContent`, e.g. `src/kits/textbook-learning/prompts/*`).
- A pure `previewsFor(entryId) => {contentType, sampleContent, label}[]` helper.
- **Tests (HARD)**: extend `catalog.test.ts` — every kit's previewFixtures resolve to REGISTERED contentTypes AND every `sampleContent` VALIDATES against the core `NoteContentSpec` (risk 2 — the `plugin-viewer-model.md:122` invariant; a fixture that doesn't validate would silently render as InertNote).
**M.2 — M2b: render previews in the market detail view.**
- `pluginManagerViews.tsx` MarketTab: an expandable `<details>` detail rendering each preview via `getNoteType(contentType).render({content: sampleContent})`, InertNote fallback. Additive classes in `kitManager.css` (kit-owned — NOT codex's `styles.css`).
- **MH-0 (HARD, risk 3)**: preview data MUST flow through `CatalogListing`/`CatalogSource` — extend `CatalogListing` with an optional `previews` field in `catalogSource.ts`; the VIEW must NOT import `catalog.ts` directly (`pluginManagerViews.test.tsx:363-370` asserts this guard — keep it green).
- **Tests (HARD)**: extend `pluginManagerViews.test.tsx` — clicking a market card expands + renders the fixture's note type; the MH-0 no-direct-catalog-import guard still passes.
**M.3 — M2c: user-defined kits (`+ New kit` composer).**
- Data model EXISTS end-to-end (`UserKitDef` `installState.ts:45-50`, `userKitSchema` server, `kitGroupsFor` treats user-kit members as implicit groups `:76-86`, `putPluginCatalog` carries `userKits`). Only the compose UI is missing: a `+ New kit` form in `pluginManagerViews.tsx` — pick from cataloged member plugin ids, name it (`user:` prefix), persist via `putPluginCatalog({catalogState, userKits})`.
- **Tests (HARD)**: `pluginManagerViews.test.tsx` — create writes `userKits`, members appear as toggleable groups in 已安装, uninstall drops it (server round-trip already covered `app.test.ts:1207-1211`).
**M.4 — M3a: import-hint resolution (pure, React-free).**
- Pure `resolveImportHints(contentTypes[], state) => {contentType, provider, installed}[]` mapping each type through `providerOf` (`catalog.ts:464`) + `isPluginEffectiveInstalled`.
- **Tests (HARD)**: new `importHints.test.ts` — core primitives → no hint; not-effective-installed provider → hint with its kit; already-installed → no hint.
**M.5 — M3b: the per-note InertNote fallback affordance.**
- Extend `InertNote` (`builtinNoteTypes.tsx:973`): thread `contentType` in (additive prop, back-compat default); when unknown but `providerOf(contentType)` resolves → "安装 X 以完整查看" + a click that installs via the existing `withKitInstalled` seam; else "unsupported type" (`plugin-viewer-model.md:320`).
- **Tests (HARD)**: InertNote with a cataloged-but-uninstalled type renders the install hint + click installs the kit; unknown type renders "unsupported".
**M.6 — source-aware market list.**
- Keep the `CatalogSource` registry seam and market merge path, but do not ship demo registry listings in the app. Future hosted sources should register through `registerCatalogSource`; local/default market data remains bundled only until a real registry exists.
- **Tests (HARD)**: `catalogSource.test.ts` and `pluginManagerViews.test.tsx` cover the registration/merge contract with test-local sources only, so no demo goods leak into the app catalog.

Sequencing: 1→2 (preview data before UI), 4→5 (resolution before affordance); 3 and 6 independent after 1. (Commit 0 = a docs reconcile of the stale F4/F5 status in `architecture-review.md:36-42` + `roadmap.md:41` — I handle it with the impl-log, the build agent does NOT touch docs.)

## Collision: touches `src/kits/catalog.ts`, `src/kits/catalogSource.ts`, `src/client/workspace/pluginManagerViews.tsx` (+ `kitManager.css`), `src/client/notes/builtinNoteTypes.tsx`, + new `importHints.ts`/`catalogPreview.ts` + tests. Codex's files (styles.css, SlashPalette.tsx, workspace/anchorViews.*, workspace/actionIcons.ts, FileTree.tsx) UNTOUCHED. `installState.ts`/`app.ts` reused UNCHANGED (no schema migration).

## Gates: tsc 0 · full vitest green (baseline 265f/2705t — grow, never regress; keep `catalogAgreement.test.tsx` + the MH-0 guard green) · build · e2e (extend a plugin-manager e2e if one exists, else the unit/RTL tests suffice). Commit M.N own sequence, DON'T push (I verify+land), DON'T touch docs (report TEXT blocks). SURGICAL git.

## Deferred (external, documented as stub/interface): hosted kit registry (real network catalog, MH-1/2/3); kit packaging/distribution/signing (`fetchArtifact` bytes); third-party upload / code sandbox ("NO remote code download in V1 — locked" `plugin-viewer-model.md:335`); paid kits/entitlements/payments (`CatalogListing.pricing` typed, the 402 lives in remote fetchArtifact = MH-2).
