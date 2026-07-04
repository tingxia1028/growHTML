# F-1 follow-up — per-realm scoping of annotation-visibility singletons — BUILD SPEC

Status: Plan agent produced this, reviewed for bounds. F-1 was logged as a SHOULD-FIX during the
F1 (multi-doc) impl review: two iframe panes in an F1 split share the module-global "hide-all
notes" + anchor-glyph-visibility state. Cosmetic cross-pane leak (view-state only, NOT data loss);
the DELTA-3 gate already blocks the only unshippable case (two host-realm panes). **Build AFTER W2
lands** (the one hard seam collides with W2's `views.tsx`). Build BEFORE N2 (N2 also edits
annotationLayer.ts — F-1 cleans it first). Scope = ONLY the visibility singletons; NOT a layer
rewrite, NOT re-enabling the host-realm gate.

## Decisive finding
The scoping key ALREADY EXISTS: the realm `Document`. The buggy singletons are bare module `let`s,
but sibling state in the SAME file is already `WeakMap<Document,…>` (annotationLayer.ts:494 `hiddenNoteAnchorsByDoc`,
:498 noteCardControllers, :505 lastMarginItems, :477 wiredDocs). Copy that idiom.

## Singleton inventory — the ONLY 4 that are module-global + view-affecting + not-yet-keyed
- **annotationLayer.ts A**: `notesHiddenAll` (:528) + **B** `notesHiddenListeners` (:529).
  Writers: `setAllNotesHidden` (:535) ← HideAllNotesToggle seeding (HideAllNotesToggle.tsx:35) + toggle (:42); webview guest webview-preload.ts:189.
  Readers: isAllNotesHidden (:531) via restorePinnedNoteCards (:576), wireNoteCard openPinned (:725), subscribe cb (:740), notesHidden() (:749), paintMarginNotes (:1086); markerOverlay.layout() (:377); webviewSelection.ts:146.
- **markerOverlay.ts H**: `anchorGlyphsVisible` (:95) + **I** `anchorGlyphListeners` (:96).
  Writers: setAnchorGlyphVisibility (:103) ← AnchorGlyphSwitch (anchorViews.tsx:48); guest webview-preload.ts:186; lazy seed readStoredAnchorGlyphVisibility (:99).
  Readers: getAnchorGlyphVisibility (:98) via layout() (:373); webviewSelection.ts:145.

Everything else (C–G in annotationLayer, per-element highlightPayloads) is ALREADY per-realm or realm-implicit. ExportNotesButton + AnchorFocusBoard touch NONE of these.

## Approach: per-realm, keyed by `Document` (NOT per-paneId)
Convert A→`WeakMap<Document,boolean>`, B→`WeakMap<Document,Set<()=>void>>`; same for H/I. Getters/setters/subscribe gain a `doc: Document` param. Rationale: zero WorkspaceContext/paneId plumbing (per-paneId would touch WorkspaceContext.tsx = W2's file); every internal read/write site already holds `doc`; single-pane byte-identical by construction; webview guest keeps its own module map keyed by its own `document`.

## Commit sequence (each compiles + tests)
1. **annotationLayer.ts hide-all per-realm (A/B).** Replace the two module `let`s with WeakMaps; signatures `isAllNotesHidden(doc)`, `setAllNotesHidden(doc,hidden)`, `subscribeAllNotesHidden(doc,listener)`. Thread `doc` at internal callers already holding it (:576,:725,:739,:740,:749,:1086). Test in annotationDom.test.ts (freshReaderDocument() at :33 already makes a 2nd iframe realm): set hide-all on docA → isAllNotesHidden(docB)===false, B still paints; existing D11 single-realm tests (:366-421) preserved with the doc arg.
2. **markerOverlay.ts glyph-visibility per-realm (H/I).** Same WeakMap conversion; `getAnchorGlyphVisibility(doc)`/`setAnchorGlyphVisibility(doc,visible)`/`subscribeAnchorGlyphVisibility(doc,listener)`; lazy-seed per doc. Update constructor sub (:223), :225, layout() (:373). Test: two hostEls in two iframe docs → setAnchorGlyphVisibility(docA,false) hides A only; existing single-realm assertions preserved.
3. **Host controls + guest + webview-push consumers.** webview-preload.ts (:186,:189) pass guest `document` (must land same commit — compiles against new sigs). webviewSelection.ts (:145-146) host-push has NO realm doc → read from the persisted per-source store (readStoredNotesHidden(sourceId)/readStoredAnchorGlyphVisibility) OR the webview reader's guest doc handle. **THE HARD SEAM:** HideAllNotesToggle.tsx + AnchorGlyphSwitch (anchorViews.tsx) render in the HOST column and need the FOCUSED pane's realm `Document` (iframe contentDocument, owned by DomReader). Route this handle via `SourceTabs.tsx` / the reader components — **NOT via views.tsx SourceViewerView** (that collides with W2). Update anchorViews.test.tsx, webviewSelection.test.ts for the doc arg.
4. **Regression lock + e2e.** Single-pane byte-identical (adapted existing tests). e2e/multi-doc.spec.ts: two iframe panes A/B; hide-all in A → A cards/chips gone, B still painted; glyph off in A → A glyphs gone, B stay.

## DELTA-3 (host-realm split gate) — this fix is a STEP, NOT sufficient
Gate blocks two PDF/image panes because host-realm bodies share THREE things: (1) the module singletons — THIS fixes them; (2) the ONE `#sv-note-card` host element (annotationLayer.ts:603, appended to host document.body) — NOT fixed; (3) HideAllNotesToggle per-source seeding — collateral of (1), fixed. Two host-realm panes share ONE realm, so per-realm keying COLLAPSES to the same key → does not separate them. Re-enabling the gate needs host-card-per-pane (or a per-paneId key for the host realm specifically) — SEPARATE effort, out of scope here.

## Collision vs W2 (ai/**, registry.ts, WorkspaceContext.tsx, views.tsx, sources.ts, app.ts, chat/**, entityClient.ts)
Layer edits (commits 1-2) + HideAllNotesToggle/anchorViews/webviewSelection/webview-preload + tests = DISJOINT from W2. ONLY risk: the commit-3 host-control→realm-doc bridge, if landed in views.tsx SourceViewerView, collides. Mitigation: route via SourceTabs/readers, not views.tsx. (per-paneId alt would touch WorkspaceContext.tsx = direct collision — another reason for per-realm.) → **build after W2 lands.**

## Test plan (MANDATORY): annotationDom.test.ts (two-realm hide-all independence + single-realm preserved) · markerOverlay.test.ts (two-realm glyph independence) · anchorViews.test.tsx + webviewSelection.test.ts (doc-arg) · e2e/multi-doc.spec.ts (two iframe panes, hide-all/glyph isolation).
