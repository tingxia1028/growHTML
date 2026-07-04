# Unified Note Presentation & Interaction (表现层) — Design + 复盘

Status: 定稿 v1 (2026-07-02). Design only — no code in this pass.

This doc EXTENDS `docs/design/ui-redesign-growte.md` — §7 (Action Toolbar System), §8 (Layer
Lens), §10 (PreviewCard / CenterView) — and cross-references `docs/design/plugin-viewer-model.md`
§8 (marketplace) without duplicating either. It answers one question end-to-end: **how a note
LOOKS and is TOUCHED at the passage where it lives** — markers, paint, selection, the editor that
creates it, the AI path that materializes it, and the per-type interactive views. Nine locked
decisions D1–D9; each is grounded in the code as it exists on `codex/ai-study-vault-rework`.

Vocabulary: 锚点 = anchor, 转为区域 = convert-selection-to-region, 存为笔记 = save-as-note.

---

## 0. Shipped substrate (what this doc builds on — read the code, not this summary)

- **Content-only in-reader card** — `src/client/annotationLayer.ts` `wireNoteCard`: one shared
  `#sv-note-card` per realm, hover shows / click pins, body = `payload.noteHtml` rendered by
  `renderAnnotationNotePreview` (`src/client/workspace/annotationNotePreview.tsx`) through
  `getNoteType(contentType).render({ mode: "card" })` — no chrome. Per-anchor geometry persists
  via `CardGeom` / `readCardGeom` / `writeCardGeom` keyed by `data-sv-key`.
  Guarded by `e2e/note-card-content-only.spec.ts`.
- **View-layer marker overlay** — `src/client/markerOverlay.ts` `MarkerOverlay`: one absolutely
  positioned chip per anchor, placed at the anchor's TOP-RIGHT by `rectToOverlayLocal`
  (`x: anchorRect.right - overlayRect.left`), rAF-throttled `reposition()`. Glyphs come from
  `buildMarkerHtml(payload)` (`annotationLayer.ts`): `ANCHOR_GLYPH` + one `MARKER_GLYPHS[type]`
  per distinct note type with a `<sup>` count.
- **PreviewCard / CenterView (R3)** — `src/client/workspace/ArtifactCard.tsx` (card chrome +
  `cardBody` → `resolveViewer` → `getNoteType().render({mode:"card"})` fallback) and
  `FocusOverlay.tsx` (`render({mode:"full"})`, focus trap, "Open with…" viewer pin).
- **Exclusive viewer resolver (P3)** — `src/client/notes/viewerRegistry.ts` (`resolveViewer`,
  `NOTETYPE_SENTINEL`), Table viewer `src/client/notes/tableViewer.tsx`.
- **Adaptive-note contract** — recognition: `src/core/notes/resolveForm.ts` (`resolveForm`,
  `resolveFormAsync`) over `classifyContent`; display: `getNoteType().render` only
  (`src/client/notes/noteTypeRegistry.tsx`, enforced by `src/client/notes/contract.guard.test.ts`).
- **Action surfaces (R6)** — `selectionActions`/`anchorBarActions` (aliased, one "passage"
  surface, `WorkspaceContext.tsx` ~L1421–1456) rendered by `SelectionFloatingToolbar.tsx`
  (floats under a live selection via `src/client/selection/selectionRect.ts`), the Anchor bar
  (`anchorViews.tsx` `ActionGrid`/`ActionMoreMenu`), and the registered-but-undocked
  `BottomBar.tsx` (`action.bar`).
- **Layer Lens (R7)** — `LayerLensManage.tsx`, `layerTree.ts`, cascade toggles in
  `WorkspaceContext.tsx`.

---

## 1. D1 — Reader Annotation Surface contract (多端统一)

**Decision.** Every reader hosts the SAME three framework-free view-layer pieces — (1) paint
(highlight classes on resolved elements), (2) `MarkerOverlay`, (3) the `#sv-note-card` note card —
driven by one **adapter contract** the reader implements:

```
ReaderAnnotationAdapter (per reader realm)
  rectsFor(anchorId): { first: Rect; last: Rect; all: Rect[] } | null   // live, viewport coords
  onLayoutChange(cb): unsubscribe        // scroll / zoom / page render / reflow → reposition()
  injectRealmCss(css): void              // ANNOTATION_CSS + D3 style vars into the realm
  paint(anchors): void                   // applyHighlight/highlightQuote onto resolved elements
  reveal(anchorId): boolean              // delegates to revealAnchorInDoc
```

This is mostly a NAMING of what exists — `applyHighlight`, `highlightQuote`, `revealAnchorInDoc`,
`setSelectedAnchorInDoc`, `ensureAnnotationLayer` are already shared and realm-safe ("no React /
no Node imports", `annotationLayer.ts` header). The new obligation is `rectsFor` returning
**first/last/all** rects instead of the single `querySelector('[data-sv-key=…]')` element
`MarkerOverlay.anchorFor` uses today — D2's two slots need the first line AND the last line of a
passage, and today a multi-span PDF anchor stamps `data-sv-key` on MANY spans
(`PdfReader.tsx` `highlightAnchors` `matches.forEach`) of which only the first is ever measured.

Current adapter duties and gaps, per reader:

| Reader | Paint | Overlay host | Card realm | Reposition signals | Gap vs D1 |
| --- | --- | --- | --- | --- | --- |
| DomReader iframe (`src/client/surfaces/DomReader.tsx`) | `paintDomAnchors` → `decorateAnnotations` (`annotations.ts`, calls `ensureAnnotationLayer`) | iframe `body` (`overlayForDoc`, forces `position:relative`) | iframe realm | `MarkerOverlay`'s own ResizeObserver + capture-scroll | first-rect only |
| PDF.js (`src/client/PdfReader.tsx`) | `.pdf-anchor-hit` spans + `.pdf-region-box` divs | `.pdf-reader-canvas` (escapes textLayer `scale()`) | host document | `textlayerrendered`, zoom → repaint | multi-span anchors measured by first span only |
| Image (`src/client/ImageReader.tsx`) | `ImageRegionBox` divs (`applyHighlight` on mount) | `.image-reader-stage` | host document | overlay's ResizeObserver | none material (single box ⇒ first=last) |
| Electron webview guest (`electron/webview-preload.ts`) | `highlightQuote` on `sv:anchors` | **NONE — inline chip**: a `position:static` `.sv-anchor-markers` `<span>` appended INSIDE the `<mark>` (L126–145, comment says "dedicated guest overlay … is deferred") | guest realm (`ensureAnnotationLayer(document)`) | n/a (inline flows with text) | **align it**: mount a real `MarkerOverlay` on `document.body` in the preload — the module already runs framework-free in that realm; marker clicks keep bridging via `sv:marker-action` |
| Snapshot web | nested DomReader (same as row 1) | — | — | — | inherits row 1 |
| Future mobile webview | same preload pattern as guest | body overlay | guest realm | visualViewport events | build against this contract from day one |

**Non-goal:** no per-reader card/marker forks. The host keeps feeding readers the one
`paintAnchors` list (`WorkspaceContext.tsx` ~L642, with `notePreviews[].html` from
`renderAnnotationNotePreview`) — the adapter only resolves and measures.

---

## 2. D2 — Two-slot markers (left anchor glyph · right type icons) + suppression

> **§2 amendment (2026-07-04, user-locked; supersedes the click/suppression wording below; shipped as N1A-D2-001):**
> 1. Click semantics: the LEFT anchor-glyph chip does NOT open the card — it TOGGLES that
>    anchor's notes (right note chip + hover/pinned/margin cards) off/on. Per-anchor UI state,
>    session-scoped (realm memory, never persisted). The RIGHT note chip keeps today's behavior
>    (opens the shared grouped card; guest sv:marker-action bridge unchanged).
> 2. A global 显示锚点标记 switch lives in the Anchor panel (anchorViews.tsx): off hides every
>    anchor glyph chip across all readers; note slots stay. Persisted like the annotation mode
>    (localStorage helper in annotations.ts); guests receive it over the sv:anchors payload.
> 3. Still pending from the original D2: same-line clustering, card-open suppression
>    (data-sv-card-open), and the D5 floating editor.
> Shipped: buildAnchorSlotHtml/buildNoteSlotHtml (annotationLayer.ts), MarkerOverlay
> {anchorId, anchorSlotHtml, noteSlotHtml} + first/last placement from the F3 adapter,
> per-anchor toggle store in annotationLayer (card + margin filtering reuse), markerOverlay
> glyph-visibility store.

Today one combined chip (anchor glyph + type glyphs) hangs at the anchor's TOP-RIGHT
(`rectToOverlayLocal`), and it stays visible while the card is open — over a long passage it sits
mid-paragraph and collides with the pinned card. Decision:

- **LEFT margin slot** at the passage's FIRST line: one `ANCHOR_GLYPH` chip — the "有锚点"
  indicator. Position: `first.left − chipWidth − gutterGap`, `first.top`.
- **RIGHT margin slot** at the passage's LAST line: the note-type icons — REUSE
  `buildMarkerHtml`'s dedupe-by-type + `<sup>` count logic, minus the leading anchor glyph
  (split `buildMarkerHtml` into `buildAnchorSlotHtml()` + `buildNoteSlotHtml(payload)`; the
  existing `markerHtml(role)` / `MarkerRole` "anchor"|"note" split already carries the semantics).
  Position: `last.right + gutterGap`, `last.top`.
- **Click either slot** → open the pinned note card near the passage (the existing pin path:
  `MarkerOverlay.handleChipClick` already synthesizes a click on the anchor element for
  role "note" and emits `onMarkerAction` for the host focus bridge — keep both).
- **Suppression:** while THAT anchor's card is visible (hover or pinned), hide its two chips;
  restore on close. Mechanically: `wireNoteCard`'s `show()`/`hide()`/`dismiss()` toggle a
  `data-sv-card-open="<anchorId>"` attribute on the realm body; `MarkerOverlay.layout()` sets
  `chip.style.display="none"` for that id. No new state store — the card already knows
  `currentKey`.
- **Same-line clustering:** two+ anchors whose slot rects land within one line-height collapse
  into ONE cluster chip with a count; click → a mini-list (anchor glyph + quote snippet per row,
  from `paintAnchors[].quote`) → row click opens that anchor's card. Cluster math is pure
  (y-bucketing of slot positions) → unit-test next to `markerOverlay.test.ts`.

`MarkerOverlay` therefore evolves: `setMarkers(items)` takes
`{ anchorId, anchorSlotHtml, noteSlotHtml }`, `layout()` places two chips per anchor from
`adapter.rectsFor(anchorId).first/.last`, then runs the cluster pass, then the suppression pass.

```
      │ left margin          passage                          right margin │
      │                                                                    │
      │  (⚓)  ████ first line of the anchored passage ██████               │
      │       ██ middle line ████████████████████████████                  │
      │       ██ last line ██████████                        (❔²)(▤)      │
      │                                    ▲                               │
      │            click ⚓ / ❔ / ▤ ──────┴──► pinned #sv-note-card        │
      │                                        (chips hidden while open)   │
      │  (⚓3)  ← same-line cluster: 3 anchors → click = mini-list          │
```

Bookmarks keep their distinct treatment (excluded from content cards — `NoteListPanel.tsx`
filters `BOOKMARK_CONTENT_TYPE`; `GLYPH_BOOKMARK` chip styling stays as-is per D3).

---

## 3. D3 — Anchor paint style config (decoration + palette)

Today the paint is ONE hardcoded look: `.sv-annotated { background: rgba(52,116,230,.18);
box-shadow: inset 0 -2px 0 #3474e6 }` in `ANNOTATION_CSS`, literal-colored because "this
stylesheet is injected into the reader realm, which has no `--sv-*` tokens"
(`annotationLayer.ts` L27). Decision:

- **Style value** = `{ decoration: "highlight" | "underline" | "both", color: <palette token> }`
  with 6–8 preset tokens + one custom hex. Presets are named tokens (`yellow`, `green`, `blue`,
  `pink`, `purple`, `orange`, `red`, `custom:#rrggbb`) so a `.svpack`-shared layer renders the
  same everywhere.
- **Precedence:** `anchor.styleOverride` > `layer.style` > global default (current blue).
- **Storage (all additive, no migration):**
  - `style` on the layer record — extend `studyLayerSchema`
    (`src/core/schema/study-layer.ts`), sitting next to the existing presentation fields
    `role` / `color` / `order`. The existing `color` stays the Lens chip color; `style.color`
    is the PAINT color (they may default to each other but are distinct knobs).
  - optional `styleOverride` on the anchor envelope (`src/core/schema/anchor.ts`
    `anchorEnvelopeSchema`) — applies to that anchor across all its notes.
  - global default in workspace settings (the `operation-prefs.json` / workspace-storage
    pattern, per ui-redesign §7.3).
- **Application:** the host resolves precedence when building `paintAnchors`
  (`WorkspaceContext.tsx` ~L642) and threads `style` per `PaintAnchor`; each reader's paint sets
  an inline CSS custom property + a decoration class on the resolved element:
  `element.style.setProperty("--sv-anchor-color", token)` + `sv-deco-underline|highlight|both`.
  `ANNOTATION_CSS` gains token-driven rules
  (`.sv-annotated.sv-deco-highlight { background: color-mix(in srgb, var(--sv-anchor-color) 18%, transparent) }` etc.).
  Inline custom properties survive the no-tokens realm problem — uniform across iframe / PDF host /
  image host / guest (the guest gets style through the `sv:anchors` payload, same as `noteHtml`).
  `.sv-selected` / `.sv-active` (focus/pulse) stay accent-blue and win over user paint.
- **Config UI (three scopes, three existing homes):** per-layer picker slots into the Layer Lens
  row (§8.1 — next to the color dot, `LayerLensManage.tsx`); per-anchor picker in the Anchor bar
  (`anchorViews.tsx`, a small swatch row under the excerpt box); global in Settings.
- Region boxes (`.pdf-region-box`, `.image-region-box`) tint their border/fill from the same
  variable. Bookmarks keep their own chip/dot styling (out of scope here).

---

## 4. D4 — Unified selection: kill the "Text | Region" tab

Today ONLY `PdfReader.tsx` has the mode toggle — two `.mode-tab` buttons ("Text" / "Region",
L461–478) flipping `regionMode`; region mode makes the text layer click-through
(`.pdf-reader-canvas.region-mode .textLayer`, `styles.css` L1897) and a drag draws
`.pdf-region-marquee` → `AnchorDraft { mode:"region", rect: normalizeDragRect(...) }`.
`ImageReader.tsx` is already modeless (any drag = region, `isRealRegion` filters stray clicks).
`src/core/region/region.ts` names the geometric principle: `Rect`, `RegionTarget`,
`normalizeRect`, `rematchRegion`, and `isRegionAnchorKind` = `pdf_selection | image_region`.

**Decision — one modeless gesture set, PDF toolbar tab removed:**

1. **Default drag = text selection** (unchanged: PDF `onMouseUp` quote path, DomReader
   `readDomSelection`, guest `sv:selection`).
2. **Region box** = **Alt+drag anywhere**, OR a drag that STARTS on non-text (a PDF page area
   with no `.textLayer` span under the pointer — figures/scans — or the image stage), no modifier
   needed. PdfReader's existing `onMouseDown/onMouseMove/finishDrag` trio becomes
   modifier/hit-test-gated instead of `regionModeRef`-gated.
3. **转为区域** on the floating selection toolbar: converts the CURRENT text selection's bbox
   (already published to `selectionRect.ts` in host coords) into an editable region draft —
   marquee with 8 resize handles, Enter/blur commits `focus.setDraft({ mode:"region", … })`.
4. **All anchor/note actions for BOTH kinds live on the floating selection toolbar** —
   `SelectionFloatingToolbar.tsx` already renders the one Action Registry "passage" surface
   (§7/R6); a committed region publishes its rect into the same `publishSelectionRect` store so
   the toolbar floats beside the box too (today it only floats for text).

```
        ██ selected text ██████████████
        └─────────────────────────────┘
        ┌──────────────────────────────────────────────┐
        │ 🔖 Bookmark │ ✨Explain │ ☑Practice │ ⚠Mistake │ ▭ 转为区域 │ ⋯ │
        └──────────────────────────────────────────────┘
          (SelectionToolbar.tsx renderer · selectionActions · runAction)
```

**Code reality / scope note (stated plainly):** the anchor schema gives region rects ONLY to
`pdf_selection` (`rect` optional) and `image_region` (`rect` required) —
`html_selection` / `web_text_quote` have no rect field (`src/core/schema/anchor.ts`). So
"Alt+drag anywhere" ships in two steps: **D4a** = PDF + image (pure gesture unification, schema
untouched, the Text|Region tab deleted); **D4b** = HTML/web region anchors need a new/extended
anchor shape (e.g. `RegionTarget` on the envelope with `space:{kind:"whole"}` semantics) plus
`rematchRegion` wiring — deferred until a concrete need, consistent with region.ts's own
"deliberately deferred" note. 转为区域 (item 3) works wherever the target kind can carry a rect,
i.e. PDF pages in V1.

---

## 5. D5 — Kill the bottom mega-composer → floating card editor

> **Status: ✅ shipped as N1b (N1B-001, 2026-07-04, commit 02c0476)** — GenerationPreview.tsx
> DELETED; FloatingNoteEditor.tsx anchors the create/edit surface near the passage; slash
> composer (/类型) integration preserved. Landed with the two remaining D2 pieces (same-line
> clustering + card-open suppression) through the shared MarkerOverlay machinery (guest realm
> included), composing with N1a's per-anchor toggle + global glyph switch.

**What actually renders the "bottom composer" today (found, precisely):**

- Clicking a note-type generate button (Anchor bar `ActionGrid` in `anchorViews.tsx`, or the
  floating selection toolbar) fires `runAction` → a kit command (`src/kits/textbook-learning/
  commands.ts` `generateBlock`) or `operation.run` → emits a `GeneratedDraft` via `onGenerated` →
  `WorkspaceContext.pendingDraft` → **`GenerationPreview.tsx`**, which is mounted at the BOTTOM
  of the AI-Chat pane (`views.tsx` L492, between `.chat-log` and `.chat-composer-bar`). Its
  "Edit" swaps in `plugin.edit(...)` — for `textbook.explanation` that is a 6-field stack of
  inputs/textareas (`noteTypes.tsx` `ExplanationEditor`) filling the pane bottom. This
  preview+editor block IS the mega-composer the user hits: big, parked at a pane bottom, far
  from the passage — and if the right sidebar is on the Anchor tab, the draft appears in a tab
  the user isn't even looking at (`RightSidebarTabs.tsx` only auto-switches for note focus, not
  drafts).
- The Textbook Learning layout additionally docks a full-width bottom strip under the reader —
  the `practice` view (`presets.ts` `studentDock`, 240px; `practiceViews.tsx`) — but that is a
  read-only LIST of `textbook.exercise`/`textbook.mistake` notes, not a composer.
- **Reality check vs the locked wording:** there is no single "bottom full-width note composer"
  component in the code; the pain is the pane-bottom `GenerationPreview` edit stage (plus the
  legacy `.composer-input { min-height:132px }` styling, `styles.css` L2022). D5 is therefore
  specced as: remove the BOTTOM-PARKED edit surface; whether the `practice` list strip stays is
  a layout-preset question, untouched here.

**Decision — the floating card editor:**

- Clicking a note-type button opens a **floating card editor** NEXT TO the passage: the same
  content-only card component (`#sv-note-card` family / PreviewCard body) in **EDIT mode** —
  body = `getNoteType(contentType).edit({ content, onChange })`, the registry editor the
  composer and `NoteListPanel` edit-in-place already share (contract law §0.5).
- Small (PreviewCard sizing, §10.5: ~260–340px wide), resizable (reuse `CardGeom` persistence),
  positioned by the same rect logic as the pinned note card (below the passage's last line,
  i.e. D2's right slot).
- **Autosave-draft:** keystrokes debounce into a local draft (per anchorId+contentType key,
  same localStorage pattern as `readCardGeom`); Esc/close keeps the draft, explicit 丢弃 clears.
- **Save → note exists**: dispatch `anchor.add-note` with the materialized anchor (exactly
  `savePendingDraft`'s path, `WorkspaceContext.tsx` L1009–1024) — the D2 chip appears at the
  passage on the repaint.
- **⤢ expands to CenterView** for full editing: the same block opens in `FocusOverlay` with the
  editor body (CenterView gains an "edit" body variant — still the one registry `edit()`; no
  second editor path).
- For AI-generating buttons the flow is unchanged upstream (command → `GeneratedDraft`); the
  DRAFT simply renders in this floating editor instead of the pane bottom.
  `GenerationPreview.tsx`'s Save/Regenerate/Discard semantics move with it (`regenerating`
  guard, `classified` no-op rule). The chat pane keeps only chat.

```
   ██ anchored passage ████████████████
   ██ last line ██████         (⚓ suppressed while editor open)
      ┌───────────────────────────────┐
      │ ❔ quiz · draft        ⤢  ✕  │   ← type icon + status; ⤢ = CenterView
      │ ┌───────────────────────────┐ │
      │ │ Question  [___________]   │ │   ← getNoteType("quiz").edit(...)
      │ │ Options   [___________]   │ │
      │ │ Answer    [__]            │ │
      │ └───────────────────────────┘ │
      │ [Save] [Regenerate] [丢弃]     │   ← anchor.add-note / preview-loop actions
      └───────────────────────────────┘◢   ← resizable (CardGeom persisted)
```

---

## 6. D6 — AI answer → note chip (auto-materialize with anchor context)

Grounding: a chat reply already renders through the contract — `ChatMessageBody.tsx` classifies
(`classifyContent`) and shows high-confidence rich replies as an `ArtifactCard`; "Add as note"
(`addReplyAsNote`, `WorkspaceContext.tsx` L1123) classifies + dispatches `anchor.add-note`,
which attaches to the focused anchor if one exists. The preview loop (`previewClassifiedReply`,
`GeneratedDraft`, `GenerationPreview`) covers explicit preview-edit flows, incl. the AI form
router `note.generate-block` (`commands/registry.ts` L570).

**Decision:**

- **With anchor context** (invoked from the selection toolbar / Anchor bar, or chat asked while
  `focus.anchor`/`focus.draft` is set): the structured result **auto-materializes** as a note on
  that anchor — `materializeAnchor()` + `createNote` with `status:"draft"` (a new, additive note
  field), and an **undo toast** ("已生成笔记 · 撤销") whose undo dispatches `note.delete`. The D2
  chip appears at the passage immediately (paint derives from notes, so the repaint is free).
  The chat message shows the PreviewCard plus a "已生成 · 定位" affordance → `focus.setAnchor`
  (the reveal path readers already implement via `revealAnchorInDoc`).
- **Free-chat answers (no anchor context)** stay chat-only, with the existing action renamed
  存为笔记: target = the focused anchor if the user has since focused one, else a page-level
  (unanchored) note on the active source — exactly `anchor.add-note`'s current fallback.
- The **generation preview loop stays** for explicit 试一下 flows: an action can be configured
  (per-surface prefs, §7.3) to preview-first, and `note.generate-block` / classified drafts keep
  parking in the D5 floating editor for confirmation. Auto-materialize is the default for
  DIRECT note-type buttons; nothing about `onGenerated`'s contract changes — the host just gains
  an auto-save + undo consumer beside the preview consumer.

This is a small behavioral delta over reality, not a new pipeline: today's manual
"Add as note" already lands on the focused anchor; D6 makes anchor-context generation land there
WITHOUT the extra click, and adds draft status + undo as the safety net.

---

## 7. D7 — Textbook type UI audit + interactive full-mode spec

**Audit — what actually renders today** (all via `getNoteType().render`, card vs full):

| type | card mode (today) | full mode (today) | verdict |
| --- | --- | --- | --- |
| `quiz` (builtin, `builtinNoteTypes.tsx` `QuizRender`) | question only, 1 line | question + options `<ul>` with the answer PRE-MARKED "✓" + explanation + an "Overview" aside | **not interactive; answer is spoiled** — no attempt/reveal/score |
| `flashcard` (builtin, `FlashcardRender`) | front + hint "点击翻开查看背面" | BOTH faces rendered side-by-side (Front ↔ Back) | **no flip** — the card hint promises an interaction the full view doesn't have; no deck nav |
| `textbook.explanation` (`kits/textbook-learning/noteTypes.tsx`) | 1-line snippet | badges + title + prose + analogy + key points + misunderstandings | static but adequate |
| `textbook.exercise` "Practice" | question line | question + options + **Answer: always visible** + explanation | same spoiler problem as quiz |
| `textbook.mistake` | question/correction line | head badges (mastery, retries) + question + "My answer" + "Correct" + why-missed + correction | the 题目/我的答案/正解/归因 sections **already exist** (`MistakeRender`); missing: retry/mastery interaction |
| `textbook.review-pack` | summary line | title + summary + key points + weak points + flashcards as a static list (front — back both visible) | **`exercises: string[]` exists in the schema but is rendered nowhere** (and the editor has no field for it); no linked-note behavior |

**Spec — the missing interactive full modes** (all inside `render({mode:"full"})`; interaction
state is component-local; persistence, where wanted, is explicit note edits — no side-channel UI):

- **quiz / textbook.exercise:** options render as buttons; per-question flow = pick → "check" →
  correct/incorrect styling + explanation reveal; a score line ("2/3 · 重做") for multi-question
  content. `answerIndex`/`answer` stays hidden until checked. Card mode unchanged (question
  only, count in the wrapper footer via `noteCardMeta` extra).
- **flashcard:** full = ONE face with a flip interaction (click/Space), honoring the card hint;
  **deck nav across sibling cards** = prev/next over the other flashcard notes on the same
  anchor/source — the host already threads `note` into render, so the plugin reads siblings via
  a render `ctx` the host supplies (adds a typed `ctx` shape; the field exists on
  `NoteRenderInput` today, unused).
- **textbook.mistake:** keep the four sections; add "再试一次" (re-attempt input → compare →
  bump `retryCount`, offer mastery bump) — writes go through `note.edit` dispatch, the same
  command `NoteListPanel` uses.
- **textbook.review-pack:** render `exercises[]` at last — as a **linked-note checklist**: each
  entry resolves a note id → row = type icon + title + done-checkbox; click → CenterView of that
  note; unresolvable ids render inert text. (Generation should start emitting note IDs into
  `exercises`; today the prompt fills prose strings.)

All strictly through the adaptive-note contract — no new render paths; `contract.guard.test.ts`
keeps proving no `contentType ===` branches leak into hosts.

---

## 8. D8 — Subject note-type catalog (feeds the plugin marketplace)

These are **marketplace catalog entries** (`CatalogEntry(kind:"plugin")`, plugin-viewer-model
§8.2) — each = one core `NoteContentSpec` (zod schema + `createDefault` + `toSearchText`,
registered like `builtinNoteContentSpecs` in `src/core/notes/contentTypes.ts`) + one client
`NoteTypePlugin` (render card/full + edit) + optionally a generate prompt (the
`textbook-learning/prompts/*` pattern). `.svpack` import consumes them via M3 dependency prompts
(§8.7). Card/full sketches obey §10.3 (card = 1–3 lines, no interaction).

| contentType | minimal content schema | card | full |
| --- | --- | --- | --- |
| `subject.formula` 公式卡 | `{ latex, name?, variables?: {sym,meaning}[], note? }` | rendered LaTeX, 1 line | KaTeX render + variable table + note (the Anchor pane already surfaces an `anchor.formula` hint — `anchorViews.tsx` L31) |
| `subject.derivation` 推导步骤 | `{ goal, steps: {expr, why?}[] }` | goal + step count | numbered steps, each expr + collapsible "why"; step-through mode |
| `subject.theorem` 定理卡 | `{ name, statement, proof?, usage?: string[] }` | name + statement snippet | statement · proof (collapsed) · usage list |
| `subject.vocab` 生词卡 | `{ word, phonetic?, senses: {pos?, def}[], examples?: string[] }` | word + first sense | full senses + examples; "→ flashcard" affordance (feeds SRS later) |
| `subject.grammar` 语法点 | `{ pattern, explanation?, examples: string[], pitfalls?: string[] }` | pattern line | pattern + examples + pitfalls (warn styling à la `tb-warn`) |
| `subject.excerpt` 摘抄赏析 | `{ quote, comment?, tags?: string[] }` | quote (2 lines) | quote block + comment prose |
| `subject.argument` 论证结构 | `{ claim, evidence: string[], counter?: string[] }` | claim line | claim → evidence list → counter list (indent tree) |
| `subject.timeline` 时间线 | `{ title?, events: {date, label, detail?}[] }` | title + event count | vertical timeline, expandable events |
| `subject.figure` 人物卡 | `{ name, role?, era?, facts: string[] }` | name + role | fact sheet |
| `subject.causeEffect` 因果链 | `{ chain: {cause, effect}[] }` | first link + length | chain diagram (A → B → C), row expand |
| `subject.experiment` 实验记录 | `{ setup, steps: string[], observations: string[], conclusion? }` | conclusion/setup line | four sections (mirrors the mistake-card section pattern) |

**Subject kits** (kit = a catalog `CatalogEntry(kind:"kit")` bundling plugin ids, §8.2; user
kits per §8.5.4): 数学Kit = formula/derivation/theorem + existing `textbook.mistake`/`quiz`;
英语Kit = vocab/grammar/excerpt + existing `flashcard`; 语文Kit = excerpt/argument/figure;
史地Kit = timeline/figure/causeEffect; 理化生Kit = experiment/formula + concept-map (= the
existing core `markmap` type — no new plugin needed).

**Build first (2–3 exemplars):**
1. **`subject.vocab`** — direct synergy with the flashcard/SRS track: D7's flashcard deck nav
   gives it a drill surface for free, and review-pack's `flashcards[]` can be fed from vocab
   cards; the schema is small and the generate prompt is the classic selection→structured case
   (`generateStructured`, exactly the `generateBlock` helper shape).
2. **`subject.formula`** — the Textbook kit already hints at it (`anchor.formula` in the Anchor
   pane; PDF region anchors capture the figure/formula box today), 数学Kit anchors the D4a
   region flow to a real payoff. Needs one new dependency (KaTeX) — flag in the catalog entry.
3. (stretch) **`subject.excerpt`** — trivially schemaed, exercises the 语文/英语 kits and the D5
   floating editor with a manual-first (non-AI) type.

---

## 9. D9 — 复盘 (retrospective) + build order

**SHIPPED (verified in code this pass):**
- Content-only hover/pin note card + per-anchor geometry (`annotationLayer.ts`;
  `e2e/note-card-content-only.spec.ts`).
- View-layer marker overlay, uniform across DomReader/PDF/image (`markerOverlay.ts`).
- PreviewCard/CenterView R3 (`ArtifactCard.tsx`, `FocusOverlay.tsx`), one render entry
  `getNoteType().render({mode})`.
- Viewer resolver P3 (`viewerRegistry.ts` + Table viewer + "Open with…" pin).
- Adaptive-note contract (resolveForm / classifyContent / registry + guard test).
- Action Registry surfaces R6 (shared "passage" list, floating toolbar, anchor grid, registered
  bottom bar) and Layer Lens R7 (`LayerLensManage.tsx`, cascade, `parentId`).

**CHANGED by this doc:** D2 splits the single top-right chip into two slots + suppression +
clustering; D4 deletes PdfReader's Text|Region tab for modeless gestures + 转为区域; D5 removes
the pane-bottom GenerationPreview edit stage in favor of the floating card editor.

**NEW:** D3 style tokens (layer.style / anchor.styleOverride / global), D6 auto-materialize with
draft+undo, D8 subject catalog.

**SLOTS INTO planned work:** R6 Action toolbar hosts D4's 转为区域 and D5's note-type buttons
(same `ToolbarAction` list, same `runAction`); R7 Layer Lens hosts D3's per-layer style picker;
the marketplace M-phases host D8 (M1 catalog entries, M2 user kits bundling them, M3 `.svpack`
import dependency prompts resolving D8 types); D1's guest alignment rides the existing
webview IPC (`sv:anchors`/`sv:marker-action`).

**Build order (each N independently shippable):**

- **N1 = D2 + D5** (highest user pain: markers split/suppress + floating editor replacing the
  bottom-parked composer). Tests: unit — slot placement + cluster bucketing next to
  `markerOverlay.test.ts`, suppression toggling in `annotationDom.test.ts`; e2e — extend
  `note-card-content-only.spec.ts` (left/right slots paint, chips hide while card open) + a new
  `floating-editor.spec.ts` seeded via the API pattern in that spec (click Practice on the
  anchor bar → editor floats by the passage → Save → chip appears; the old
  `.generation-preview` selector is retired — update `generation-preview.spec.ts` to the new
  mount point rather than deleting coverage).
- **N2 = D4 + D3** (selection unify + styles). Tests: `regions.spec.ts` drops the mode-tab
  clicks (Alt+drag / non-text drag instead); new unit tests for style precedence resolution;
  e2e asserts the painted element carries `--sv-anchor-color` after a Lens layer-style change.
- **N3 = D6** (auto-materialize). Tests: command-level unit (anchor context ⇒ createNote with
  draft status; undo deletes) beside `registry.test.ts`; e2e — anchor-focused chat reply shows
  "已生成 · 定位" and the chip exists without clicking save; free chat stays chat-only.
- **N4 = D7 interactive fulls + D8 exemplars, landing with marketplace M1** (catalog lists the
  new plugins; installing 英语Kit lights up vocab in the composer/type registry). Tests:
  per-type render unit tests (quiz check/score, flashcard flip) in the
  `noteTypeRegistry.test.tsx` style; `textbook-kit*.spec.ts` extended for the review-pack
  checklist.

**Honest deltas vs the locked decisions (found while grounding, not bent):**
1. D5's "bottom full-width note panel" does not exist as one component — the real offender is
   `GenerationPreview` + `plugin.edit` parked at the AI-Chat pane bottom (`views.tsx` L492);
   the only full-width bottom panel is the Textbook layout's read-only `practice` list strip.
   D5 above targets the former; the latter is a layout-preset decision left untouched.
2. D4's "Alt+drag anywhere" is schema-blocked on HTML/web surfaces (`html_selection` /
   `web_text_quote` carry no rect) — phased as D4a (PDF+image now) / D4b (schema extension).
3. D7's mistake sections (题目/我的答案/正解/归因) already render today (`MistakeRender`); the
   genuinely missing pieces are quiz/exercise answer-hiding+check, flashcard flip/deck, and the
   review-pack `exercises[]` (schemaed but never rendered).
4. D6's 存为笔记 already exists as "Add as note" and already targets the focused anchor — D6 is
   an automation + draft/undo delta, not a new pipeline.

---

## 10. Round 2 (2026-07) — persistent overlay (D10) · hide-all (D11) · Anchor Focus board (D12)

Origin: a user review of the selection toolbar + the 3-way TopBar + the Anchor Focus concept.
**Finding first — the toolbar is already right:** `SelectionFloatingToolbar` floats the
anchor-scope actions IN the document (not the sidebar), reusing one `selectionActions` list +
`runAction`, grouped by `actionGroups.ts` (Create Note / AI Actions / Study Actions / Custom),
with a Customize hook (`openOperationManager`). "在文档里、一排快捷按钮、点了调 AI、可编辑可重生成"
— the capability is all present. The genuine deltas are the three below; D5 already fixes the
biggest one.

### D10 — note open-state + position persist AND export (extends D5's geometry)
**Gap (grounded):** D5/§10 card geometry uses `CardGeom` in **localStorage** (`readCardGeom`) and
open-state is component-local (§ "state is component-local", L328). So a pinned card's position is
per-device and **never travels in `.svpack`**. The user wants a note *fixed open, at a remembered
position, carried on export.*
**Decision — an additive, optional presentation field on the note schema:**
```
note.display?: {
  open?: boolean;                       // pinned open (vs collapsed to a D2 chip)
  offset?: { dx: number; dy: number };  // ANCHOR-RELATIVE, never absolute px
  size?:   { w: number; h: number };
}
```
- **Anchor-relative** offset (from D2's right-slot origin — the same rect logic as the pinned card
  / D5 editor) is the crux: absolute pixels break on reflow / zoom / font-size / screen and are
  meaningless on a recipient's device; a relative offset survives all of them AND export.
- **Stored on the note** ⇒ it lives in the vault jsonl and is **automatically included in the
  `.svpack` export** — `buildStudyPack` already ships `note` records, so the field rides along with
  no export change. The recipient sees the author's pinned layout.
- localStorage `CardGeom` stays the **ephemeral fallback** for un-pinned cards (drag-before-pin);
  a **Pin** affordance promotes the current geometry into `note.display`; un-pin clears it. The D2
  marker chip reflects pinned state (active glyph when `display.open`).
- **Sealed (imported) notes:** `display` is read-only like the rest of the sealed record; a reader
  can still locally hide-all (D11 — a view flag) without mutating the sealed note.

### D11 — per-document "hide all notes" toggle (collapses the 3-way TopBar)
**Decision:** an icon next to the reader's TOC/目录 control flips a per-source `notesHidden` **view
flag** → every pinned card collapses to its D2 icon chip; click again restores. Because each note's
own open state lives in `display.open` (D10), "打开的打开、关闭还是关闭" is preserved for free — the
toggle only masks, it never loses per-note state.
- This **subsumes the global "Notes Overlay" annotationMode.** The TopBar 3-way
  (`Document / Notes Overlay / Anchor Focus`) collapses to **two**: `Document` (always renders
  pinned cards as the overlay; icons⇄cards IS the hide-all toggle, not a mode) and `Anchor Focus`
  (the board, D12). One less global mode; the icons/cards choice moves to where it belongs
  (per-document, in-reader).
- `notesHidden` is **device-local view state** (localStorage / workspace.json), **not** exported —
  the exported truth is each note's `display.open` (D10). A reader who hid everything still ships
  the author's pins.

### D12 — Anchor Focus: from weak re-reveal → a real board (two modes)
**Today** "Anchor Focus" (TopBar) only re-reveals the one focused anchor (badge = 1). **Upgrade** to
a board centered on anchors+notes, two layouts (the user's mockup):
- **Mode A — by document order (default):** anchors in reading order; each row = the anchor passage
  + its notes as PreviewCards. Scenario: 顺着读 / 整理补充.
- **Mode B — by stage layer:** columns = the source's **stage layers**, notes bucketed by `layerId`.
  Scenario: 查漏 / 考前复习.
- **CRITICAL — columns are data-driven from F7:** columns are whatever stage layers the source
  actually has (`stagePresetForKits` seed + the user's renamed/added/removed ones), **never a
  hardcoded `预习/学习/练习/错题/复习`**. The mockup shows 5; textbook's F7 axis is 4
  (预习/学习/复习/拓展). The board is a **consumer of the F7 axis** and always reflects the live
  layers — the direct payoff of F7 being kit-contributed + user-editable.
- **Reuse, don't rebuild:** cards are the §10 PreviewCard (same render contract, hover/center-view);
  filters = 只看当前 Layer (narrows columns/rows) + search + fullscreen. No new card system, no new
  render path.
- **V1 scope = single document** (the mockup is one textbook). A cross-document board is a multi-doc
  concern → defers to P-A/B (`multidoc-and-concepts.md`); a cross-doc note would appear under each
  of its documents' boards.

### Two things confirmed, not re-solved here
- **The "AI note lands in the right sidebar" bug is D5/N1**, already documented (§5:
  `GenerationPreview` @ `views.tsx:492`, inside the chat pane → floating editor next to the
  passage). No new decision; D10 then upgrades D5's localStorage geometry to the vault+export
  `note.display`.
- **The webview toolbar hole is F3.** `SelectionFloatingToolbar` does not float for cross-realm
  `<webview>` guests (live web / local HTML) — they can't cheaply report a selection rect. Until the
  F3 reader adapter, HTML/web sources get the Anchor Action Bar but no float-on-selection.

**N-mapping (new):** **N5 = D10 + D11** (rides N1 — extends D5's card to a vault-persisted +
exported `display`, adds the hide-all toggle, collapses the TopBar to two). **N6 = D12** (the Anchor
Focus board — consumes F7 (shipped) + §10 PreviewCard; a mostly-independent new surface, outside the
contended reader-paint files).
