# Dock Layout Engine

How the workspace arranges its panes. Replaces the old "fixed row of columns" shell
with a recursive **dock tree** the `WorkspaceShell` consumes, so panes can nest
(rows inside columns inside rows) — the prerequisite for things like a reader with a
bottom panel, or a left-nav / center / right-tutor student layout.

> Phase 1: the engine + zero-regression rewrite of the existing layouts.
> Phase 2 (now done): pane collapse/expand, a layout switcher, the student layout
> preset, and minimal responsiveness. Both phases are described below.

## Model (`src/client/workspace/dock.ts`)

A `WorkspaceLayout` pairs `nodes` (the view instances, unchanged) with a `layout`
**dock tree**:

```ts
type DockChild = { size?: number | "flex"; node: DockNode };
type DockNode =
  | { type: "split"; direction: "row" | "column"; children: DockChild[] }
  | { type: "leaf"; nodeId: string };   // references a WorkspaceNode in layout.nodes
```

- A `leaf` only references a view instance by `nodeId`; the **ViewRegistry and view
  plugins are untouched** — the dock tree changes *how* panes are arranged, never
  *what* they are.
- `size`: pixels = fixed; `"flex"` (or unset) = absorbs the remaining main-axis space
  (e.g. the `source.viewer` reader).
- `layout.layout` is typed `unknown` in the entity client; `dockRoot()` casts it. No
  core schema change.

Pure helpers (unit-tested in `dock.test.ts`): `isFlexChild`, `childInitialPx`,
`flexFor`, `dockLeafIds`, `clampDockPx`, `gutterTarget`.

**Phase 2 collapse/responsive helpers** (also pure + unit-tested):

- `isCollapsibleLeaf(child, kind)` — a pane is collapsible iff it's a *fixed-size leaf*
  and not the `source.viewer` (the flex reader is the spine; it never collapses).
- `isPaneCollapsed(kind, userCollapsed, viewportWidth)` — effective collapsed state =
  the user's explicit toggle **OR** (on a narrow viewport) a *secondary* side pane
  auto-collapsing. `SECONDARY_KINDS = {library, concept.list, layer.switcher}`;
  `RESPONSIVE_BREAKPOINT_PX = 1280` (so the Playwright/Desktop-Chrome default width of
  1280 stays fully expanded — the rule is `< 1280`).
- `paneCollapseKey(layoutId, nodeId)` — storage key (collapse is scoped per layout+node).
- `paneLabel(node)` — friendly rail/tooltip label (`params.title` → kind→label map → kind).

## Rendering (`WorkspaceShell.tsx`)

The shell renders the tree recursively:

- `split` → a flex container (`flex-direction: row|column`). The **root split IS the
  `.app-shell`** element, so a single-row layout stays flat; nested splits add
  `.dock-split` containers.
- `leaf` → `renderNode(node, ctx)` (the existing ViewRegistry call), wrapped in a
  `.dock-pane` that carries the child's flex sizing.
- Between adjacent children sits a resize gutter — `col-resize` in a row, `row-resize`
  in a column. Dragging it resizes the neighbouring **fixed** pane while the flex child
  absorbs the slack (`gutterTarget` picks which neighbour + the drag sign). Both-fixed
  resizes the right one; both-flex has no handle. Sizes persist to `localStorage`
  (`sv-panel-widths`, keyed by leaf nodeId else tree path).

### Collapse + responsiveness (phase 2)

- Each collapsible expanded pane shows a faint **`.dock-collapse-btn`** chevron pinned
  top-right (absolutely positioned, so it doesn't shift the view DOM — the pane's view
  classes/order are preserved, which is why the unit shell test reads the panel by class,
  not `firstElementChild`).
- A collapsed pane renders **only** a full-height **`.dock-rail`** (a vertical
  `paneLabel` + click-to-expand) and its flex is fixed to `RAIL_PX` (34px). The boundary
  gutter next to a collapsed pane becomes a static `.dock-gap` (no live resize against a
  rail).
- Collapsed flags live in `localStorage` (`sv-pane-collapsed`, keyed by
  `paneCollapseKey`). The live viewport width is tracked via a `resize` listener and fed
  to `isPaneCollapsed`, so secondary panes auto-collapse below 1280px and restore above
  it — without touching the user's explicit toggles.
- **Overflow strategy:** `body` no longer has a fixed `min-width`; instead `.app-shell`
  is `overflow-x: auto` and the reader pane keeps `min-width: 360px`. So when all
  expanded panes exceed the viewport (e.g. five Study Vault panes at 1280px) the shell
  scrolls horizontally instead of crushing the reader; on a genuinely narrow screen the
  secondary panes collapse to rails and the reduced layout fits with no scroll.

### Layout switcher

`presets.ts` exports `LAYOUT_PRESETS` (`studyVaultLayout`, `threePane`,
`studentLearningLayout`), `DEFAULT_LAYOUT_ID`, and `getLayoutPreset(id)`. The active id
lives in `WorkspaceContext` (`activeLayoutId` / `availableLayouts` / `setActiveLayout`,
persisted to `sv-active-layout`). `App.tsx`'s `ActiveWorkspaceShell` reads it and renders
`getLayoutPreset(activeLayoutId)` — no hard-coded layout. The picker is a
`.layout-select` in the reader header (next to the Kit picker).

### Student layout preset

`studentLearningLayout` is the first **nested** preset: the center column is a `column`
split so the reader sits above a **Practice** panel — the bottom-panel case a flat row
can't express:

```
row [ library(260) | column [ source-viewer(flex) / practice(240) ] | study(380) ]
```

`practiceViews.tsx` registers the `practice` view: it filters the shared notes to the
Textbook kit's `textbook.exercise` / `textbook.mistake` content types and renders each
through its existing NoteType plugin — a minimal "what to drill" surface that adds **no
new data path** (Kit iron law: it only reads existing registries).

## Compatibility strategy (zero regression)

The migration keeps **each view's own class/DOM** (`.library-panel`, `.reader-panel`,
`.study-panel`, `.concept-panel`, `.layer-panel`, `.pdf-reader-canvas`, …) — only the
`.app-shell` outer container changed from a CSS grid to a flex dock. The existing
presets (`threePane`, `studyVaultLayout`) are re-expressed as a single-row dock tree, so
the rendered panes, order, and per-pane DOM are unchanged; the full web e2e suite passes
untouched (21/21). The unit shell test was updated to read pane order from the new
`.dock-pane` wrappers.

## Roadmap

- **Phase 1 (done):** dock tree model + recursive render + bidirectional resize +
  presets rewritten, zero visual regression.
- **Phase 2 (done):** pane collapse/expand (chevron + rail), layout switcher UI, the
  student layout preset (`left nav | center [reader / bottom practice] | right tutor`),
  minimal responsiveness (auto-collapse secondary panes below 1280px; replaced the fixed
  `body min-width` with `.app-shell` horizontal scroll + a reader `min-width`).
- **Later:** drag-to-dock / pane reordering, canvas mode.
