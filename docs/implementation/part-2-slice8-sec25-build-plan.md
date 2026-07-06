# PLAT-LAYER §2.5 Build Plan — "components ⊄ entityClient" (Part-2 tail)

The spec-flagged "LARGE cleanup → tail, not a blocker" (platform-layering-build-spec.md:183-186). NOT in the
6/6 acceptance table (that's already GREEN). Enforced by a new §5.2-resolver **Rule C**.

## HONEST SCOPE (measured on codex/foundation-refactor — NOT 68)
71 production `src/client` importers of entityClient → **38 are `import type` only** (the rule excludes type-only
edges for free) → most of the ~33 runtime-callers are already SANCTIONED (10 `use*Domain.ts` hooks + 7 `*Io.ts`
+ data/platform/memory-transport). **True violations = 9 files** + 3 assetUrl call-sites + 2 DI relocations =
**~14 files touched, ~5 new small Io modules. Effort: M, ~5 sub-slices.**

**TOP RISK = over-refactoring.** The 38 type-only files (incl. workspace/*.ts models sourceBundles/noteCards/
paneSelectors/notesExport/dock/graphLens/anchorBoardModel/groupBookmarks/layerTree/presets, the registries
noteTypeRegistry/viewerRegistry/commands-registry/viewRegistry, triggers registry/teachback/reviewPush, chat/
chatContextAssembly, memory/commandCapture, agentTurnReducer) are ALREADY CLEAN — DO NOT TOUCH.

## SANCTIONED (exempt from Rule C — keep as-is)
`*Io.ts` · `use*Domain.ts` (the domain hooks) · `data/**` · `platform/**` · `WorkspaceContext.tsx`
(`client: entityClient` DI handoff to the command registry, :782) · `memory/capture.ts` (postMemoryEvents
transport facade).

## THE 9 REAL VIOLATIONS + destinations (prefer EXISTING ctx/hook over new Io)
| # | File | entityClient methods (runtime) | Fix |
|---|---|---|---|
| 1 | inspectors/ConceptInspector.tsx | conceptDetail, concepts, allNotes, deleteRelation, deleteConcept, mergeConcept | **new conceptIo.ts** (concepts NOT on ctx by design — WorkspaceContext:456-459 holds only conceptsVersion) |
| 2 | inspectors/RelationInspector.tsx | relations, concepts, deleteRelation | conceptIo.ts |
| 3 | workspace/conceptViews.tsx | concepts, allNotes | conceptIo.ts |
| 4 | workspace/ConceptChips.tsx | updateNote, createConcept | conceptIo.ts |
| 5 | workspace/layerViews.tsx | layers, exportLayer, createLayer, patchLayer, deleteLayer, importPreview, importCommit | **read `layers()`→`useWorkspace().sourceLayers`** (:493); mutations→**new layerIo.ts** |
| 6 | workspace/LayerLensManage.tsx | createLayer, patchLayer, deleteLayer, exportLayer, importPreview, importCommit | layerIo.ts (reads via ctx) |
| 7 | workspace/operationViews.tsx | updateOperation, createOperation, deleteOperation, saveOperationPrefs | **extend useOperationDomain** (data already flows there) |
| 8 | workspace/svpackViews.tsx | exportSvpack, sealedImports, inspectSvpack, openSvpack, commitSvpack, deleteSealedImport | **new svpackIo.ts** (no ctx surface — dedicated Io correct) |
| 9 | workspace/NudgeToast.tsx | snoozeTrigger, dismissTrigger | **new triggerIo.ts** |

**assetUrl special cases (NOT data-fetch — sync `${scheme}/api/assets/${id}` builder already platform-funneled):**
notes/builtinNoteTypes.tsx (assetUrl + importAsset), workspace/views.tsx (assetUrl only), workspace/
ChatMessageBody.tsx (assetUrl only). Fix: a 1-line sanctioned re-export `data/assetUrl.ts` (`export const assetUrl
= entityClient.assetUrl`); components import from there. builtinNoteTypes' real `importAsset()` → mediaIo.ts.
DO NOT convert the render-time assetUrl calls to async.

**Bucket-3 relocations:** proactiveTick.ts (triggers/triggerFires/recordTriggerFire → triggerIo.ts) ·
focus/FocusContext.tsx (`createAnchor = entityClient.createAnchor` DI default → **new anchorIo.ts** 3-liner;
FocusContext is BELOW WorkspaceContext → cannot route through ctx).

## SUB-SLICES (each: tsc 0 · full vitest green · named component tests · adversarial review · land)
- **8a Concept family:** conceptIo.ts + ConceptInspector/RelationInspector/conceptViews/ConceptChips. Tests:
  conceptInspector/conceptViews/conceptChips.
- **8b Layers:** layerIo.ts + layerViews (read→ctx.sourceLayers, mutate→Io) + LayerLensManage. Tests: layerViews.
  **RISK: LayerLensManage has NO test — add characterization for the 6 mutations FIRST.** Verify the
  layersVersion/refreshLayers cadence matches before deleting layerViews' local `layers()` fetch — if timing
  differs, keep the read in layerIo.ts rather than forcing ctx.
- **8c Operations + svpack:** extend useOperationDomain (create/update/delete/saveOperationPrefs) + operationViews;
  svpackIo.ts + svpackViews. Tests: operationViews/svpackViews.
- **8d Triggers + assets + anchor DI:** triggerIo.ts (NudgeToast + proactiveTick), data/assetUrl.ts re-export
  (builtinNoteTypes/views/ChatMessageBody) + mediaIo.ts (importAsset), anchorIo.ts (FocusContext). Tests:
  NudgeToast/proactiveTick/builtinNoteTypes/FocusContext.
- **8e The guard (LAST, green-last enforcing):** add Rule C to scripts/check-mobile-imports.ts + tests.

## RULE C spec (scripts/check-mobile-imports.ts — reuse createResolver + runtimeEdges)
A **direct-import** check (NOT transitive BFS — a component importing a domain hook that internally calls
entityClient is FINE). Add `checkDirectImport(program, resolve, {entries, forbidResolved, exempt, label})`
(~40 LOC): for each entry, read its OWN `runtimeEdges` (already erases type-only), flag any edge resolving to
`src/client/data/entityClient.ts`. `collectClientEntries(program)` mirrors collectCoreEntries (scan src/client/,
drop tests/fixtures/testing + exempt-glob matches). Exempt globs: `/Io\.ts$/`, `/use\w+Domain\.ts$/`, path
fragments `src/client/data/`, `src/client/platform/`, `workspace/WorkspaceContext.tsx`, `memory/capture.ts`.
Runs in `run()` after Rule A. Tests (check-mobile-imports.test.ts): (1) Foo.tsx calling entityClient → 1
violation; (2) `import type` → 0; (3) barIo.ts → 0 (exempt); (4) useBarDomain.ts → 0 (exempt); (5) component
importing a hook that imports entityClient → 0 (direct-import not transitive). Export checkDirectImport +
collectClientEntries. Land ENFORCING mode last (8e) — 8a-8d clean the tree first; no warn-mode bit-rot.

## Io module placement (avoid circular imports — keep Io leaf: import ONLY entityClient + record types)
conceptIo.ts in a NEUTRAL dir (ConceptInspector is in inspectors/, conceptViews in workspace/ → put conceptIo in
`src/client/concept/` or `src/client/data/`-adjacent so neither view dir cycles). layerIo/svpackIo/triggerIo/
mediaIo/anchorIo: leaf modules importing only entityClient + types.

## Codex-owned (verified ZERO entityClient imports — no work, no special-casing): anchorViews.*, SlashPalette.tsx,
actionIcons.ts, FileTree.tsx.
