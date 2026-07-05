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
`WorkspaceContext.tsx` = **2680 lines, 128-field `WorkspaceContextValue`, 67 activeSource references** (re-measured 2026-07-05; grew ~50% since the original 1753/79/46). Every client feature threads through one context + one provider. The domain-split plan is in `platform-layering.md` (Part 2).
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

### F4 — single-active-kit gate fights the marketplace — ✅ SHIPPED (with M1)
_Resolved: `activation.ts:7-9` now states "active = FOREGROUND ORDERING, never a filter"; availability comes from `isPluginEffectiveInstalled` (`installState.ts:427-430`) over the installed-set ∪ enabled-capability-groups, consumed by all 3 authoring seams (slash/toolbars/surfaces); `activeKitIds` is an array passed only as `foregroundKitIds`. Verified 2026-07-05._
~~`src/kits/activation.ts` gates *creation* by `metadata.activeKitIds`, defaulting to ONE kit (`FALLBACK_DEFAULT_KIT = "textbook-learning"`). The marketplace's "many plugins installed, foreground-not-filter" model can't work until the composer/toolbar source their type list from marketplace **effective-installed** instead of `activeKitIds`.~~
- **Fix:** ~~land in marketplace M1 (the effective-installed selector).~~ DONE.

### F5 — plugin granularity not realized in registration — ✅ SHIPPED (with M1)
_Resolved: `KitMemberPlugin` + `ProductKit.members[]` (`types.ts:116-149`); `installClientKits` registers one `PluginRecord` per member (`clientContext.tsx:216-242`); `seedBuiltinKits` gives each builtin its own record. LOCKED by `catalogAgreement.test.tsx:30-60` ("plugin==kit 1:1 is dead"). Verified 2026-07-05._
~~The model is right (plugin = smallest unit) but `clientContext.tsx` registers one `PluginRecord` per kit, and `seedCorePlugin()` files flashcard/quiz/bookmark/diagrams under a synthetic `"core"` record. Marketplace `members[]` can't resolve until split. **Mechanical debt, not a design flaw.**~~
- **Fix:** ~~split textbook into real plugins + give each `registerNoteType` a `pluginId`; fold into M1.~~ DONE.

### F6 — anchor schema asymmetry
`html_selection` / `web_text_quote` anchors carry no rect; only `pdf_selection` / `image_region` are region-capable. Unified region selection (D4) can't cover HTML until the schema gains an optional rect.
- **Fix:** additive rect on the html/web anchor kinds; sequence with D4b.

### F7 — the 4 preset stage layers are a kit opinion hardcoded in core, imposed on every vault
`PRESET_STAGES` in `src/core/study-layer/layers.ts` seeds **预习 / 学习 / 复习 / 拓展** on *every* source in *every* vault, lazily on layer-list (`app.ts` ~L909), **regardless of the active kit** and with no way for the user to change them. A K12-study taxonomy is baked into the core layer engine — same family as F4/F5 (a kit's worldview leaked into core). Core should own only the layer *primitive* (owned / custom / shared + `parentId` + `role`), no built-in stage axis.
- **Fix (F7a, core decouple):** stop core from hardcoding/creating the stages unconditionally; the stage axis becomes a **kit-contributed suggested preset** (textbook → 预习/学习/复习/拓展; 英语Kit → 词汇/语法/听力; a kit may offer none), seeded from the active kit. Preserve existing preset layers in current vaults (migration-safe).
- **Fix (F7b, user-editable):** Layer Lens can rename / add / remove / reorder the axis, persisted per vault-or-source. The default seeds from the kit but is the user's to change.
- **Fuse with:** F4/F5 (kit contributions) / Market M1. F7a is core+kit+tests (parallelizable now — files no one else is on); F7b is a Layer-Lens UI follow-up.

### Minor / flagged elsewhere
- Per-note (not per-anchor) layer visibility — a cross-doc note paints in a pane iff its `layerIds` intersect that pane's enabled set (per-pane Layer Lens is new). → multidoc P-A2.
- `noteCardMeta` lacks title fallbacks for vocab/grammar/excerpt/argument. → subject M-B.
- KaTeX not a dependency yet (the one new UI dep for formula types). → subject M-B decision.
- Dock has no `tabs` node type (`DockNode = split | leaf`); reader tab is hardcoded chrome (split already works). → multidoc P-A1.
- Note presentation has no persisted/exported open-state — card geometry is localStorage-only (`CardGeom`), open-state is component-local (note-presentation §L328). The user wants pinned-open cards whose position persists AND travels in `.svpack` → additive `note.display` (anchor-relative offset), which rides the export for free. → note-presentation D10 / **N5**.
- Anchor Focus board (D12) columns MUST be data-driven from the F7 stage axis, never hardcoded — the board is a *consumer* of F7, not a second taxonomy owner. → note-presentation **N6**.

---

## What this means for building
- **Adding "another type / view / command / entity" stays cheap** — the clean half carries it.
- **Anything touching multi-document STATE or reader PAINT will hurt** until F1 and F3 are addressed — and those are exactly where multidoc and note-presentation already point. So the foundation work isn't a detour; it's the same work those features need, pulled earlier.
- **F4/F5 are unblock-once chores** that gate the whole kit/marketplace/subject line.

Recommended foundation order (now folded into `roadmap.md`): **F1 (with multi-doc) · F4+F5 (with market M1) · F3 (before more reader work) · F2 (incremental) · F6 (with D4b).**
