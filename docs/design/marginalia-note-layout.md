# Marginalia note layout — Floating ↔ Margin (HTML reader)

A second **presentation** for stored notes in the imported-HTML reader, toggled
from the reader header:

- **Floating** (default, unchanged): inline highlight + a single draggable card
  that pops on hover / pins on click.
- **Margin**: inline highlight **+** persistent cards stacked in a right-hand
  gutter, collision-resolved, each connected to its anchor by a dashed SVG leader,
  with the page body reserving right padding so the original text is never covered.

It is purely a different **look** over the same anchors/notes — no new data, no
schema change. Ported from commit `a210c06` (`Add marginalia note layout`) and
adapted to this branch's node-ified workspace + plural-`anchorIds` note shape.

## What it is

```
  ┌──────────────────────────────┬───────────────┐
  │ …the rendered HTML body…      │  ┌─────────┐  │
  │  a [highlighted] passage ─────┼─╌╌┤ note A  │  │   gutter
  │                               │  └─────────┘  │   (300px, body
  │  another [highlight] ─────────┼─╌╌┌─────────┐ │    reserves
  │                               │   │ note B  │ │    right padding)
  │                               │   └─────────┘ │
  └──────────────────────────────┴───────────────┘
       body.sv-annot-margin          #sv-margin-layer
                                      #sv-margin-connectors (dashed leaders)
```

The inline highlight (`.sv-annotated`) is painted in **both** modes, so the reader
always sees what is annotated; margin mode just adds the gutter cards and turns the
hover/click floating card **off** (guarded by `body.classList.contains("sv-annot-margin")`).

## The toggle and where the mode lives

| Concern | Where |
| --- | --- |
| **Mode state** (`"floating" \| "margin"`) | `WorkspaceContext` — `annotationMode` + `setAnnotationMode`. Seeded from `localStorage` via `readStoredAnnotationMode()`; the setter mirrors it back with `persistAnnotationMode()` (key `sv-annotation-mode`). Survives reload. |
| **Toggle button** | The reader header rendered by the `source.viewer` view (`src/client/workspace/views.tsx`, inside `.reader-header` → `.reader-header-actions`). Class `.annot-mode-toggle`, label `Notes: Floating` / `Notes: Margin`. **Not** in `App.tsx` — the header is node-ified here. |
| **Threading to paint** | `views.tsx` → `readerForSource({ …, annotationMode })` → `<DomReader mode=… />` → `paintDomAnchors(doc, anchors, mode)` → `decorateAnnotations(doc, { …, mode })`. The renderer's `paint(doc, items, mode)` branches on it. |
| **Repaint on change** | `DomReader`'s paint `useEffect` lists `mode` in its deps, so toggling re-decorates the iframe immediately (mirrors `a210c06`'s `useEffect`-on-mode dep). |

`decorateAnnotations` takes the mode **in its context** (`{ mode }`), defaulting to
`"floating"` when omitted — the React layer owns the live state, the paint layer
stays a pure function of its input (no hidden module-level toggle).

## The pieces (paint layer)

All in `src/client/annotationLayer.ts` (framework-free; runs in the iframe realm):

- **`packColumn(items, gap, minTop, maxBottom?)`** — pure, deterministic stacking:
  greedily place each card at `max(desiredTop, cursor)` in top-order, then if the
  column overflows `maxBottom`, compact upward from the bottom. Returns resolved
  tops in input order. This is the unit-testable core (jsdom can't measure real
  geometry).
- **`paintMarginNotes(doc, items)`** — builds `#sv-margin-layer` (the gutter), one
  `.sv-margin-note` per item (markdown-rendered body, `data-sv-key` = anchor id),
  runs `packColumn` over the measured card heights, and draws one elbow `path` per
  card into `#sv-margin-connectors`. Adds `body.sv-annot-margin` (reserves
  `padding-right`) and ensures the body is positioned so the absolute layer anchors
  to it. Re-runnable (clears first).
- **`clearMarginNotes(doc)`** — removes the layer, the connectors, the class, and
  restores the saved `body.style.position`.

`src/client/annotations.ts` (the `AnnotationRenderer` registry): the built-in
`htmlHighlightRenderer` now resolves anchors via a shared `resolveTargets()` helper
(study-id fast path, else edit-resilient `highlightQuote` re-find), applies the
inline highlight, and — when `mode === "margin"` — feeds the resolved targets to
`paintMarginNotes`. Its `clear()` also calls `clearMarginNotes` so switching modes
leaves no stale gutter.

## Scope — DOM-iframe HTML reader only

Marginalia is wired **only** into the surface the `AnnotationRenderer` registry
paints: the imported-HTML pipeline shown in an iframe whose `contentDocument` the
host owns (`DomReader`). Concretely the toggle is shown when
`activeViewer.htmlPipeline && !activeFilePath` — the same gate `readerForSource`
uses to pick `DomReader`.

Out of scope this round (each keeps its **current** floating/own painting):

- **Webview** (live web + **local** HTML) — paints in a separate WebContents via the
  guest preload; the toggle is hidden for local-file HTML (it has `activeFilePath`).
- **PDF.js / image** — overlay surface; not registry-painted.

So toggling never affects those surfaces, and they never see a margin layer. This is
intentional and low-risk: the floating path is byte-identical when `mode==="floating"`,
which is the default, so every existing reader behaves exactly as before.

## Test matrix

| Level | File | Asserts |
| --- | --- | --- |
| unit (pure) | `src/client/annotationDom.test.ts` → `packColumn` | no-collision passthrough, push-down by height+gap, minTop + out-of-order, upward compaction on overflow. |
| unit (DOM/jsdom) | `src/client/annotationDom.test.ts` → `paintMarginNotes` | gutter + one card per item (markdown rendered, `data-sv-key`), connectors count, `clearMarginNotes` teardown, `decorateAnnotations({ mode:"margin" })` lays cards while keeping the inline highlight, idempotent repaint, margin→floating clears the gutter. |
| unit (surface seam) | `src/client/surfaces/DomReader.test.ts` → `paintDomAnchors` | default floating = no `#sv-margin-layer`; `mode:"margin"` = gutter card with the note text; back to floating clears it. |
| web e2e | `e2e/loop.spec.ts` → "marginalia: toggle …" | seed HTML → save note → toggle reads `Notes: Floating`, no gutter → click → `Notes: Margin`, `.sv-margin-note` with the text, one `#sv-margin-connectors path`, `body.sv-annot-margin` → toggle back → gutter gone, inline highlight stays, floating hover card still shows. Uses the real ported classes. |

Default mode stays **floating**, so `loop.spec`'s existing hover-card assertions and
all other web (13) / electron (8) e2e pass unchanged on their original selectors.

Gate at port time: tsc clean; vitest 255 (was 245, +10); web playwright 14 (13 + the
new marginalia test); electron playwright 8.
