# Platform-layering — file-by-file BUILD SPEC

Status: **v3 — TWO adversarial rounds folded (2026-07-05); APPROVE-able, ready to build.** Branch
`codex/foundation-refactor`, HEAD `9952508`. Round-1 (REWORK): B1-B4 + co-land. Round-2 (REWORK): §2 is a
clean unidirectional PIPELINE (splittable at `sourceBundles`, NOT an atomic blob — round-2 vindicated the
owner's "拆干净" instinct); TIER-A isolation was wrong for kit/operation (re-tiered); §4.3 had 3 real callers
(not zero); §3 route census under-counted (added). Round-2 verdict: "once blockers folded, APPROVE-able —
the architecture is right." Recurring lesson: the ARCHITECTURE is sound; residual file-level census is now
best caught by tsc + tests at build time, not more paper rounds. BUILD ORDER: §5.1 barrel fix (1-line,
verified 3×) → Part-1 platform scaffold → funnel → Part-2 pipeline (isolated-first). Assumptions in §Self-attack.

**BUILD PROGRESS (2026-07-06):** ✅ §5.1 barrel fix · ✅ Part-1 scaffold + FULL funnel (assets→prefs→dialogs→clipboard→native+files+capabilities) — **platform adapter fully consumed** · ✅ Part-3 directTransport (+28 routes, drift-proof coverage guard) · ✅ Part-4 de-Node COMPLETE (4a rootDir/storage-required + getDefaultVaultRoot→server/vaultRoot.ts; 4b node:path→logical `/`-paths + §4.4 memoryStorage acceptance test — portable store graph is node:path-free) · ✅ §5.2 import-boundary guard COMPLETE (TS-compiler-API resolver; Rule A portable-core⊄node CI-enforced via `npm run check` — 63 core entries, 0 violations; whole `node:` namespace forbidden; mobile-entry Rule B future-ready hook) · ⏳ **Part-2 WorkspaceContext split (XL, highest-risk — the ONLY remaining PLAT piece)** · ⏳ Part-2 WorkspaceContext split (XL, LAST). STORE-SQL #47 (parallel track) COMPLETE (dispose→flip→import→FTS S5); only S6 multi-device deferred. Baseline: **277f/2818t**.

## 0. Verified baseline (round-1 corrected counts)
| Funnel | Verified at HEAD | Note |
|---|---|---|
| `window.studyVault` | 18 occ/8 files (~14 live in 6) | §1.1 |
| `localStorage` prefs | **~30 helpers + ~6 inline component sites + `growte.*` keys** (not "~10") | §1.3 (B2) |
| `window.confirm/prompt/alert` | ~21 non-test sites, **~4 are SYNC callbacks** | §1.5 (B1) |
| bare `fetch(` in `src/client` | 12/9 | §1.4 |
| `WorkspaceContext.tsx` | 2680 lines · 128-field value (:2410-2538) · **50 `activeSourceId` + 24 `activeSource`** · 45 useState · 71 useCallback | §2 |
| files importing `errors.ts` | **23** | barrel-leak blast radius (§5.1) |
| files importing `entityClient` (`src/client`) | 112 | most legit `*Io.ts`; §2.5 |
**Scope correction (Part 5):** `VisionUnsupportedError` is a concrete export of `src/ai/provider.ts:47`
(node-clean); the barrel fix is a **one-line import-path change** (§5.1), verified 1-line by round-1.

## PART 1 — PlatformAdapter (client). ~7 new files + ~20 edited.

### 1.1 The real `window.studyVault` surface (`electron/preload.ts:12-48` + `electron.d.ts:3-31`)
`desktop` (LocalHtmlReader.tsx:78) · `platform` (typing only) · `webviewPreloadUrl?` (webviewSelection.ts:86)
· `windowControls?` (TopBar.tsx:57) · `pty?` (TerminalPanel.tsx:23) · `pickDirectory?()`
(WorkspaceContext.tsx:1269, TerminalPanel.tsx:24) · `openFile?()` (WorkspaceContext.tsx:1262,:1829,
fileLinkNoteType.tsx:127, builtinNoteTypes.tsx:620; gates :50,:47) · `openPath?(path)`
(fileLinkNoteType.tsx:61) · `getPathForFile?` **dead — 0 callers → exclude**. Sketch missed → add a
**`native`** slot (pty/windowControls/webviewPreloadUrl/shellOpenPath/**openUrl**) + **`clipboard`**.

### 1.2 Refined interface — `src/client/platform/types.ts`
```ts
export type PlatformKind = "desktop" | "web" | "mobile";
export interface PlatformCapabilities {
  nativeFileDialogs: boolean; shellOpen: boolean; terminal: boolean; windowChrome: boolean;
  webview: boolean; notification: boolean; microphone: boolean;   // N1: NudgeToast, useVoiceInput
}
export interface PlatformPrefs { get(k:string):string|null; set(k:string,v:string):void; remove(k:string):void; }
export interface PlatformDialogs {                       // ASYNC (§1.5)
  confirm(m:string):Promise<boolean>; prompt(m:string,def?:string):Promise<string|null>; alert(m:string):Promise<void>;
}
export interface PlatformFiles { pickFile():Promise<string|null>; pickDirectory():Promise<string|null>; }
export interface PlatformClipboard { writeText(t:string):Promise<void>; readText():Promise<string>; }
export interface PlatformAssets { url(assetId:string):string; }
export interface PlatformNative {                        // desktop-only; undefined elsewhere
  shellOpenPath?(p:string):Promise<string>; openUrl?(url:string):void;    // N1: UserMenu window.open
  windowControls?:{minimize():void;toggleMaximize():void;close():void};
  webviewPreloadUrl?:string; pty?:StudyVaultPty;
}
export interface PlatformAdapter {
  kind:PlatformKind; capabilities:PlatformCapabilities; prefs:PlatformPrefs; dialogs:PlatformDialogs;
  files:PlatformFiles; clipboard:PlatformClipboard; assets:PlatformAssets; native?:PlatformNative;
}
```
(N1: `Notification` NudgeToast.tsx:38,46; `getUserMedia` useVoiceInput.ts:146,156; `window.open`
UserMenu.tsx:210 — capabilities gate them, `native.openUrl` routes the external-URL open.)

### 1.3 localStorage prefs migration — REAL scope (B2: ~4× the first estimate)
**✅ LANDED (2026-07-06).** 14 client files routed through `getPlatformOptional()?.prefs` with a
`globalThis.localStorage` fallback (byte-identical pre-`setPlatform` + in provider-less tests): applyTheme,
speechPreferences, searchRecents (shape-adapted to its injected `RecentsStore`), useChatSessions, panes,
rightSplit, sourceSplit, i18n, annotations, WorkspaceContext (module helpers + inline setActiveLayout/Theme),
FloatingNoteEditor, WorkspaceShell, views (`sv-library-collapsed`), SettingsHub (`growte.backup.restoreLimit`).
Dead-code `readStoredAnnotationMode`/`persistAnnotationMode`/`sv-annotation-mode` DELETED (write-only key; read
hardcoded `"margin"` → `DEFAULT_ANNOTATION_MODE`). LEFT (correctly, not the app-prefs seam): `annotationLayer.ts
cardStore(doc)` reads the reader IFRAME realm's own `localStorage` (`sv-card-geom:*`). SKIPPED (codex-owned):
`anchorViews.tsx` — so the `views ⊄ localStorage` boundary is NOT fully green until codex funnels its files.
Adversarial review: PASS (byte-parity probe-verified, no findings). tsc 0 · full vitest 277f/2817t · build ✓.
Still TODO for Part-1: native (window.studyVault, 7 files) + clipboard + the ~8 confirm/prompt/alert stragglers.
Three kinds:
- **PREFS via ~30 `readStored*/persist*` helper pairs → rewrite the BODIES to `getPlatform().prefs.*`**
  (`sv-*` keys: ACTIVE_LAYOUT WorkspaceContext.tsx:284, RECENT_SOURCE_IDS :303, FOLDER_ROOTS :325,
  ACTIVE_SESSION useChatSessions.ts:38, THEME applyTheme.ts, annotations.ts, speechPreferences.ts,
  searchRecents.ts, …).
- **~6 INLINE component sites (per-site edits, NOT body rewrites)**: `WorkspaceContext.tsx:2391`
  (setActiveLayout), `:2403` (setActiveTheme) — inline `globalThis.localStorage?.setItem` in useCallback;
  `WorkspaceShell.tsx:290,331` (toggleCollapsed/drag closures); `SettingsHub.tsx:260,301` — the
  **`growte.backup.restoreLimit`** key (a `growte.*` pref, NO helper, NOT `sv-*`-prefixed → invisible to a
  "sv-* only" framing). These migrate to `getPlatform().prefs`/`usePlatform()` per-site.
- **LEAVE**: `globalThis.localStorage?`-guarded feature-detection + test files.
- **Latent bug surfaced**: `annotations.ts readStoredAnnotationMode()` is DEAD (hardcoded `return "margin"`,
  never reads) — fix or delete during migration, don't blindly funnel it.
`getPlatform()` singleton (§1.6) serves the module-scope helpers; inline sites use `usePlatform()`.

### 1.4 bare-`fetch` split
LEAVE (the seam / IO): transport.ts:55, entityClient.ts:1257/:1324 (streams, §3.3), dataTrust.ts:69/:76,
sourceAuthoringIo.ts:78/:96, searchClient.ts:18/speechStatus.ts:38/useVoiceInput.ts:114/useSpeakText.ts:83.
**DO NOT TOUCH** FileTree.tsx:58 (codex-owned). **FIX → `platform.assets.url(id)`:** the 2 hardcoded
`src={\`/api/assets/${id}\`}` (ChatMessageBody.tsx:60, views.tsx:781). Desktop returns
`entityClient.assetUrl(id)` verbatim → byte-identical; mobile later → `capacitor://`/blob.

### 1.5 confirm/prompt/alert — FULL census (B1: NOT all async)
`PlatformDialogs.*` are async (Capacitor). ~21 non-test sites, split:
- **ASYNC-safe (await inline)**: WorkspaceContext.tsx:1277, ConceptInspector.tsx:143,157,
  operationViews.tsx:415, layerViews.tsx:209, svpackViews.tsx:420, sourceEditor.tsx:209,
  LayerLensManage.tsx:96, SettingsHub.tsx:309 (prompt, async), LayerLensManage.tsx:38 / layerViews.tsx:143
  (prompt, async).
- **SYNC callbacks — MUST restructure to `void (async()=>{ if(!(await platform.dialogs.confirm(…)))return; … })()`**:
  `operationViews.tsx:333` (convertToTemplate useCallback, non-async, onClick), `ChatSessionSwitcher.tsx:30`
  (confirmDelete sync predicate, called sync at :76), `trashViews.tsx` purgeOne/purgeAll (sync, consume the
  `defaultUi` seam).
**Precedent to fold:** `DataTrustUi` (dataTrust.ts:101-111) + `TrashUi` (trashViews.tsx:22-32) →
`platform.dialogs` generalizes both (delete `defaultUi`).

### 1.6 File layout (~7 new) + provider placement
`src/client/platform/`: types.ts · desktopPlatform.ts · webPlatform.ts · memoryPlatform.ts (test — REQUIRED,
§1.7) · PlatformContext.tsx (PlatformProvider + usePlatform()/usePlatformOptional()) · platformSingleton.ts
(getPlatform()/setPlatform() for non-hook helpers) · index.ts. **Web degrade** (`webPlatform.ts`):
capabilities false; `files.*`→`<input type=file>`/null (canPickFile() already disables — noteTypeRegistry.
test.tsx:464); native undefined (fileLinkNoteType.tsx:60-70 degrades shellOpen→clipboard); dialogs→`window.*`
in Promise.resolve; assets.url→entityClient.assetUrl. **Mount:** PlatformProvider at App.tsx:46-54 OUTSIDE
WorkspaceProvider; `setPlatform(detectPlatform())` in main.tsx BEFORE createRoot (pref helpers run during
first render). `detectPlatform()`=`window.studyVault?.desktop ? desktopPlatform() : webPlatform()`.

### 1.7 Testing — `memoryPlatform.ts` REQUIRED (analog of the existing `memoryStorage`)
In-memory prefs Map; dialogs with injectable answers (default confirm→true, WorkspaceContext.tsx:1487);
injectable files; assets.url→`/api/assets/${id}`. Lets us DELETE setTrashUiForTests + the UI half of
setDataTrustIoForTests.

### 1.8 Part-1 order: platform files (additive) → assets (2) → prefs (~30 helpers + ~6 inline) → dialogs
(fold DataTrustUi/TrashUi; ~4 sync sites restructured) → files/native. Guards: per-area existing tests.

## PART 2 — Split WorkspaceContext (2680 lines). XL. **(round-2: clean pipeline, not a blob)**
Round-2 confirmed the cluster is **NOT atomic** — it SPLITS at the `sourceBundles` seam. The model is a
**unidirectional data pipeline + a thin coordinator** (the "cycle" is entirely in orchestration, not data).

### 2.1 The data PIPELINE (each stage reads only upstream, owns only its own state)
```
sourceDomain (sources LIST; loadSources = PURE list-load, NO pane mutation)
   ↓ read-only
paneDomain (openPanes/focusedPaneId; OWNS activeSourceId = focusedPane?.sourceId ?? "" :744)
   ↓ read-only (activeSourceId injected)
readerDomain (KEYED QUERY sourceId→SourceBundle{renderedHtml,anchors,notes,patches,sourceLayers} — the
   CUT-POINT at :742; fetchSourceBundle :1067 pure dep[sources]; loadPaneBundle :1128 takes a KEY only;
   the ONE coupling — refreshAnnotations' `if(targetId===activeSourceId) mirror` :1173 — is a one-way read,
   resolved by injecting activeSourceId/isFocused(id))
   ↓ read-only (bundle contents)
layerDomain (visibleNotes/enabledLayerIds from notes/sourceLayers :934-947)
   ↓ derived
paint  (focusedPaint :957 / paintAnchorsForPane :969 = a SELECTOR/useMemo, NOT a domain)
```
**coordinator `workspaceCommands`** — the cross-domain workflows live HERE, as explicit sequenced actions,
NOT as hidden back-edges: `openSourceInNewPane` = `paneDomain.open(id)` then reader reacts via effect;
loadSources-then-autofocus = `sourceDomain.load()` + `paneDomain.focus()` (moves the current `loadSources`
pane-mutation :1048-1056 OUT); the current `commandContext` weld (:1466-1548) IS this coordinator.
`importDomain` (:449) attaches to the coordinator (drives loadSources + uses `platform.files`).

### 2.2 Extraction recipe (proven by `useChatSessions.ts` for the read-only-dep shape)
Each `useXDomain(deps)` hook: owns its state (moved verbatim); cross-domain deps as read-only ARGS (never
touches window/electron/entityClient-in-a-component); returns a **`useMemo`-wrapped surface**
(useChatSessionDomain :384-388). The provider spreads each surface into the 128-field `value` memo
(:2409-2662), which stays **byte-identical** (value-memo is the ONLY consumer path — one createContext, hooks
:2667/:2678, no ref/secondary-context escape — verified). **A2 risk:** a domain returning a fresh surface
object each render busts the 128-dep memo → all consumers re-render. Mitigate: per-domain `useMemo` +
a "provider re-renders ≤ N on a no-op change" guard test at layoutDomain first, AND covering the
operation/kit toolbar memos (they re-run on every `activeSource` change).

### 2.3 Extraction ORDER (topologically valid — round-2 fixed)
**Genuinely isolated (only these 2), extract FIRST:** 1. `layoutDomain` (layout :680+theme :687; dep =
localStorage/applyTheme [not platform.prefs — relabel]; ZERO activeSourceId). 2. `pluginDomain` (:695).
**The pipeline, as the unidirectional stages + coordinator:** 3. `sourceDomain` → 4. `paneDomain` → 5.
`readerDomain` → 6. `layerDomain` (+ paint selector) → the `workspaceCommands` coordinator. 7.
`conceptDomain` (:586 — version-token isolated EXCEPT `undoConceptMark` captures `refreshAnnotations` :1887 +
mutation handlers in the coordinator → inject `refreshAnnotations`). **8. `kitDomain` + `operationDomain`
AFTER the pipeline (NOT isolated — round-2):** kitDomain reads `activeKitIds=activeKitIdsForSource(activeSource)`
:2116, `setActiveKit` calls loadSources :2126; operationDomain's `selectionActions`/`sourceActions` read
`activeKitIds`←activeSource (:2330/:2362), `runAction` captures `dispatch` :2383 → extract with
`{activeSource, activeKitIds, loadSources, dispatch}` injected. 9. `chatDomain`/`generationDomain`/
`agentDomain` fold in (consume activeSourceId read-only). status/error (:394) stays cross-cutting.

### 2.4 `activeSourceId` is PANE-DERIVED, owned by `paneDomain`
`activeSourceId = currentFocusedPane?.sourceId ?? ""` (:744); `setActiveSourceId` (:753) is a shim mutating
openPanes/focusedPaneId → the pane model owns it, NOT the source list. `activeSource` DERIVED (`sources.find`).
All downstream take it READ-ONLY (useChatSessionDomain({activeSourceId}) :111). Directly unblocks multidoc:
readerDomain as a keyed query → N panes each pull their own bundle; no single-active weld.

### 2.5 Violations to fix (enforceable, Part-2 tail) — ✅ DONE + ENFORCED (Slices 8a-8e, 2026-07-06)
Components calling `entityClient` inline → rule: components read ctx/domain; only domains + `*Io.ts` call
entityClient. **Landed:** the "LARGE" framing was inflated — a TS-resolver re-scan found the real violation set
was **~15 files (NOT 68 — 38 importers were `import type`-only)**. Relocated behind leaf facades in 5 sub-slices:
8a concept (conceptIo), 8b layers (layerIo), 8c operations+svpack (operationIo/svpackIo), 8d triggers+assets+anchor
(triggerIo/assetUrl/mediaIo/anchorIo), 8e residual (graphIo/kitIo/pluginCatalogIo/shellIo + reuse of settingsIo/
onboardingIo). **Enforced by §5.2's `check-mobile-imports.ts` Rule C** — `checkDirectImport` (a DIRECT-import
check, type-only edges excluded via `runtimeEdges`, exempt = `/Io\.ts$/` + `/use\w+Domain\.ts$/` + data/platform/
WorkspaceContext/memory-capture), enforcing in `npm run check`: **179 client entries, 0 direct entityClient
imports**. Liveness-proven (multi-line fluent + barrel-smuggle both caught). The guard IS the drift-proof detector
that made the count honest (the earlier plan under-counted the fluent-style `entityClient\n.method(` calls).

## PART 3 — directTransport route coverage (B4: 4 routes added)
**✅ LANDED (2026-07-06).** Added 28 routes to `directTransport.ts` (concepts/relations/operations/operation-prefs/
plugin-prefs+catalog/workspace+onboarding+ui-prefs/source-layer/layer DELETE+export+import/PATCH sources/assets
base64+meta/svpack list+delete/about/vault), each byte-parity-tested vs its `app.ts` Express sibling (incl.
failure paths — consistency-400s, null-clear, merge, asset cap, 404s). A permanent COVERAGE GUARD asserts every
entityClient path is routed OR throws `DirectTransportUnsupportedError`; adversarial-review NIT folded → it's now
**DRIFT-PROOF** (source-derives the `/api/…` universe from `entityClient.ts`, so a future path with no guard row
fails). Kept UNROUTED with reason: 4 ingestion (network/unzip), raw-byte/stream, the svpack CRYPTO family (need
`identityDir`/device-key not on `DirectTransportDeps` — confirmed un-inprocess-able), AI/provider/managed lanes.
tsc 0 · full vitest 277f/2817t · build ✓.
`directTransport.ts:185-504` routes sources/authoring/fork/anchors/notes/patches/layers(partial)/search/
memory/review/triggers/graph. **ADD (~28, each mirrors its app.ts Express impl):** concepts GET/POST/:id
GET/DELETE/merge (:1144-1187); relations GET/POST/DELETE (:1189-1210); operations GET/POST/:id GET/PATCH/
DELETE (:1239-1290); operation-prefs GET/PUT (:1297-1313); plugin-prefs GET/PUT/catalog (:1373-1398);
workspace GET/PUT + onboarding + ui-prefs (:1409-1461); source layer POST (:896); assets `:id/meta` GET
(:1084), base64 POST (:1052 + MAX_INLINE_IMAGE_BYTES cap). **Round-2 additions (were silently missing):**
PATCH `/api/sources/:id` (:568, `updateSourceMetadata` — LOAD-BEARING, called by `setActiveKit`); DELETE
`/api/layers/:id` (:921) + layer export/import `/api/layers/:id/export` (:931) + `/api/layers/import/preview|
commit` (:1025/:1035); the `/api/svpack*` + `export-svpack` family (svpack.ts:378-709 — `exportSvpack`
entityClient.ts:1123, `deleteSealedImport` :1143); GET `/api/about` (:168); GET `/api/vault` (:537).
**Coverage guard:** extend `directTransport.test.ts` to assert EVERY entityClient path is either routed OR
throws `DirectTransportUnsupportedError` (today it only checks chat+assets → these gaps were silent).
**INGESTION routes (B4 — the 4 the v1 silently dropped): CLASSIFY as desktop-only, keep-UNROUTED for now,
with the mobile-parity consequence stated** (they need server-side file/network/unzip work, same family as
`/api/local/*`): POST `/api/sources/url` (:587, importFromUrl), `/api/sources/web-live` (:598, openLiveUrl),
`/api/sources/local-file` (:658, openLocalFile), POST `/api/notes/import-xmind` (:795, importXmindFile). When
the mobile track needs in-app import, these get a direct-core impl (URL-fetch + unzip shims) — tracked, not
silently missing.
**Keep UNROUTED (throw `DirectTransportUnsupportedError`):** `/api/assets/:id` bytes (directTransport.test.ts:
454 asserts throw), chat/agent stream, `/api/sources/:id/file|content`, `/api/local/*`, + the 4 ingestion
routes above. **§3.3:** `assetUrl`→`platform.assets.url()` for direct-core; chat/agentStream stay HTTP-only (a
direct-core stream shim is x2a scope). **Guard:** extend directTransport.test.ts parity (byte-identical vs
Express); coordinate with SQLite (adds an engine axis to the same file — orthogonal rows, land in sequence).

## PART 4 — De-Node the vault + the SIGNATURE-FIRST sequencing (#6: split the co-land)
### 4.1 `vault.ts` changes
`:1` node:path → logical-`/`-paths (§4.2). `:32-36` getDefaultVaultRoot (process.env+cwd) → move root
resolution to the DESKTOP shell (`start.ts`); `rootDir` REQUIRED. `:87` remove `?? nodeStorage` → `storage`
REQUIRED (drops the import). `:110` createEntityStores signature = the shared line.
### 4.2 PathAdapter — LOGICAL `/`-paths (recommend): POSIX `/`-joined strings in the portable core; each
StorageAdapter maps logical→physical (nodeStorage→path.resolve; capacitor→Filesystem). getVaultPaths becomes
pure `/`-concatenation. Less invasive than a threaded interface.
### 4.3 SIGNATURE-FIRST PR, THEN parallelize (round-1 #6 — do NOT weld the two tracks)
`createEntityStores` already defaults `storage`; all ~46 test `openVault` sites pass explicit `rootDir`, and
Electron passes it (electron/main.ts:49). **Round-2 correction:** `getDefaultVaultRoot()` is NOT caller-free
— **3 external callers** (electron/main.ts:42, scripts/seed.ts:26, scripts/prune-orphan-anchors.ts:15) AND
`start.ts:55` relies on the `?? getDefaultVaultRoot()` default for the CLI/dev path (`vaultRoot?` optional).
So the signature PR is **behavior-preserving FOR TESTS, not a pure no-op**. Land ONE PR:
`createEntityStores(studyDir, storage, engine: StoreEngine = jsonlEngine)` + `openVault({rootDir, name,
storage, engine?})` with `engine` defaulting to CURRENT behavior; **move root-resolution into `start.ts`
before the openVault call**, and **update the 3 external callers** (keep `getDefaultVaultRoot` exported for
the 2 scripts, or update their imports in the same commit). Tests stay green (all pass rootDir). THEN Part-4
(make params required, remove Node defaults) AND SQLite #47 Stage-1 (`sqliteEngine`) parallelize on top —
each independently bisectable. Touch-list: vault.ts, entities.ts, start.ts, electron/main.ts, scripts/seed.ts,
scripts/prune-orphan-anchors.ts. (Also de-Node `entities.ts:1` `node:path` in Part-4, §4.1's list missed it.)
### 4.4 CapacitorStorage — OUT of scope (only node+memory exist; x2a/mobile). Part 4 done when
`memoryStorage` backs a full `openVault` with no `node:path`/`process` reachable in the portable graph.

## PART 5 — Desktop isolation + mobile import guard
### 5.1 Barrel-leak fix FIRST (1 line — round-1 confirmed): `errors.ts:8` → `import { VisionUnsupportedError }
from "../../ai/provider";` (was `../../ai` barrel → pulls claudeCliProvider's node:child_process/crypto into
23 importers incl 8/12 directTransport services). Consumed only at errors.ts:76 + 2 tests deep-importing
`./provider`. No ripple. Guard: tsc 0.
### 5.2 Enforcement — `scripts/check-mobile-imports.ts` via the **TS COMPILER API** (N3 — not a regex walk)
No eslint/dep-cruiser in repo (only tsc+vitest+tsx); `typescript` is a dep; the `scripts/*.ts`-under-tsx idiom
exists (seed.ts). A CORRECT transitive-import guard needs real module resolution (index barrels, extensionless
.ts/.tsx, `moduleResolution:"Bundler"`) → ~200-300 LOC via `ts.createProgram` + `resolveModuleName`, NOT a
regex (false positives in comments/strings, misses transitive Node edges). It walks the MOBILE ENTRY graph
(future `src/client/mobile/` + transitive imports), FORBIDS electron/node:*/node-pty/WebviewReader/pty/
keyStore-safeStorage/claudeCliProvider/crypto-primitives, exits non-zero listing offenders. Wire:
`"check":"tsc --noEmit && tsx scripts/check-mobile-imports.ts"`. BLOCKED until §5.1. Reuse the same
program/resolver for the Part-2 rule (components ⊄ entityClient).

## PART 6 — Acceptance = boundaries enforced by §5.2's resolver
| Criterion | Rule | Today |
|---|---|---|
| core ⊄ React/window/electron | scan `src/core/**` | **GREEN** |
| portable ⊄ node:fs/path | forbid in `src/core/**` | **✅ GREEN (Part 4 COMPLETE)**: 4a (rootDir/storage required + getDefaultVaultRoot→`server/vaultRoot.ts`, core stops importing nodeStorage) + 4b (node:path→logical `/`-paths in vault/entities/assets/sources; §4.4 memoryStorage acceptance test passing) landed. The portable store graph composes logical `/`-paths + injects storage/engine. Sanctioned node-coupled leaves (out of scope, injected/by-design): `storage/nodeStorage.ts`, `store/sqliteEngine.ts`, `identity/**`, `crypto/primitives.ts`. Enforcement: §5.2's guard Rule A (in progress) |
| views ⊄ fetch/studyVault/localStorage | forbid in `src/client/**` outside `platform/`+`*Io.ts` | **✅ MOSTLY GREEN — Part 1 COMPLETE**: platform adapter fully consumed. `window.studyVault` drained from consumers (native+files+capabilities funnel); prefs/dialogs/clipboard/assets all route through the adapter. Residual: `anchorViews.tsx` localStorage (codex-owned — awaits codex funnel) |
| entityClient all-through-transport | no bare `fetch(/api/…)` outside transport + 3 streams | **✅ GREEN — Part 3 landed**: directTransport +28 routes, byte-parity vs Express, drift-proof coverage guard (source-derives the /api universe from entityClient.ts); 3 streams + 4 ingestion routes = documented mobile-gap exceptions |
| WorkspaceContext only-composes | no useState/inline entityClient in the provider | **✅ GREEN — Part 2 COMPLETE (Slice 7a/7b/7c)**: the provider is now a pure composer. `grep -c useState WorkspaceContext.tsx` = **0** (all 16 bare useState relocated into the domain hooks: generation 7a, composer 7b, agent 7c) and `entityClient.<method>(` call sites in the provider body = **0** (the last one, `sourceBundle`, moved into `useAgentDomain` with the buildChatContext/resolveAttachmentBundles bridge; generateStructured/classifyForm/createNote → 7a, importImageBase64×2 → 7b, aiProviders/agentStream → 7c). The apparent generation↔coordinator cycle is resolved by the `[]`-deps trampoline machinery (dispatchRef/parkRef/resetRef/disabledRef + 3 render-time assigns). The SOLE surviving `entityClient` reference is `client: entityClient` at commandContext (:782) — a by-design reference HANDED to the command registry (commands do their own IO), NOT a provider-body call, so it does not block GREEN. Body-only survivors are the coordinator (commandContext/dispatchImpl useCallbacks) + focus/locale/derive composition — all allowed. |
| mobile-build node-free | §5.2 resolver on the mobile entry graph | **✅ ENFORCED (Rule A) — `scripts/check-mobile-imports.ts` in `npm run check`**: portable core (63 entries) proven 0 node-reaches except the 4 sanctioned injected leaves; whole `node:` namespace + electron/better-sqlite3/node-pty forbidden. Rule B (mobile-entry walk) is a future-ready hook — activates one-line when `src/client/mobile/` lands (paused Capacitor track) |

## Staged SEQUENCE (per stage: tsc 0 · full vitest green [baseline 271f/2743t] · build)
1. **§5.1 barrel fix** (1-line prereq). PARALLEL. 2. **Part 1 platform files+provider** (additive). PARALLEL.
3. **Part 1 funnel** assets→prefs(~30+~6)→dialogs(~4 sync restructured)→files. PARALLEL. 4. **Part 2 TIER A**
(layout→plugin→kit→concept→operation) — safe linear. PARALLEL. 5. **Part 3 routes** + assetUrl ripple.
PARALLEL. 6. **SIGNATURE-FIRST no-op PR** (§4.3) — additive, tests green. **SERIAL sync point (shared w/
SQLite).** 7. **Part 2 TIER B** `documentsDomain` (the XL core, one unit) + **Part 4 de-Node** (parallel with
SQLite Stage-1 after step 6). 8. **Part 2 TIER C** + violations cleanup. 9. **§5.2 guard** → `npm run check`;
**Part 6** flips green as parts land. 10. **Capacitor shell** LAST (PAUSED mobile track, out of scope).
**PARALLEL w/ SQLite #47:** 1,2,3,4,5,7(Part4),8,§5.1,§5.2. **SERIAL:** only step 6 (the no-op signature).

## Top risks + size
| Part | Size | Top risk |
|---|---|---|
| 1 PlatformAdapter | M (~7 new + ~26 edited: ~30 pref helpers + ~6 inline + ~4 sync dialogs + 2 assets) | sync→async restructure at ~4 sites; a missed `native`/capability silently breaks a desktop surface |
| 2 WorkspaceContext | **XL** | the `documentsDomain` cluster is NOT linearly splittable (cycle); context-identity re-render (§A2); 50 activeSourceId refs |
| 3 directTransport | M (~28 routes; 4 ingestion kept-unrouted) | byte-parity drift vs Express; ingestion-route mobile gap |
| 4 de-Node vault | S-M | mitigated by signature-first no-op (no longer welds two tracks) |
| 5 guard | S-M | TS-compiler-API resolver (~200-300 LOC), not regex |

## Self-attack (round-1 verified)
- **A1 interface**: added `native`+`clipboard`+`capabilities.notification/microphone`+`native.openUrl`;
  `getPathForFile` dead → excluded. `native` consumers only TerminalPanel/webviewSelection (non-codex).
- **A2 stable-value during extraction** = TRUE for the 128-memo (value-memo is the ONLY consumer path,
  verified) BUT the re-render risk is real: any domain returning a fresh surface object busts the 128-dep
  memo → all consumers re-render. Chat proves the read-only-dep pattern (TIER A/C) but NOT the coupled
  `documentsDomain` cluster — the hard part is unproven; land the render-count guard at layoutDomain first.
- **A3 barrel fix** = 1 line (round-1 confirmed): changes errors.ts's own import, not its exports; 23
  importers unaffected; safe unless provider.ts later grows a Node dep (node-clean today).

### Critical files
`src/client/workspace/WorkspaceContext.tsx` (Part 2 — type :390-711, value memo :2409-2662, activeSourceId
derive :744) · `src/client/platform/types.ts` (Part 1 NEW) · `src/server/services/directTransport.ts` (Part 3
— :185-504) · `src/core/vault.ts` (Part 4 + SQLite co-land — :87 storage default, :110 signature) ·
`src/server/services/errors.ts` (Part 5 — 1-line fix at :8).
