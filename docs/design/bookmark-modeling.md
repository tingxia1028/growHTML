# Bookmark modeling — reuse note, reuse anchor, or a new abstraction?

**Status: Implemented (V1).**

> Originally a research + design proposal; V1 is now shipped on branch
> `codex/ai-study-vault-rework` exactly as recommended (a bookmark is a note type,
> **zero core-schema change**). See the **Implementation log** at the end for the real
> files changed and review findings. Cross-references
> `docs/design/anchor-selection-abstraction.md` for the text-vs-region selection model —
> this doc does **not** redefine selection, only the *entity choice* for bookmarks.

---

## 1. Context / problem

We want "bookmarks" in a document: a lightweight marker the user can drop on a spot,
name, and jump back to — possibly with a color and an order, but **not** rich content.
The question is purely about the **data model**: should a bookmark be a `note`, an
`anchor`, or a new core entity? The overriding constraint (the user's, and the repo's
existing philosophy) is **keep the core schema clean and simple** — a new core entity
must clear a high bar; reuse wins if it works.

There is **no existing bookmark code** (`grep -i bookmark` over `src/` is empty) — this
is greenfield.

## 2. What `anchor` vs `note` each already give you

| Concern | `anchor` (`src/core/schema/anchor.ts`) | `note` (`src/core/schema/note.ts`) |
| --- | --- | --- |
| **Identity** | `anchor_…` record | `note_…` record |
| **Location** | IS a location (quote/selector/rect/page) | references locations via `anchorIds[]` |
| **User-facing label/content** | **none** — anchors are anonymous substrate | `content: unknown` + `contentType`, validated per-type |
| **Extensibility seam** | **closed** `z.discriminatedUnion("anchorKind", …)` | **open** — `contentType: z.string()` + a `NoteContentSpec` |
| **Visibility** | n/a | `private` by default (`note.ts`) |
| **Layers / export / share** | only travels *because a note references it* | first-class in study packs |
| **Listing / paint / search** | painted as highlights; not listed as named items | listed, painted, searchable via existing machinery |
| **Lifecycle** | lazily materialized for a note/patch (`FocusContext.materializeAnchor`) | created explicitly via `createNote` |

The decisive asymmetry: **anchor is a closed union with no label**, and is deliberately
anonymous, lazily-created substrate (`FocusContext.tsx` `materializeAnchor`, the
`POST /api/anchors` path in `src/server/app.ts`). **Note is the blessed open extension
seam** — adding a type is one `NoteContentSpec` (`src/core/notes/contentTypes.ts`) + one
client `NoteTypePlugin` (`src/client/notes/noteTypeRegistry.tsx`), **zero core-schema
change**. This is the explicit iron law in `docs/design/product-kit.md` and
`src/kits/types.ts`: features do not own core entities; they reuse domain-prefixed note
content types.

## 3. Options, evaluated against "clean simple core"

### (a) Reuse `note` — **recommended**
A bookmark = a `Note` with `contentType: "bookmark"`, anchored to a location, minimal
content `{ label: string, color?: string, order?: number }`.
- **Core change: zero.** New type = one `NoteContentSpec` + one client plugin.
- Inherits listing, painting, visibility, search, and crucially **study-layer
  shareability/export** for free.
- Cost: carries the note envelope (`conceptIds`, content validation). For a marker this
  is mild overhead, not a correctness problem — and it buys uniformity.

### (b) Reuse `anchor`
A bookmark = a standalone `Anchor` (+ a new `label`/`title` field, or a new `anchorKind`).
- **Edits core**: the `anchorKind` union is closed, so adding bookmark fields or a kind
  changes the core schema — exactly what we want to avoid.
- **Breaks export**: `buildStudyPack` (`src/server/studyLayer.ts`) exports *notes* plus
  the anchors they reference, and **drops any anchor referenced only by dropped notes** —
  a bookmark-as-bare-anchor would not export/import without special-casing.
- Muddies the clean invariant "anchor = pure, anonymous location."

### (c) New core entity
- Fails the high bar: reuse plainly works, so a new `Bookmark` entity adds a store, CRUD,
  schema, layer-policy, and export plumbing for no benefit reuse doesn't already provide.

## 4. Recommended design

**A bookmark is a note type.**

- Core spec `bookmark` in `src/core/notes/contentTypes.ts`:
  `schema = z.object({ label: z.string(), color: z.string().optional(), order: z.number().optional() })`,
  `createDefault → { label: "" }`, `toSearchText → label`.
- **The customization is a plugin (same seam the Textbook kit cards use) — a note shown
  as a label.** A client `NoteTypePlugin` for `bookmark` in
  `src/client/notes/builtinNoteTypes.tsx` (or a kit) whose:
  - `render()` is a **compact label chip** (color dot + label, click-to-jump) — NOT the
    full note card the other types render. This is the whole "上层 UI 定制" — the data is
    a plain note, the *presentation* is the bespoke plugin.
  - `edit()` is a tiny editor (label + optional color), not the rich note editor.
- **Surfacing (kept distinct from the note list):** bookmark chips appear as (a) an
  inline marker on the bookmarked passage (painted like other annotations) and (b) a
  dedicated lightweight "Bookmarks" strip/list of label rows = jump targets. Bookmarks
  are filtered OUT of the main note-card list so they read as markers, not content.
- **Location**: a bookmark still needs a spot, so it reuses the anchor it is created on —
  `focus.materializeAnchor()` → `createNote({ contentType: "bookmark", anchorIds: [anchor.id], content: { label } })`. Same path every note already uses (and the same path the new generation-preview/`anchor.add-note` flow uses).
- **List / jump**: a "Bookmarks" panel filters `WorkspaceContext.notes` by
  `contentType === "bookmark"`; clicking one calls `focus.setAnchor(...)` to scroll/select
  its anchor — all existing machinery (`paintAnchors`, `noteTextByAnchorId`).
- **Shareability**: as a note it travels in study packs for free and is `private` by
  default. If bookmarks should be strictly local (not exported), add `bookmark` to the
  `privateByDefaultContentTypes` policy — the same one-line mechanism `textbook.mistake`
  already uses (`src/server/studyLayer.ts`). This is a *policy* choice, not a model change.

## 5. Impact / migration / risks

- **Files touched (V1):** `src/core/notes/contentTypes.ts` (the spec) + a client plugin in
  `src/client/notes/builtinNoteTypes.tsx`, plus an optional "Add bookmark" command/surface
  and a small Bookmarks list view. **Core schema files changed: 0.**
- **Backward-compat:** greenfield; no migration.
- **Risk — "a note feels heavy for a marker":** mitigated — the content is `{ label }`,
  the editor is trivial, and reuse buys list/paint/search/export with no new subsystem.
- **Decision to confirm:** are bookmarks shareable (travel in study packs) or strictly
  private/local? Default recommendation: shareable like other notes, with the option to
  flip to private-by-default via the existing layer policy.

## 6. Staged plan

**V1 (minimal):**
1. Add the `bookmark` `NoteContentSpec` (core, React-free) — `contentTypes.ts`.
2. Add the client `NoteTypePlugin` (render chip + jump, tiny label/color editor).
3. An "Add bookmark" affordance (a command + selection-toolbar/source-action entry) that
   materializes the focused anchor and creates the bookmark note.
4. A "Bookmarks" list (filter notes by contentType; click → `focus.setAnchor`).
5. Tests: core spec validation; e2e — drop a bookmark on a passage → it appears in the
   list → clicking jumps to the passage.

**Deferred:** drag-ordering of bookmarks (could reuse the same `operation-prefs`-style
per-vault ordering pattern), folders/tags, and a private-by-default policy toggle.

---

## Implementation log

Shipped exactly as recommended in §4: **a bookmark is a note type** (`contentType:
"bookmark"`), with a bespoke chip plugin, a dedicated `bookmark.add` command + core
selection action, a dedicated Bookmarks pane, and note-list exclusion. **Core schema
files changed: 0** — only one `NoteContentSpec` + client/plugin/view surfaces.

### Files changed

`git diff HEAD --stat` (tracked modifications):

```
 docs/samples/teacher-layer.studypack       | 49 +++++++++++++++++-
 src/client/commands/registry.test.ts       | 46 +++++++++++++++++
 src/client/commands/registry.ts            | 32 ++++++++++++
 src/client/notes/builtinNoteTypes.tsx      | 63 ++++++++++++++++++++++-
 src/client/notes/noteTypeRegistry.test.tsx | 23 ++++++++-
 src/client/notes/noteTypeRegistry.tsx      |  5 ++
 src/client/styles.css                      | 83 ++++++++++++++++++++++++++++++
 src/client/workspace/SelectionToolbar.tsx  |  5 +-
 src/client/workspace/WorkspaceContext.tsx  | 23 ++++++++-
 src/client/workspace/WorkspaceShell.tsx    |  2 +
 src/client/workspace/dock.ts               |  3 +-
 src/client/workspace/presets.ts            |  3 ++
 src/client/workspace/views.tsx             | 10 +++-
 src/core/notes/contentTypes.test.ts        | 27 ++++++++++
 src/core/notes/contentTypes.ts             | 18 +++++++
 15 files changed, 379 insertions(+), 13 deletions(-)
```

New (untracked) files not in the stat above:

- `src/client/workspace/bookmarkViews.tsx` — the Bookmarks pane (`bookmark.list` view).
- `src/client/workspace/bookmarkViews.test.tsx` — unit tests for the pane (filter, jump, disabled-when-anchor-absent).
- `src/client/workspace/noteCards.ts` — pure `noteCardsFrom` helper (note-list exclusion).
- `src/client/workspace/views.test.tsx` — unit tests for `noteCardsFrom`.
- `e2e/bookmark.spec.ts` — the V1 end-to-end spec.

### Core spec

`src/core/notes/contentTypes.ts` adds the `bookmark` `NoteContentSpec` (exported as
`BOOKMARK_CONTENT_TYPE`): `schema = z.object({ label: z.string(), color: z.string()
.optional(), order: z.number().optional() })`, `createDefault → { label: "" }`,
`toSearchText → label`. It is registered as a built-in, so the API validates bookmark
content before storage like any other note type. Covered by `contentTypes.test.ts`
(registration, default round-trip, label validation rejecting `{}` / non-string label,
search text).

### Chip plugin

`src/client/notes/builtinNoteTypes.tsx` registers the `bookmark` `NoteTypePlugin`.
Unlike every other type it **renders as a compact label chip** (`BookmarkChip`: color
dot `.sv-bookmark-dot` + `.sv-bookmark-label`), not a full note card; `edit` is a tiny
label + color editor (`BookmarkEditor`), not the rich editor. `asBookmark` is inert-safe
(mirrors `asFlashcard`) so foreign content can't crash the chip. The plugin is
`hidden: true` (see review fix below). Chip/panel styling lives in `styles.css`.

### Add-bookmark command + selection action

`src/client/commands/registry.ts` adds the `bookmark.add` `Command` (`group: "anchor"`):
available when a passage is in focus (`focus.anchor || focus.draft`), it
`materializeAnchor()`s the focused passage — the **same path** `anchor.add-note` and the
generation-preview flow use — and `createNote({ contentType: "bookmark", anchorIds,
content: { label } })`. The label is seeded from the focused quote (collapsed,
truncated to 60 chars), overridable via `payload.text`; a region draft with no quote
saves an empty label (chip shows "Untitled bookmark"). `WorkspaceContext.tsx` exposes it
as a **core** selection action `BOOKMARK_ACTION` (`id: "bookmark.add"`, leads the toolbar,
NOT kit-gated); `SelectionToolbar.tsx` maps the `bookmark` icon. Covered by
`registry.test.ts` (4 cases: materialize+seed, `payload.text` override, empty-label
region draft, unavailability).

### Bookmarks panel

`src/client/workspace/bookmarkViews.tsx` registers the `bookmark.list` view: filters
`ctx.visibleNotes` to `BOOKMARK_CONTENT_TYPE`, renders each as a `.bookmark-row`
button showing the plugin chip; clicking resolves the note's first `anchorId` from
`ctx.anchors` and calls `focus.setAnchor` to jump (row disabled when the anchor isn't
visible). Wired in as an additive pane: `WorkspaceShell.tsx` imports it,
`presets.ts` adds a `bookmarks` leaf to the study-vault dock, `dock.ts` registers its
label ("Bookmarks") and marks it a secondary (auto-collapsing) pane. Covered by
`bookmarkViews.test.tsx`.

### Note-list exclusion

`src/client/workspace/noteCards.ts` is the pure `noteCardsFrom(notes)` helper that drops
bookmark-typed notes (treating a missing `contentType` as `markdown`). `views.tsx`
`StudyView` applies it so bookmarks read as markers, not cards, and `noteTypeOptions`
skips `hidden` plugins so a bookmark can't be authored anchor-less from the generic
composer. Covered by `views.test.tsx`.

### New e2e spec

`e2e/bookmark.spec.ts` (web mode, modeled on `layer-as-lens.spec.ts`): seed an HTML
source → select a passage → the core "Bookmark" selection action appears → click → a
`.bookmark-row` chip appears in the Bookmarks pane with the seeded label, and the server
has a `contentType: "bookmark"` note → co-create a normal markdown note on a second
passage and assert the bookmark is **absent** from `.note-list` → clear focus, click the
row, and assert the passage is re-selected (jump).

### Review findings — fixed / rejected

Checks, unit tests, and e2e all pass after the fixes.

- **Bookmarks included in anchor painting (JSON-serialization regression)** — *high,
  fixed.* `WorkspaceContext.tsx` `noteTextByAnchorId` now skips bookmark-typed notes, so
  the structured `{ label }` no longer paints as raw JSON on the passage. (The anchor's
  own inline marker still paints — every anchor is in `anchors`/`paintAnchors`.)
- **Missing import for the bookmark content type in `WorkspaceContext`** — *high, fixed.*
  Added `import { BOOKMARK_CONTENT_TYPE }`.
- **Bookmark creatable through the note type selector without an anchor** — *medium,
  fixed.* Added a `hidden?` flag to `NoteTypePlugin` (`noteTypeRegistry.tsx`), set
  `hidden: true` on the bookmark plugin, and `noteTypeOptions` (`views.tsx`) skips hidden
  types — bookmarks are created only via `bookmark.add`.
- **No unit test for the StudyView note-list exclusion filter** — *medium, fixed.*
  Extracted the filter into the pure `noteCardsFrom` helper (`noteCards.ts`) and added
  `views.test.tsx` (4 cases). *Caveat:* the test targets the extracted helper rather than
  a full `StudyView` render — `StudyView` can't render headless (its
  `readerForSource → PdfReader → pdfjs` chain needs `DOMMatrix`, and `GenerationPreview`
  requires the `WorkspaceProvider`).
- **`order` field defined in schema but never exposed/used for sorting** — *low,
  accepted as deferred.* `order` stays in the spec; drag-ordering remains a deferred item
  (see §6).
- **`BookmarkEditor` comment vs object-type design** — *low, no change.* The comment is
  accurate (the editor is for renaming existing bookmarks); no code change needed.
- **Inline marker implementation missing vs. specification** — *high, REJECTED (false
  positive).* Inline bookmark markers **are** implemented via the existing
  anchor-painting path: the bookmark reuses an `html_selection` anchor in `paintAnchors`;
  `DomReader.paintDomAnchors` synthesizes a per-anchor note and
  `decorateAnnotations`/`resolveTargets` applies the inline highlight for **every** anchor
  regardless of note text. No separate marker code is needed. *Minor non-blocking nit:*
  `bookmark.spec.ts` asserts the panel + note-list exclusion + jump, but does not assert
  the inline highlight itself.
