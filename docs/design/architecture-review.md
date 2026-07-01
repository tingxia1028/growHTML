# Foundation Review — what's clean, what will block upper-layer work

An honest assessment of the codebase's foundational abstractions, grounded in the tree (line counts / field counts / grep are real measurements, 2026-07). Companion to `roadmap.md`, which now sequences the foundation refactors this doc identifies.

**Verdict in one line:** the *extension seams* (registries, content-as-data, entity stores, the render contract) are genuinely clean — adding types/views/commands/entities is near-zero core churn; the *state layer* and *reader-composition layer* are big-balls-of-coupling that will increasingly block deep features (multi-doc, cross-doc notes, concept graph, mobile) and are already causing merge contention across parallel sessions.

---

## Clean half — leave it alone, keep extending through it
| Seam | Evidence | Why it's good |
|---|---|---|
| **Content-as-data** | `note.content: z.unknown()` validated per `contentType` by a `NoteContentSpec` | A new note type = register a spec + renderer, **zero core change**. The 11 subject types land through this. |
| **Registry pattern** | 14 `register*` fns (NoteType, View, Viewer, Command, Contribution, Inspector, SourceViewer, Theme, KitPrompt, KitLanguage, KitLayerPolicy, AnnotationRenderer, Plugin) | Extension = registration, not core edits. The single best structural decision. |
| **Uniform entity store** | `createEntityStores` + `createSnapshotStore` + one zod schema per entity (9 entities in one table) | Adding an entity = one line + a schema. `pack` was added this way. |
| **Render contract** | one `getNoteType(contentType).render({mode})` seam, enforced by `contract.guard.test.ts` | Prevents the classic "N bespoke render paths" rot. |
| **crypto / identity leaves** | pure, injectable, server-only, 83 tests | Textbook clean-leaf design. |
| **Route extraction is possible** | `registerSvpackRoutes(app, deps)` | Proves the monolith (below) can be decomposed incrementally. |

## Coupled half — the real blockers, ranked

### F1 — WorkspaceContext is a god object · **#1 risk**
`WorkspaceContext.tsx` = **1753 lines, ~79 value fields, 46 activeSource references.** Every client feature threads through one context + one provider.
- **Single `activeSourceId`** ⇒ multi-doc is a deep refactor (`multidoc-and-concepts.md` Part A is entirely this).
- Every feature adds fields ⇒ any consumer re-renders on any change; every feature edits this one file ⇒ the merge contention you already see across parallel sessions.
- Hard to unit-test in isolation.
- **Fix:** decompose into focused stores/contexts (documents · notes · selection · layers · chat) with selector subscriptions. `useWorkspaceOptional` was a band-aid; the real fix is splitting. **Unavoidable for multi-pane anyway → do it as the multi-doc enabler, not after.**

### F2 — app.ts is a 1737-line monolith (59 inline routes)
Every server feature edits one giant file (contention again). `registerSvpackRoutes` already shows the extraction pattern; the core 59 routes just haven't adopted it.
- **Fix:** split routes into feature modules (`registerXRoutes(app, deps)`), incrementally, low risk. Not blocking, but friction grows linearly with features.

### F3 — the reader layer is not abstracted (the D1 gap)
Pdf/Image/LocalHtml/Webview/Dom readers each re-implement paint / markers / note-card; the webview guest diverges (inline chips in `webview-preload.ts`). Adding a reader or changing paint = touch N files.
- **Fix:** the `ReaderAnnotationAdapter` contract in `note-presentation-unified.md` (D1). Do it before more reader features; it also unblocks multi-realm consistency and mobile.

### F4 — single-active-kit gate fights the marketplace
`src/kits/activation.ts` gates *creation* by `metadata.activeKitIds`, defaulting to ONE kit (`FALLBACK_DEFAULT_KIT = "textbook-learning"`). The marketplace's "many plugins installed, foreground-not-filter" model can't work until the composer/toolbar source their type list from marketplace **effective-installed** instead of `activeKitIds`.
- **Fix:** land in marketplace M1 (the effective-installed selector).

### F5 — plugin granularity not realized in registration
The model is right (plugin = smallest unit) but `clientContext.tsx` registers one `PluginRecord` per kit, and `seedCorePlugin()` files flashcard/quiz/bookmark/diagrams under a synthetic `"core"` record. Marketplace `members[]` can't resolve until split. **Mechanical debt, not a design flaw.**
- **Fix:** split textbook into real plugins + give each `registerNoteType` a `pluginId`; fold into M1.

### F6 — anchor schema asymmetry
`html_selection` / `web_text_quote` anchors carry no rect; only `pdf_selection` / `image_region` are region-capable. Unified region selection (D4) can't cover HTML until the schema gains an optional rect.
- **Fix:** additive rect on the html/web anchor kinds; sequence with D4b.

### Minor / flagged elsewhere
- Per-note (not per-anchor) layer visibility — a cross-doc note paints in a pane iff its `layerIds` intersect that pane's enabled set (per-pane Layer Lens is new). → multidoc P-A2.
- `noteCardMeta` lacks title fallbacks for vocab/grammar/excerpt/argument. → subject M-B.
- KaTeX not a dependency yet (the one new UI dep for formula types). → subject M-B decision.
- Dock has no `tabs` node type (`DockNode = split | leaf`); reader tab is hardcoded chrome (split already works). → multidoc P-A1.

---

## What this means for building
- **Adding "another type / view / command / entity" stays cheap** — the clean half carries it.
- **Anything touching multi-document STATE or reader PAINT will hurt** until F1 and F3 are addressed — and those are exactly where multidoc and note-presentation already point. So the foundation work isn't a detour; it's the same work those features need, pulled earlier.
- **F4/F5 are unblock-once chores** that gate the whole kit/marketplace/subject line.

Recommended foundation order (now folded into `roadmap.md`): **F1 (with multi-doc) · F4+F5 (with market M1) · F3 (before more reader work) · F2 (incremental) · F6 (with D4b).**
