# F1 ≡ P-A1 + P-A2 — Multi-Document Side-by-Side — BUILD SPEC (approved-with-changes)

Status: plan produced by a Plan agent, adversarially reviewed → **APPROVE-WITH-CHANGES**. This
doc folds the 5 required deltas into the plan. It is the authoritative input for the F1 build.
Build ONLY after the M-C/N6/N3 wave lands (F1 touches WorkspaceContext.tsx + views.tsx, which N3/N6
edit). Scope = P-A1 (per-pane source binding) + P-A2 (per-pane paint). DEFER P-B/P-C and the `tabs`
DockNode primitive.

## Verified ground truth (current line numbers — reviewer-corrected)
- `activeSourceId` = single `useState("")` at **WorkspaceContext.tsx:596** (plan's :568/:501 were stale).
- Load effect on `[activeSourceId]` at **L1060-1065**.
- Per-source memos: visibleAnchors 694 · enabledLayerIds 702 · visibleNotes 711 · notesByAnchorId 725 ·
  bookmarkOnlyAnchorIds 742 · paintAnchors 760 · revealAnchors 786 · activePatches 810. ALL derive purely
  from top-level `anchors/notes/sourceLayers/patches` + `focus/selectedAnchorId` → mirroring the focused
  pane's SourceBundle into those top-level states drives all 8 unchanged, none double-fire. VERIFIED.
- `SourceViewerView` at **views.tsx:270** reads SEVEN ctx globals (activeSource, anchors, paintAnchors,
  revealAnchors, renderedHtml, annotationMode, activeKitIds) + header controls (HideAllNotesToggle
  sourceId=, ExportNotesButton, kit select, onMarkerAction closing over ctx.anchors). Per-pane binding =
  the WHOLE header + all reads resolve per-pane, NOT one line. `presets.ts:23,103` source.viewer leaves
  carry NO params today → presets must start stamping `params.sourceId`; fallback `node.params.sourceId ?? activeSourceId`.
- `DomReader.paint` (DomReader.tsx:223/243/305) driven ENTIRELY by the `anchors` prop → **per-pane paint
  needs zero reader/adapter change** (P-A2 = feed each pane its own list). VERIFIED.
- Dock = `DockNode = split | leaf` only (dock.ts:19-21); `split("row",[…])` already works → **split needs
  nothing new**. Tabs must be ADDED as a `source.tabs` host VIEW (mirror rightSplit.ts / RightSidebarTabs),
  NOT a new DockNode variant (avoids the layout-engine blast radius). VERIFIED.
- N5 card geometry keyed by anchor id in each realm's OWN iframe localStorage → two panes = two realms =
  independent, no key collision. P-A2 works with N5 unchanged. VERIFIED.

## New state shape (WorkspaceContext.tsx)
```
type PaneViewState = { scrollTop?: number; page?: number; zoom?: number };   // NOTE: no per-pane enabledLayerIds in V1 (delta 2)
type OpenPane = { paneId: string; sourceId: string; viewState: PaneViewState };
type SourceBundle = { renderedHtml; anchors; notes; patches; sourceLayers };
const [openPanes,setOpenPanes] = useState<OpenPane[]>([]);
const [focusedPaneId,setFocusedPaneId] = useState<string>("");
const [sourceBundles,setSourceBundles] = useState<Map<string,SourceBundle>>(new Map());
const focusedPane = openPanes.find(p=>p.paneId===focusedPaneId) ?? openPanes[0] ?? null;
const activeSourceId = focusedPane?.sourceId ?? "";               // was useState → now DERIVED (the shim)
```
`setActiveSourceId(id)` → `openOrFocusPane(id)`; `id===""` → close focused pane (VERIFIED: only 2 "" call
sites — views.tsx:303 tab-close, WorkspaceContext.tsx:1039 deleteSourceItem — both mean "no doc").
paneId = `"pane:"+sourceId` (V1 single-instance-per-source, dedups + stable).

## Commit sequence (each compiles + tests; single-pane byte-unchanged via regression lock)
1. **Pane state + activeSourceId shim (no-op)** — new pure `panes.ts` (openOrFocusPane/closePane/focusPane/
   paneIdFor/sourceOfPane) + `panes.test.ts`. Flip activeSourceId to derived.
   **DELTA 1 (MUST):** `WorkspaceContext.tsx:870` `setActiveSourceId((current)=>current||sources[0]?.id||"")`
   is the first-load default-source auto-open (NOT ingest). Rewrite as explicit: on first loadSources, if
   `openPanes` empty → `openOrFocusPane(sources[0].id)`. TS will otherwise reject the functional updater.
   Test: shim identity — single pane ⇒ activeSourceId == old single value.
2. **SourceBundle cache + focused-bundle mirror** — new pure `sourceBundles.ts` + test. loadSourceWorkspace
   writes bundle keyed by sourceId AND top-level state; refreshAnnotations takes explicit sourceId (default
   activeSourceId); load effect mirrors cached bundle without refetch. Add a NEW effect over `openPanes` to
   load each pane's bundle (the focused effect only loads the focused one).
3. **`source.tabs` host view + tab strip** — new `SourceTabs.tsx` + test; register `source.tabs`; presets.ts
   center leaf → `source.tabs`; extract reader tab strip so SourceTabs renders the strip + the active pane's
   body. Old `source.viewer` view stays working. Test: N tabs, focus/close routing, single-pane DOM ==
   old `.reader-tab` chrome (guards e2e selectors).
4. **Bind each reader pane to ITS source (P-A2 core)** — extract the paint pipeline (760-786) into pure
   `buildPaintAnchors(bundle, enabledSet)` in new `paneSelectors.ts` + test; focused memos call it with the
   focused bundle (byte-identical — regression lock). SourceViewerView takes `node.params.sourceId`, resolves
   its bundle, computes its own paintAnchors/revealAnchors/renderedHtml, feeds readerForSource. onSelect calls
   focusPane(paneId) first. Expose notesForSource(sourceId)/paintAnchorsForPane(pane).
   **DELTA 2 (MUST):** NO per-pane Layer Lens in V1 — layerViews/LayerLensManage/AnchorFocusBoard read the
   single global enabledLayerIds and there is no per-pane layer UI. Scope layer filtering to the FOCUSED pane
   only. Rewrite the P-A2 e2e: drop "toggle a pane's layer hides it there only"; keep the unit test
   (notesForSource(A)/(B) cross-source paint) + the two-panes-different-docs e2e.
5. **Split-to-side + focus-follows-pane toolbar** — SourceTabs gets a 分屏 button + local split state (two
   groups + ratio, mirroring rightSplit.ts — dock engine untouched). Focus routing: any pane click →
   focusPane → setFocusedPaneId; toolbar (fork/hide-all/export/kit) + commandContext.sourceId follow via the
   shim. **The WHOLE SourceViewerView header must resolve per focused pane** (not one line — see ground truth).
   **DELTA 3 (MUST — HARD GATE):** PDF/image sources may open in only ONE host-realm pane at a time in V1;
   split is iframe/webview-snapshot-backed ONLY. Reason: PdfReader.tsx:120 / ImageReader.tsx:67 paint in the
   HOST document; two host-realm panes share the ONE `#sv-note-card` + module-level `notesHiddenAll`
   (annotationLayer.ts:528) + `AnchorGlyphSwitch/setAnchorGlyphVisibility` singleton. HideAllNotesToggle's
   per-source seeding effect is the concrete collision trigger. Enforce the gate (a source of a host-realm
   type refuses a second concurrent pane, or opens replacing) + an e2e asserting the gate. A per-paneId
   scoping of those host singletons is the proper fix but it's a refactor of annotationLayer.ts/markerOverlay.ts
   → DEFER (those files are hot).
6. **Persistence + prune** — persist openPanes/focusedPaneId/split (localStorage, mirror RECENT_SOURCE_IDS_KEY).
   **DELTA 4 (MUST):** actually WIRE pane-prune: deleteSourceItem + any source removal drops every OpenPane
   whose sourceId is gone, collapsing emptied leaves/tab-groups (not just §A.4 mention). Test prunePanes.

## Delta 5 (MUST state, scope-honesty) — single global focus consequence
`focus`/`revealSeq` stay ONE global. So every jump/reveal consumer (GlobalSearch pendingReveal gated on
activeSourceId===pending.sourceId, bookmarks, NoteListPanel, anchorViews, note.link-anchor) can only reveal
in the pane whose DOM holds the `data-sv-key` — cross-pane reveal into a non-focused pane is uniformly
DEFERRED to P-B. Also: `rememberSourceId` effect (L1068) now fires on every focus flip (over-records recents)
— accept or debounce. State this ONCE in the impl-log.

## Test plan (MANDATORY — no land without)
Unit: panes.test.ts (open/focus/close/dedup/prune + shim identity) · sourceBundles.test.ts (cache round-trip,
no-refetch on refocus) · paneSelectors.test.ts (buildPaintAnchors(focusedBundle)==old paintAnchors REGRESSION
LOCK; cross-source shared-note paints in notesForSource(A)&&(B); focused-pane layer filter) · sourceTabs.test.tsx
(tab render/focus/close; single-pane DOM == old .reader-tab; focus-follows-pane for commandContext.sourceId).
E2E (e2e/multi-doc.spec.ts): (a) single-pane unchanged; (b) two iframe panes, different docs, independent
scroll+paint (A's highlights ABSENT in B's iframe); (c) focus-follows-pane (select in B → add-note/toolbar
target B, then flip back to A); (d) host-realm gate: a PDF refuses/replaces a second concurrent pane. Reuse
e2e/multi-anchor.spec.ts seeding for the shared cross-source note demo.

## Out of scope (deferred, state once)
P-B (cross-doc note authoring, note.link-anchor across panes, grouped-by-source card, drag-from-anchor-bar),
all P-C, the `tabs` DockNode primitive, per-pane independent focus/selection stores, multiple panes of the
same source, per-pane Layer Lens UI, cross-pane reveal, host-realm readers in a split.
