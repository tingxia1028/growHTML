# PLAT-LAYER Part-2 — WorkspaceContext split: verified sub-slice plan

**Decision (2026-07-06):** owner chose to complete Part-2 FULLY (PLAT acceptance → 6/6), accepting the XL
`documentsDomain` slice's risk with characterization tests + adversarial review. This doc is the blessed
build plan (verified by a Plan agent against the real `src/client/workspace/WorkspaceContext.tsx` @ `30e131b`).

## Goal / acceptance
`WorkspaceContext.tsx` should ONLY COMPOSE — **no bare `useState` and no inline `entityClient.*` in the
provider body**; state+logic live in extracted domain hooks (`useLayoutDomain`, `usePluginDomain`,
`useConceptDomain`, `useDocumentsDomain`, `useKitDomain`, `useOperationDomain`, `useGenerationDomain`/…) that
the provider wires into its value. The ~128-field value must keep the SAME re-render identity semantics.

## Corrected census (verified — the older §2 numbers under-counted)
- 2702 lines · **128 value fields** (:2431-2559) · **120-entry value memo dep-array** (:2562-2681; 8 fewer =
  aliases like `anchorBarActions`=`selectionActions` + stable module consts).
- **43 `useState`** · 0 `useReducer` (agent turn = plain `useState<AgentTurnState>` + pure `reduceAgentEvent`) ·
  **6 `useRef`** · ~69 `useCallback` · ~13 `useMemo` · **9 `useEffect`** · **34 `entityClient` call sites** ·
  48 `activeSourceId` · 20 `activeSource`.
- **25 consumer files** call `useWorkspace()`/`useWorkspaceOptional()`; ALL destructure specific fields, but
  React `useContext` re-renders a consumer on VALUE-OBJECT-IDENTITY change → the single value memo (:2430) is
  the sole re-render lever. One `createContext` (:729), two hooks (:2688,:2699), no ref/secondary-context escape.

## The two make-or-break guards
1. **Render-count guard (Slice 0, FIRST):** no render-count test exists today → §A2 is eyeball-only. Slice 0
   adds `WorkspaceContext.render.test.tsx`: a no-op state write must NOT re-render consumers; a real field
   change re-renders EXACTLY once. Every later slice verifies against it.
2. **Memoized-surface pattern (every slice):** each domain hook returns a `useMemo`-wrapped surface; the
   provider spreads `{...docs, ...ops, …}` into its value; the value memo's deps shrink from 120 → ~7 surface
   objects, but each surface's identity changes on the SAME cadence as its fields → identical re-render
   behavior. Proven by `src/client/chat/useChatSessions.ts` (surface memo :374, domain memo :388). A domain
   hook that returns a fresh object literal each render busts the value memo → 25-consumer render storm.

## TIER partition (dependency-edge verified)
- **TIER A leaves** (no read of pipeline state): `layoutDomain`+`themeDomain` (already route through
  `getPlatformOptional()?.prefs` — no relabel needed), `pluginDomain`, `conceptDomain` (one back-edge: inject
  `refreshAnnotations` for `undoConceptMark` :1902).
- **TIER B — `documentsDomain` = the XL core, ONE unit.** The "cycle" is ORCHESTRATION not data: `panes` owns
  `activeSourceId` (:754 derived from focused pane) but `sourceBundles`/top-level reader state react to it via
  effects that ALSO write panes (`loadSources` prune+autofocus :1061, `deleteSourceItem` :1303), and
  `refreshAnnotations` (:1166) reads `activeSourceId`+`sourceBundles` while writing BOTH bundles and top-level
  (mirror only if `targetId === activeSourceId` :1186). CANNOT sub-split panes/bundles/sources (would thread
  setters across hook boundaries). Extract as one `useDocumentsDomain({ focus, parkDraft })` → ~55-field surface.
- **TIER C** (compose over pipeline): `kitDomain` (reads activeSource), `operationDomain` (reads activeKitIds+
  focus+dispatch), and the **coordinator** (`commandContext` :1478 + `dispatch` :1568 + generation/agent/composer
  cluster) — wired LAST; its `entityClient` calls (`generateStructured`/`classifyForm`/`agentStream`/`createNote`/
  `importImageBase64`) move into `useGenerationDomain`/`useAgentDomain` to satisfy "only-composes".

## Ordered sub-slices (each independently landable: tsc 0 · full vitest green · build ✓ · §5.2 guard green)
| # | Slice | Size | Confidence | Coverage / flag |
|---|---|---|---|---|
| 0 | render-count guard test (no prod change) | S | High | new safety net — do FIRST |
| 1 | `useLayoutDomain` + `useThemeDomain` | S | High | good (App/Shell/TopBar tests) |
| 2 | `usePluginDomain` | S-M | High | good (pluginManagerViews) |
| 3 | `useConceptDomain` (inject refreshAnnotations) | S | Med-High | **flag: undo-after-mark-repaint untested → add targeted test** |
| 4 | **`useDocumentsDomain` (XL core, one unit)** | **XL** | **Low-Med** | **TOP RISK — 5 effects + refreshAnnotations back-edge (:1186) untested. Add characterization tests: (a) switch source→mirror, (b) refocus cached→no refetch, (c) refresh non-focused→no mirror BEFORE landing** |
| 5 | `useKitDomain` | S | High | good |
| 6 | `useOperationDomain` | M | Med | good (operationViews/actionGroups/toolbars) |
| 7 | coordinator + `useGenerationDomain`/`useAgentDomain` (removes last inline entityClient/useState) | L | Med | good |
| 8 | §2.5 violations cleanup (components ⊄ entityClient → `*Io.ts`) + wire the Part-5 resolver rule | L | High/tedious | after the flip is green |

Acceptance "WorkspaceContext only-composes" flips GREEN after **4 + 7** (documents + coordinator). New hook
files live in `src/client/workspace/` — NO collision with codex-owned files (anchorViews/actionIcons/
SlashPalette/FileTree/styles.css). Pipeline primitives (`panes.ts`, `sourceBundles.ts`, `paneSelectors.ts`)
already exist + are tested + non-codex.

## Extraction blueprint (per slice)
`useXDomain(deps)` in `src/client/workspace/useXDomain.ts`, owns its state moved VERBATIM, cross-domain deps as
READ-ONLY args, returns a `useMemo`-wrapped surface. Provider spreads `...x` into the value memo (deps become the
surface objects). Verify each against Slice-0's render guard + the domain's existing tests; for weak-coverage
slices (3, 4) add characterization tests BEFORE landing.
