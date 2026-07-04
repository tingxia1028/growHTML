# SC-2 — slash composer on the toolbar surfaces — BUILD SPEC

Status: Plan agent produced this (strong + self-critical; the key insights below ARE the review).
Additive / low-risk (mount a shipped component + extract a shared helper; NO contract change) →
no separate adversarial round. **Build AFTER A4b lands** (shared `views.tsx` `pickSlashEntry`
region, disjoint from A4b's chat-panel/transcript region → trivial rebase). Mount the shipped
`/类型` palette (SC-1 chat + SC-3 operations) on the SELECTION floating toolbar + the ANCHOR action bar.

## Decisive finding (drives the whole design)
Every dispatch path ALREADY materializes the focused selection at run time — SC-2 adds NO new
materialization: `note.generate-block` → `focus.materializeAnchor()` at registry.ts:848; `operation.run`
at registry.ts:759; `openManualEditor` (WorkspaceContext.tsx:1532) → Save routes `anchor.add-note`
which materializes. `focus.materializeAnchor()` (FocusContext.tsx:196) reads the live `focus.draft`
(or short-circuits to an existing `focus.anchor` at :197). So SC-2's ONLY job: **keep `focus.draft`
alive until the pick dispatches** → the whole risk is SELECTION-BLUR.

## KEY DESIGN DECISIONS (locked)
- **Trigger = a dedicated `/` affordance BUTTON** on the toolbar (NOT keyboard typing — toolbars have no text input). Opens the palette as a popover anchored to the button, bare `/` = full list (`resolveSlashEntries("", slashEntries(...))`).
- **NO focusable filter input in the popover — drive filtering from KEYDOWN** (forward keys like the chat does, views.tsx). A focusable input WOULD steal focus + collapse the reader DOM range → drop `focus.draft`. Keydown-driven filtering eliminates the blur class at the source. (This is the plan's risk-1 recommendation — take it.)
- **`onMouseDown → preventDefault`** on the `/` button, the popover wrapper, AND every row (proven pattern: SelectionFloatingToolbar.tsx:151, SlashPalette.tsx:119) so opening/navigating never collapses the selection.
- **Palette Escape `stopPropagation`** so Escape closes the palette FIRST without also firing the document-level Escape that clears the selection/toolbar (SelectionFloatingToolbar.tsx:91). A second Escape (palette closed) clears the selection.
- **Gate the `/` button on `focus.anchor || focus.draft` on the anchor bar** (mirror the existing `ActionGrid disabled` empty-state at anchorViews.tsx:195). The selection-toolbar mount stays always-enabled (it only appears with a live selection).
- **Toolbar picks carry NO instruction** (no mini-composer in the first landing): bare noteType → `openManualEditor(id)`; operation → `operation.run`. The `/type + instruction` AI-generate path stays chat-only (deferred).

## Surfaces
PRIMARY: SelectionFloatingToolbar → SelectionToolbar.tsx button row. SECONDARY: the Anchor Action Bar (anchorViews.tsx:136 `.anchor-action-bar`). DEFER: SourceActionsToolbar (source scope, no anchor) + BottomBar (not docked in any preset, BottomBar.tsx:5).

## Reuse vs new
Reused unchanged: engine.ts, adapters.ts (`slashEntries`), operationAdapter.ts (`operationRunPayload`), SlashPalette.tsx + `slashPaletteKeyDown`, `focus.materializeAnchor`, all 3 dispatch commands, selectionActions/anchorBarActions.
NEW: `src/client/slash/dispatchSlashEntry.ts` (shared pick→dispatch decision extracted from views.tsx:522-539) + `src/client/slash/ToolbarSlashButton.tsx` (the `/` button + keydown-driven popover palette, owns open/query/index state, reads `useWorkspace()` deps, calls dispatchSlashEntry) + a `.toolbar-slash-popover` positioner in styles.css.
MODIFIED: SelectionToolbar.tsx (mount 1), anchorViews.tsx (mount 2), views.tsx (`pickSlashEntry` delegates to the shared helper — refactor, no behavior change).

## Commit sequence (each compiles + tested)
1. **Extract the shared decision.** NEW `dispatchSlashEntry.ts` (+test): `dispatchSlashEntry(entry, instruction, {dispatch, openManualEditor})` — operation→`operationRunPayload`→dispatch; bare noteType→`openManualEditor(id)`; noteType+instruction→`note.generate-block` (exact `以「${title}」(${id}) 的形式：${instruction}` string, LOCK it). MODIFIED views.tsx `pickSlashEntry` delegates. Test: all 3 branches + the exact generate-block string + operation payload.
2. **ToolbarSlashButton component + CSS.** NEW `ToolbarSlashButton.tsx` (+test) + `.toolbar-slash-popover` (reuse `.slash-palette` interior; new positioner like `.chat-slash-palette`). `/` button + keydown-driven popover `<SlashPalette>`; resolves via `resolveSlashEntries(query, slashEntries({operations, disabled, foregroundKitIds}))` from context; on pick → dispatchSlashEntry; onMouseDown preventDefault (button+popover+rows); Escape stopPropagation + outside-click close. Not mounted yet → no behavior change. Test (RTL): button→popover→rows; keydown filter/nav; pick calls stubbed dispatch; mousedown default-prevented (selection guard asserted).
3. **Mount on the selection floating toolbar.** MODIFIED SelectionToolbar.tsx (render `<ToolbarSlashButton surface="selection"/>` in the row). Test (RTL): with a `focus.draft` fixture the `/` button shows; pick dispatches with the draft present.
4. **Mount on the Anchor Action Bar.** MODIFIED anchorViews.tsx (`.anchor-action-bar`, gated on focus.anchor||focus.draft). Test (RTL): with a focused saved anchor the `/` button shows; pick dispatches bound to that anchor (materialize short-circuits to the existing anchor).
5. **e2e `e2e/slash-toolbar.spec.ts`** — select reader text → floating toolbar appears → click `/` → palette lists types → bare `/摘抄` → floating editor seeded via createDefault on a NEW anchor at the passage (mirror slash-composer.md:82). (Note: the deterministic mock is fine; this exercises manual/create paths, not AI text.)

## A4b sequencing + collision
Only shared file = `views.tsx`: SC-2 edits `pickSlashEntry` (:522-539); A4b edits `.chat-panel-actions` (:547) + `.chat-log` (:649) — disjoint regions, auto-mergeable. SC-2 does NOT touch WorkspaceContext.tsx / entityClient.ts / registry.ts / src/ai (all A4b or W3 territory). Build on the A4b-landed tree + rebase the one small views.tsx delegate.

## Test plan (mandatory): dispatchSlashEntry (3 branches + exact string) · ToolbarSlashButton (render/filter/keyboard/mousedown-guard) · selection-toolbar + anchor-bar mounts (pick dispatches with focus present) · e2e slash-toolbar (select→/→pick→note/draft on the new anchor). Command-level materialize is already covered by registry.test.ts.

## Deferred: SourceActionsToolbar + BottomBar mounts; instruction-text from a toolbar (AI generate stays chat-only); memory-recency ranking (SC-3-deferred); webview cross-realm selections (no floating toolbar there — SelectionFloatingToolbar.tsx:20).

## Gates: tsc 0 · full vitest green · build · new e2e green. Commit SC-2.N own sequence, don't push, don't touch docs (report TEXT blocks).
