# Implementation Roadmap — synthesis of the design docs

One dependency-ordered plan over the six design docs written this cycle. Purpose: decide what to build next, see what is independently shippable, and avoid the concurrency landmines. Each design doc is authoritative for its own detail; this file only sequences them.

## The design docs (all committed)
| Doc | Scope | Impl phases |
|---|---|---|
| `studypack-sharing.md` | Offline `.svpack` protected sharing v2 | A✅ · B✅ · C · D |
| `plugin-viewer-model.md` §8 | Plugin/Kit **marketplace** | M1 · M2 · M3 |
| `note-presentation-unified.md` | In-reader note surface D1–D9 | N1 · N2 · N3 · N4 |
| `subject-kits.md` | 11 subject types × 5 kits + auto-switch | M-A · M-B · M-C |
| `multidoc-and-concepts.md` | Multi-pane docs + cross-doc notes + concept graph | P-A1 · P-A2 · P-B · P-C1 · P-C2 |
| `architecture-review.md` | Foundation assessment | F1–F6 (refactors, below) |
| (this) `roadmap.md` | Sequencing | — |

## Foundation refactors (from `architecture-review.md`) — do these *with* the feature that needs them, not after
The extension seams (registries / content-as-data / entity stores / render contract) are clean; the coupled spots below block deep features and cause cross-session merge contention. Each is pulled to sit **immediately before or fused with** its first dependent feature:
| # | Foundation refactor | Blocks until fixed | Fuse with |
|---|---|---|---|
| **F1** | Decompose the `WorkspaceContext` god object (1753 lines / ~79 fields / single `activeSourceId`) into per-domain stores + selectors | multi-doc, cross-doc paint, re-render/contention on every feature | **P-A1** (it *is* the multi-doc enabler) |
| **F2** | Extract `app.ts` (1737 lines / 59 inline routes) into `registerXRoutes` modules (svpack already shows the pattern) | nothing hard-blocked; friction + contention grow | incremental, any server work |
| **F3** | Land the D1 `ReaderAnnotationAdapter` — kill per-reader paint duplication + the divergent webview guest | reader-consistency, mobile, N1/P-A2 | **before N1** (it's the N1/P-A2 keystone) |
| **F4** | Replace the single-active-kit gate (`activation.ts` `FALLBACK_DEFAULT_KIT`) with marketplace **effective-installed** | market, subject kits "foreground not filter" | **Market M1** |
| **F5** | Split `plugin==kit` 1:1 + fix `seedCorePlugin` over-claim (real `pluginId` per type) | marketplace `members[]` resolution | **Market M1** |
| **F6** | Additive rect on `html_selection`/`web_text_quote` anchors | unified region selection over HTML (D4) | **D4b** |
| **F7** | Preset stage layers (预习/学习/复习/拓展) are hardcoded in core + imposed on every vault → make them **kit-contributed + user-editable** | forces one kit's taxonomy on all users; not customizable | **F4/F5 / Market M1**; F7a (core+kit) parallelizable now, F7b (Lens UI) after |

## Two keystones everything leans on
Most work funnels through two load-bearing pieces. Build order is mostly "who unblocks whom":

1. **D1 — the ReaderAnnotationAdapter** (`note-presentation-unified.md`). One paint/marker/card contract per reader. Unblocks **D2 markers (N1)** AND **per-pane paint (P-A2)**. It lives in the reader/marker files a **concurrent session currently owns** → coordinate before touching.
2. **Market M1 — effective-installed selector** (`plugin-viewer-model.md` §8.3/§8.5). The composer/toolbar must source its type list from marketplace *effective-installed*, not the single-active-kit gate in `src/kits/activation.ts`. Unblocks **subject-kit "foreground not filter" (M-B)** and **N4 types-as-catalog**.

## Dependency graph
```
D1 adapter ─┬─────────────> N1 (D2 markers + D5 floating editor)
            └─────────────> P-A2 (per-pane paint)
                              ▲
P-A1 (single→multi activeSource, + tabs DockNode) ──┴──> P-B (cross-doc note authoring)

Market M1 (effective-installed) ─┬──> Subject M-B (exemplar types + kits, foreground)
                                 └──> N4 (subject types as catalog entries)
Subject M-A (auto-switch engine, PURE) ── independent, can land anytime

svpack  A✅ ──> B🔧(tests) ──> C (import/export UI + zwsp watermark) ──> D (full e2e)
        └─ independent track: only sharing UI, no reader/context coupling

Concept P-C1 (aggregation page, additive to existing API) ──> P-C2 (graph view)
```

## Independent tracks (can run in parallel, low collision)
- **svpack C/D** — sharing UI + watermark + e2e. Touches only sharing surfaces; server done. Does not need D1 or M1.
- **Market M1** — new market UI + `plugin-prefs` state + the effective-installed selector. Mostly new files; folds in the "debts to clear" below.
- **Subject M-A** — the pure `detectSubject.ts` scorer + the topbar chip. No dep on types or M1 (foregrounding just reorders once M1 lands; the engine + chip stand alone).
- **Concept P-C1** — extends the passage-blind `GET /api/concepts/:id` + `ConceptInspector`. Additive.

## Debts to clear (each doc surfaced these; fold into the phase that touches them)
- **`activation.ts` single-active-kit gate** defaults to one kit (`textbook-learning`) and gates *creation* → "other types stay available" is false until the composer sources from effective-installed. **→ M1.**
- **plugin==kit 1:1** — `clientContext.tsx` registers one PluginRecord per kit; split textbook into real plugins so kit `members[]` resolve. **→ M1.**
- **`seedCorePlugin()` over-claims** — flashcard/quiz/bookmark/diagrams filed under synthetic `"core"`; each needs its own `pluginId`. **→ M1.**
- **bookmark reclassification** out of `builtinNoteContentSpecs` (metadata-first, re-export the constant). **→ M1 (metadata) / gradual.**
- **`ComposerTypePicker` not mounted** in any live composer; no single site builds the type-options list. **→ M1/N-work.**
- **`noteCardMeta` no title fallback** for vocab/grammar/excerpt/argument. **→ M-B.**
- **KaTeX not in `package.json`** — the one new UI dep, for formula/derivation/theorem. **→ M-B decision gate.**
- **Dock has no `tabs` node** (`DockNode = split|leaf`); reader tab is hardcoded chrome. Split already works. **→ P-A1.**
- **per-note (not per-anchor) layer visibility** — a cross-doc note paints in a pane iff its `layerIds` intersect that pane's enabled set; per-pane Layer Lens is new. **→ P-A2.**
- **cross-doc notes are a follow-up, not greenfield** — `note.link-anchor` shipped multi-anchor paint and deferred exactly "cross-source"; P-B finishes it. Blocked only by single active source (P-A1).

## Concurrency coordination (a live session owns reader/marker)
`annotationLayer.ts`, `markerOverlay.ts`, `*Reader.tsx`, `webview-preload.ts`, `DomReader.tsx` have in-flight edits from another session. **N1 (D2), P-A2, and all of P-A/B touch this area.** Rule: land the sharing + market + engine tracks (which avoid it) first; sequence the reader-surface work (N1, multidoc paint) after that session's changes settle, or explicitly co-design D1 with it. Everything committed so far by this line of work has stayed out of those files.

## Recommended sequence (foundation refactors F1–F6 fused in, **bold**)
**Now (parallel, no reader-file collision):**
1. **svpack B✅ → C → D** — server done; C = export/import dialogs + roster + zwsp watermark; D = the two-vault e2e. A whole user-facing capability on its own; touches no contended files. *(Carries **F2** opportunistically — new sharing routes already live in their own `svpack.ts` module.)*
2. **Market M1 + F4 + F5** — two-tab market + install state, **F4** (effective-installed replaces the single-active-kit gate) and **F5** (split plugin==kit, fix `seedCorePlugin`) are *part of* M1, not follow-ups. Unblocks all subject/kit work.
3. **Subject M-A** — auto-switch engine + chip (pure, standalone).

**Next (after M1):**
4. **Subject M-B** — vocab + formula + timeline exemplars (KaTeX decision); **Market M2** (previews + user kits).
5. **N3 (D6)** — AI anchor-context results auto-materialize as draft notes (undo toast).

**The presentation + multi-doc lift — foundation-first, coordinate with the reader session:**
6. **F3 (D1 ReaderAnnotationAdapter) → N1 (D2 markers + D5 editor) → N2 (D4 selection + D3 styles).** F3 is not optional prep — it's the keystone N1/P-A2 both stand on; build the adapter before the marker/editor UX. (**F6** — anchor rect — rides D4b inside N2.)
7. **F1 (decompose WorkspaceContext) ≡ P-A1 → P-A2 (per-pane paint) → P-B (cross-doc authoring).** F1 and P-A1 are the SAME work: the single→multi `activeSourceId` split *is* the god-object decomposition. Do them as one. Smallest demo = open two docs split, a shared note paints in both.
8. **Concept P-C1 → P-C2**, then **M-C / N4** (remaining subject types + import prompts M3), consuming the `.svpack` `contentTypes` summary the sharing server already emits.

**Rationale:** the foundation refactors are not a detour — F1 *is* multi-doc's enabler, F3 *is* the presentation keystone, F4/F5 *are* what makes the marketplace real. Each is fused with its first dependent feature so you pay the refactor exactly when the feature needs it, never speculatively. The independent tracks (sharing, market, auto-switch engine) go first because they're safely buildable now and de-risk the contracts the deeper work leans on; F2 is incremental and rides along.
