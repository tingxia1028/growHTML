# Annotation Surface Architecture

How a passage the user picks in a reader becomes a stored **Anchor**, and how a
stored anchor is painted back as a highlight + note card — across every viewer type
and both capture **modes** (text quote + geometric region).

## Principle: ONE uniform "annotation surface" contract

Selection (READ) and anchor painting (WRITE) are the two directions of the **same**
per-surface seam. There are exactly **three** annotation-capable surfaces (plus the
native `file` iframe, which can't annotate at all). Each surface's *mechanism* is
irreducibly different — a `contentDocument` the host owns vs. an IPC bridge to a
separate `WebContents` vs. a host-page canvas/overlay — but the **contract** the host
drives them through is identical. So the host (`App`/`Workspace`) treats every reader
the same, and adding a new viewer only means writing one adapter.

### The SurfaceReader contract (`src/client/surfaces/types.ts`)

Every reader component accepts the **same** two annotation props (plus its own
source locator: `src` / `url` / `fileUrl` and `sourceId`):

```ts
type PaintAnchor = {            // normalized "what to draw" (WRITE direction)
  id: string;
  anchorKind: "html_selection" | "web_text_quote" | "pdf_selection" | "image_region";
  quote?: string; contextBefore?: string; contextAfter?: string;
  studyId?: string;             // html_selection fast-path locator
  page?: number; rect?: [number, number, number, number];
  note: string;                 // merged note text for the hover card
};
type SurfaceReaderProps = {
  anchors: PaintAnchor[];                  // WRITE: paint the ones this surface understands (filter by anchorKind)
  onSelect: (draft: AnchorDraft) => void;  // READ: emit a normalized AnchorDraft (the quote|region union from FocusContext)
};
```

`anchorsOfKind(anchors, ...kinds)` is the shared filter each adapter uses to take the
subset it paints.

### The host's single orchestration (`src/client/App.tsx`)

- It computes **one** normalized `paintAnchors: PaintAnchor[]` memo for the active
  source — every anchor it has, each carrying its merged note text (from notes) —
  replacing the old per-viewer `webAnchors` / `pdfAnchors` / `imageAnchors` memos.
- It renders whichever reader matches the active source's surface, passing the
  **same** `anchors={paintAnchors}` and `onSelect={focus.setDraft}` to **all** of them.
- It has **no** per-viewer capture/paint logic. There is no `captureWebSelection`,
  `capturePdfSelection`, `captureImageRegion`, `captureLocalHtmlSelection`,
  `bindReaderFrame`, or `decorateNotes` in `App.tsx` — that logic moved **into** each
  surface adapter. The host's only reaction to a draft is an unrelated convenience:
  pre-filling the "Edit source (patch)" textarea from an `html` quote draft.

> **Success test:** `App.tsx` has no surface-specific selection/paint branches.
> Adding a new viewer needs zero `App` changes beyond mapping `source → reader` in
> the render switch.

Selecting never writes to storage — `onSelect` flows into `useFocus().setDraft(draft)`
(`src/client/focus/FocusContext.tsx`); the draft is materialized into a real Anchor
lazily, only when an action needs one (save a note, ask AI, create a patch), via
`useFocus().materializeAnchor()`. `buildAnchorInput(draft)` is the single read-side
normalization (draft → create-anchor request).

## The three surface adapters

The mechanisms stay different — that's irreducible; only the **contract** unifies.

| Surface | Adapter(s) | DOM location | READ mechanism | WRITE mechanism |
| --- | --- | --- | --- | --- |
| **DOM** | `surfaces/DomReader.tsx` | `iframe[title="Source reader"]` (srcDoc) | Owns the iframe's `contentDocument`; listens for `selectionchange`/`mouseup`/`click`/`keyup` and emits `AnchorDraft{mode:"quote",kind:"html",studyId,…}`. | Paints `html_selection` anchors via the `AnnotationRenderer` registry (`annotations.ts` → shared highlight + hover card). |
| **Webview** | `WebviewReader.tsx` (live web), `LocalHtmlReader.tsx` (local HTML) | a `<webview>` (separate `WebContents`) | Host **can't** reach the guest DOM. A guest preload (`electron/webview-preload.ts`) posts selections over `sv:selection`; the shared `bindWebviewSelection` translates them, then `webSelectionToDraft` emits `AnchorDraft{mode:"quote",kind:"web",url}`. | `toWebAnchorMsgs` maps `web_text_quote` anchors → the guest's paint messages; the shared `bindWebviewAnchors` pushes them over `sv:anchors`; the guest paints via `highlightQuote`. |
| **Overlay** | `PdfReader.tsx`, `ImageReader.tsx` | host-page pdf.js `PDFViewer` text layer / `<img>` + overlay | PDF: select text → `AnchorDraft{mode:"quote",kind:"pdf",page,…}`; PDF/image rubber-band → `AnchorDraft{mode:"region",…}` (shared gesture in `surfaces/overlay.ts`). | Paints `pdf_selection` (text highlight or region box) / `image_region` (box) from the `anchors` prop; boxes use the shared `placeRegionBox`. |
| _native `file` iframe_ | — | `iframe[title="PDF reader"]` | **cannot annotate** (Chromium-rendered code/word/transcript). No `anchors`/`onSelect`. | — |

### Webview surfaces: shared layer (`src/client/selection/webviewSelection.ts`)

Both webview readers share one selection/paint layer so neither duplicates it:

- `webviewPreloadUrl()` — the guest preload `file://` url, or `undefined` outside Electron.
- `bindWebviewSelection(webview, onSelection, extraHandler?)` — attaches the guest preload + translates `sv:selection` IPC into `onSelection(selection, pageUrl)`. `extraHandler` lets `WebviewReader` own its extra channels (`sv:ready`, `sv:open-tab`) on the same listener.
- `bindWebviewAnchors(webview, getAnchors)` — pushes anchors over `sv:anchors` on `sv:ready` + `dom-ready`, and returns a `push()` the anchors-changed effect re-calls.
- `normalizeWebSelection(raw)` — pure validation of the cross-IPC payload.
- **Bridge to the uniform contract** (pure, unit-tested): `toWebAnchorMsgs(PaintAnchor[]) → WebAnchorMsg[]` (WRITE) and `webSelectionToDraft(sourceId, selection, url) → AnchorDraft` (READ). The guest IPC shapes stay an implementation detail of this surface.

The **only** real difference between the two webview readers is multi-tab + navbar
(`WebviewReader`) vs. a single fixed page (`LocalHtmlReader`); the URL a draft is
keyed by is a tab url vs. the file's `/api/local` url, passed in by the reader.

### Local-HTML text-quote anchoring decision

Local HTML is stored **raw** with NO `data-study-id` injection (`src/server/localFiles.ts`)
— served straight from its original directory via `/api/local/<path>` so its relative
assets resolve. Therefore its selections **cannot** be `html_selection` anchors (those
need injected study-ids). Instead both webview readers emit `kind:"web"` quote drafts
keyed by a URL, so they materialize as `web_text_quote` anchors — reusing the same W3C
TextQuoteSelector infra (`buildAnchorInput` maps `kind:"web"` → `web_text_quote` with
`normalizedUrl = url`).

## Two capture MODES — anchors are not text-only

`AnchorDraft` is a discriminated union on `mode`:

```ts
type QuoteAnchorDraft  = { mode:"quote";  sourceId; kind:"html"|"web"|"pdf"; quote; prefix?; suffix?; studyId?; selector?; page?; url? };
type RegionAnchorDraft = { mode:"region"; sourceId; kind:"pdf"|"image";       rect:[x,y,w,h]; page?; url? };
type AnchorDraft = QuoteAnchorDraft | RegionAnchorDraft;
```

`kind` is the *surface*; `mode` is *what was captured on it*. `buildAnchorInput(draft)`
(pure, unit-tested) maps a draft to the create-anchor request:

| mode + kind | → anchorKind | payload |
| --- | --- | --- |
| quote + html | `html_selection` | `studyId, selector, quote, contextBefore/After` |
| quote + web | `web_text_quote` | `normalizedUrl = url, quote, ctx` |
| quote + pdf | `pdf_selection` | `page, quote, ctx` |
| region + pdf | `pdf_selection` | `page, rect, quote:""` |
| region + image | `image_region` | `rect` (quote empty) |

### Region capture gesture (shared: `src/client/surfaces/overlay.ts`)

- **PDF** (`PdfReader`): renders with pdf.js's own ready-made **`PDFViewer`** component (`pdfjs-dist/web/pdf_viewer.mjs` — wired with an `EventBus` + `PDFLinkService`), which owns **virtualized scrolling, zoom, search, page nav** *and* the selectable text layer. The scroll root is an `overflow:auto`, absolutely-positioned container (PDFViewer asserts the container is absolutely positioned) wrapping the `.pdfViewer` div; on `pagesinit` we set `currentScaleValue = "page-width"` so it fits and scrolls. (This replaced an earlier hand-rolled eager-render loop that had lost its scroll wheel.) A `Text | Region` toggle lives in the reader toolbar. In **Region** mode the text layer is click-through and dragging on a page draws a marquee; on release `normalizeDragRect` produces the normalized rect `[x,y,w,h]` (0..1 within that page) + page → a `pdf_selection` region (empty quote).
  - **Painting survives virtualization:** PDFViewer only materializes a `.page[data-page-number="N"]` (with its `.textLayer`) once that page scrolls into view, so anchors are **(re)painted on every `pagerendered`**, after `scalechanging` (zoom re-lays-out the text layer), and whenever the `anchors` prop changes — painting only onto the pages currently present; each page repaints itself as it renders. The repaint is idempotent (it clears its own marks first). Region boxes are placed with the rect **normalized to the page box** (percent offsets), so they stay correct across zoom.
- **Image** (`ImageReader`): images render as a host-page `<img>` (viewer kind `image`, not the native `file` iframe). Dragging rubber-bands a rect → an `image_region` anchor.
- `isRealRegion` rejects sub-threshold stray clicks; `placeRegionBox` draws a saved region as an absolutely-positioned box that hooks the shared note card (`applyHighlight`).
- **Local HTML / live web region selection is intentionally deferred** — text-quote is sufficient there this round.

## Shared presentation (`src/client/annotationLayer.ts`)

Resolving an anchor to a target is each surface's job; the **look** is not. Once an
adapter has the element + note text it calls `applyHighlight(el, note, key)` (or
`highlightQuote(doc, selector, note, key)` to re-find by text), and the shared,
framework-free layer paints the highlight and the single draggable/resizable hover
**note card** (shown on hover, pinned on click, geometry persisted per anchor id). It
runs equally in the main document, inside the reader iframe, and injected into the
webview guest — so adding a viewer never re-implements the card UI.

## Server API (`src/server/app.ts`)

`createAnchorRequestSchema`: `anchorKind` includes `image_region`; `rect` optional;
`quote` optional (defaults `""`) with a `.refine()` requiring **either** a non-empty
quote **or** a rect; `pdf_selection` passes `rect` through; `image_region` creates via
`createImageRegionAnchor` (`src/adapters/image/anchor.ts`). `POST /api/sources/image`
seeds an image source from base64 bytes (parallels `/api/sources/pdf`).

## Test matrix (per surface × mode)

Real tests only. "Verified e2e" = driven through the running app; "unit" = vitest.

| Surface × mode | Coverage | Where |
| --- | --- | --- |
| **contract — filtering** | unit (`anchorsOfKind`) | `src/client/surfaces/types.test.ts` |
| **contract — read normalization** | unit (`buildAnchorInput`, all 5 mode×kind) | `src/client/focus/FocusContext.test.ts` |
| DOM — quote (read) | unit (`readDomSelection`: study-id hit, no-hit null, click fallback, selector escaping) + **e2e** | `surfaces/DomReader.test.ts`; `e2e/loop.spec.ts`, `e2e-electron/app.spec.ts` |
| DOM — paint (write) | unit (`paintDomAnchors`: filters to `html_selection`, merges, idempotent) + **e2e** (`.sv-annotated`) | `surfaces/DomReader.test.ts`; `e2e/loop.spec.ts`, `e2e-electron/app.spec.ts` |
| Webview — quote (read) | unit (`webSelectionToDraft`, `normalizeWebSelection`, `bindWebviewSelection`) + **e2e** wiring | `selection/webviewSelection.test.ts`; `e2e-electron/{webview,local-html}.spec.ts` |
| Webview — paint (write) | unit (`toWebAnchorMsgs`, `bindWebviewAnchors` send behavior; guest `highlightQuote`) + **e2e SCREENSHOT** | `selection/webviewSelection.test.ts`, `annotationDom.test.ts`; `e2e-electron/local-html-highlight.spec.ts` |
| Overlay — region gesture | unit (`normalizeDragRect`, `isRealRegion`, `placeRegionBox`) | `surfaces/overlay.test.ts` |
| PDF — scroll (PDFViewer) | **e2e (web)** — scroll container scrolls + a later page pages in | `e2e/regions.spec.ts` |
| PDF — quote / region | **e2e (web)** + unit (mapping) | `e2e/regions.spec.ts`, `FocusContext.test.ts`, `app.test.ts` |
| image — region | **e2e (web)** | `e2e/regions.spec.ts` |
| native file (code/word) | routing invariant **e2e (web)** | `e2e/regions.spec.ts` (image uses ImageReader, never the native iframe) |
| shared note card | unit (hover/show, geometry persist, clamp) | `annotationDom.test.ts` |
| server anchor API | unit | `app.test.ts` |

### Webview-guest highlight: verified by SCREENSHOT (pixels)

The webview highlight is painted **inside** the guest, a separate `WebContents` the
host page cannot DOM-query — DOM-query across the webview boundary isn't available.
But the guest is **composited into the host window**, so its rendered **pixels** are
captured by `page.screenshot()`, and the highlight is **host-triggered** (the host
seeds an anchor+note via the API, opens the source, and pushes `sv:anchors`). So
`e2e-electron/local-html-highlight.spec.ts` seeds a local HTML source + a
`web_text_quote` anchor (keyed by its `/api/local` url) + a note, opens it, polls a
screenshot until the highlight color appears in the passage region, and asserts both
(A) highlight-yellow pixels appear there and (B) a meaningful pixel diff vs. an
identical **no-anchor control** page localized to the passage. Observed:
`yellow before=521 after=14286; changed px in passage=17054` — a clear, large signal.

**Hover note-card (best effort):** the spec also moves the host mouse over the
highlight and looks for the card via a pixel diff in the band below the line. In this
environment the card did **not** surface to a screenshot (`hover note-card observable:
false, diff px=0`) — the spec **logs** this and does not fail on it (the card's
hover/show logic is unit-covered in `annotationDom.test.ts`). Synthesizing a real text
**selection** inside a guest still isn't reliably scriptable from the host (see the
`[local-html] guest selection → chip observable: false` log in `local-html.spec.ts`),
so the read direction for webviews is covered by wiring + unit tests; the write
direction is covered by the screenshot above. We never fake a passing assertion.

### Gate (this change)

`npx tsc --noEmit` clean · `npm test` (vitest) **198** green · `npx playwright test
--config=playwright.config.ts` **7** green (incl. the PDFViewer **scroll** regression
+ PDF quote + PDF region against the new `.page[data-page-number]`/`.textLayer` DOM) ·
`npx playwright test --config=playwright.electron.config.ts` **5** green (incl. the
local-HTML highlight SCREENSHOT). The web e2e vault is wiped before each run by
`e2e/global-setup.ts`.
