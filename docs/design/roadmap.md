# Implementation Roadmap — synthesis of the design docs

One dependency-ordered plan over the six design docs written this cycle. Purpose: decide what to build next, see what is independently shippable, and avoid the concurrency landmines. Each design doc is authoritative for its own detail; this file only sequences them.

## The design docs (all committed)
| Doc | Scope | Impl phases |
|---|---|---|
| `studypack-sharing.md` | Offline `.svpack` protected sharing v2 | A✅ · B🔧 · C · D |
| `plugin-viewer-model.md` §8 | Plugin/Kit **marketplace** | M1 · M2 · M3 |
| `note-presentation-unified.md` | In-reader note surface D1–D9 | N1 · N2 · N3 · N4 |
| `subject-kits.md` | 11 subject types × 5 kits + auto-switch | M-A · M-B · M-C |
| `multidoc-and-concepts.md` | Multi-pane docs + cross-doc notes + concept graph | P-A1 · P-A2 · P-B · P-C1 · P-C2 |
| (this) `roadmap.md` | Sequencing | — |

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

## Recommended sequence
**Now (3 parallel, no reader-file collision):**
1. **Finish svpack B → C → D** — the sharing feature end-to-end (server done; C = export/import dialogs + roster + zwsp watermark; D = the two-vault e2e). Ships a whole user-facing capability on its own.
2. **Market M1** — two-tab market + install state + effective-installed selector, clearing the plugin==kit / seedCorePlugin / bookmark debts. Unblocks subjects.
3. **Subject M-A** — auto-switch engine + chip (pure, standalone).

**Next (after M1):**
4. **Subject M-B** — vocab + formula + timeline exemplars (KaTeX decision) as catalog entries; **Market M2** (previews + user kits).
5. **N3 (D6)** — AI anchor-context results auto-materialize as draft notes (undo toast).

**The presentation + multi-doc lift (coordinate with the reader session):**
6. **D1 adapter → N1 (D2 markers + D5 floating editor) → N2 (D4 selection + D3 styles)** — the biggest UX wins, but in the contended files.
7. **P-A1 (multi activeSource + tabs DockNode) → P-A2 (per-pane paint) → P-B (cross-doc authoring)** — the deep refactor; smallest demo = open two docs split, a shared note paints in both.
8. **Concept P-C1 → P-C2**, then **M-C / N4** (remaining subject types + import prompts M3), which also consume the `.svpack` `contentTypes` summary already emitted by the sharing server.

**Rationale for the ordering:** sharing + market + auto-switch engine are the value that is *safely* buildable now (no reader-file contention, few cross-deps); the presentation and multi-doc refactors are higher value per feature but concentrate in the contended files and the deepest state (single→multi activeSource), so they come once the independent tracks have de-risked the surrounding contracts.
