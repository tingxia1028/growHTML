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

> **Wiring invariant — set `preload` BEFORE `appendChild`.** An Electron `<webview>`
> starts loading its guest the moment it's attached to the DOM, and the `preload`
> attribute is only honored if it's already set at that point. So both readers must
> set the preload (via `bindWebviewSelection`) **before** appending the element.
> `LocalHtmlReader` always did; `WebviewReader` used to `appendChild` first and bind
> after — so **live web pages loaded with no selection-capture preload**, and
> selecting text produced no `sv:selection`, no chip, and therefore no anchor. That
> was the reported "selecting in a LIVE HTML source doesn't produce an anchor" bug.
> Fixed by reordering `WebviewReader` so `appendChild` is the **last** step (after the
> preload + all listeners are attached). Proven by `e2e-electron/viewer-flows.spec.ts`,
> which drives a real guest selection and asserts the host chip + the created anchor.

### Guest selection capture is text-driven, not offset-sliced

The guest preload's `reportSelection` (`electron/webview-preload.ts`) takes the exact
quote straight from `window.getSelection().toString()` and reads prefix/suffix context
off the DOM by collapsing a clone of the range to its start/end and extending it to the
common ancestor's text (`contextAround`). It does **not** slice the container's
`textContent` by `range.startOffset`/`endOffset` — those are **child-node indices**
when the selection's start/end container is an element (e.g. a `selectNodeContents`
selection, or any drag spanning element boundaries), not character offsets, so the old
offset-slice collapsed such a selection to a **single character** (it reported `"P"`
for a whole `"PASSAGE …"` paragraph). The text-driven approach is correct for both
text-node and element-node containers.

### Local-HTML text-quote anchoring decision

Local HTML is stored **raw** with NO `data-study-id` injection (`src/server/localFiles.ts`)
— served straight from its original directory via `/api/local/<path>` so its relative
assets resolve. Therefore its selections **cannot** be `html_selection` anchors (those
need injected study-ids). Instead both webview readers emit `kind:"web"` quote drafts
keyed by a URL, so they materialize as `web_text_quote` anchors — reusing the same W3C
TextQuoteSelector infra (`buildAnchorInput` maps `kind:"web"` → `web_text_quote` with
`normalizedUrl = url`).

> **Blank-URL fallback (defensive).** The URL a web/local draft is keyed by comes from
> `webview.getURL()`, which can return an **empty/whitespace** string before the guest
> attaches. A blank string is *not* nullish, so `draft.url ?? draft.normalizedUrl` used
> to keep it and the request carried `normalizedUrl: ""`. That empty string then (a)
> fails the server's `z.string().min(1)` → **400** and (b) blocks the server's
> `?? source.metadata.normalizedUrl` fallback (again `""` isn't nullish), so **no
> anchor was created**. `buildAnchorInput` now trims the url and coalesces blank →
> `undefined`, so an unknown page url falls through to the source's stored
> `normalizedUrl` (set by `ingestWebLiveSource`) instead. Unit-covered in
> `src/client/focus/FocusContext.test.ts`. (In the e2e the live page's `getURL()` is
> non-empty, so the primary fix is the preload-ordering one above; this is belt-and-
> braces for the racey window and is the narrowest server-side contract guard.)

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

## Test matrix — the FULL basic study flow, per viewer × step

The basic study flow each annotatable viewer must support: **select a passage → the
host "Source" chip (`.chat-source`) fills → save a Note → the note appears in
`.note-list` AND an anchor was actually created (asserted via
`GET /api/sources/:id/anchors`, the right `anchorKind`) → the saved note PAINTS as a
highlight on the passage**. The matrix below marks each viewer×step:

- ✓ = verified by a real test driven through the running app (or a real DOM/unit test
  that exercises the exact code path).
- ⚠ = covered only by a screenshot-pixel signal or a unit test (the host can't DOM-query
  the assertion); logged, not asserted, where the environment can't surface it.

| Viewer | select → chip | note → **anchor created** | highlight paints | hover note-card | Driven by |
| --- | --- | --- | --- | --- | --- |
| **Imported HTML** (DomReader srcDoc iframe) | ✓ | ✓ `html_selection` | ✓ `.sv-annotated` in iframe | ✓ (host DOM) | `e2e/viewer-flows.spec.ts`, `e2e/loop.spec.ts`, `e2e-electron/app.spec.ts` |
| **PDF** (pdf.js PDFViewer) | ✓ | ✓ `pdf_selection` (text **and** region) | ✓ `.sv-annotated` / region box | ✓ (host DOM) | `e2e/viewer-flows.spec.ts` (text quote), `e2e/regions.spec.ts` (region) |
| **Live HTML / web-live** (`<webview>`, WebviewReader) | ✓ (real guest selection) | ✓ `web_text_quote` | ⚠ screenshot pixels | ⚠ screenshot (not observable here) | `e2e-electron/viewer-flows.spec.ts` |
| **Local HTML / native** (`<webview>`, LocalHtmlReader) | ✓ (real guest selection) | ✓ `web_text_quote` | ⚠ screenshot pixels | ⚠ screenshot (not observable here) | `e2e-electron/viewer-flows.spec.ts`, `e2e-electron/local-html-highlight.spec.ts` |

Supporting unit + invariant coverage (real tests only):

| Surface × mode | Coverage | Where |
| --- | --- | --- |
| **contract — filtering** | unit (`anchorsOfKind`) | `src/client/surfaces/types.test.ts` |
| **contract — read normalization** | unit (`buildAnchorInput`, all 5 mode×kind + blank-url fallback) | `src/client/focus/FocusContext.test.ts` |
| DOM — quote/paint (read/write) | unit (`readDomSelection`, `paintDomAnchors`) | `surfaces/DomReader.test.ts` |
| Webview — quote/paint (read/write) | unit (`webSelectionToDraft`, `normalizeWebSelection`, `bindWebviewSelection`, `toWebAnchorMsgs`, `bindWebviewAnchors`; guest `highlightQuote`) | `selection/webviewSelection.test.ts`, `annotationDom.test.ts` |
| Overlay — region gesture | unit (`normalizeDragRect`, `isRealRegion`, `placeRegionBox`) | `surfaces/overlay.test.ts` |
| PDF — scroll (PDFViewer) | **e2e (web)** — scroll container scrolls + a later page pages in | `e2e/regions.spec.ts` |
| image — region | **e2e (web)** (select→chip→note→`image_region` anchor→region box) | `e2e/regions.spec.ts` |
| native file (code/word) | routing invariant **e2e (web)** | `e2e/regions.spec.ts` (image uses ImageReader, never the native iframe) |
| shared note card | unit (hover/show, geometry persist, clamp) | `annotationDom.test.ts` |
| server anchor API | unit (incl. `web_text_quote` normalizedUrl from metadata fallback) | `app.test.ts` |

### Driving a REAL selection INSIDE a `<webview>` guest (the technique)

Earlier notes assumed a guest selection "isn't reliably scriptable from the host." It
**is** — the same way the PDF text-layer e2e does it. The `<webview>` element exposes
`executeJavaScript(code)` that runs **in the guest**, where the guest preload listens
for `mouseup`. So the e2e:

1. `webview.executeJavaScript(...)` finds a known text node, builds a `Range`
   (`selectNodeContents`), `getSelection().removeAllRanges()/addRange()`, then
   dispatches **`new MouseEvent('mouseup', { bubbles: true })`** (the bubbling
   `MouseEvent` is what the earlier `new Event('mouseup')` attempt got wrong).
2. That fires the guest preload's `reportSelection` → `sv:selection` IPC → host
   `bindWebviewSelection` → `focus.setDraft` → the **host** `.chat-source` chip.
3. The chip + note list live in the **host DOM**, so Playwright asserts them directly
   even for a webview source; the created anchor is asserted via the API; the highlight
   is asserted via screenshot pixels (below). `e2e-electron/viewer-flows.spec.ts` does
   exactly this for **both** webview viewers and passes — it's the permanent proof that
   live-HTML and local-HTML select→chip→note→**anchor**→highlight all work.

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

`e2e-electron/viewer-flows.spec.ts` now also captures the highlight this way for
**both** webview viewers after driving a real guest selection + saving a note through
the UI (observed `highlight yellow px=8373` for each). So the WRITE direction is
verified both host-triggered (`local-html-highlight.spec.ts`) and via the full
user-driven flow (`viewer-flows.spec.ts`).

**Hover note-card (best effort):** the specs also move the host mouse over the
highlight and look for the card via a pixel diff in the band below the line. In this
environment the card does **not** surface to a screenshot (`hover note-card observable:
false, diff px=0`) — the specs **log** this and do not fail on it (the card's hover/show
logic is unit-covered in `annotationDom.test.ts`). The READ direction (a real text
**selection** inside a guest) **is** now driven from the host via the
`executeJavaScript` + bubbling-`MouseEvent` technique above and asserted by the host
chip + created anchor — the earlier "not reliably scriptable" caveat is retired. We
never fake a passing assertion.

### Gate (this change)

`npx tsc --noEmit` clean · `npm test` (vitest) **200** green (+2: the `buildAnchorInput`
blank-url fallback) · `npx playwright test --config=playwright.config.ts` **9** green
(incl. the new imported-HTML + PDF-text-quote full-flow tests with explicit anchor
assertions) · `npx playwright test --config=playwright.electron.config.ts` **7** green
(incl. the new live-HTML + local-HTML full-flow tests that drive a REAL guest selection
→ chip → note → `web_text_quote` anchor → highlight). The web e2e vault is wiped before
each run by `e2e/global-setup.ts`.

### Bugs found + fixed this change

1. **Live-HTML "no anchor" (the reported bug) — `WebviewReader` attached `preload`
   after `appendChild`.** The guest started loading before the selection-capture
   preload was set, so live pages never reported selections → no chip → no anchor.
   Fixed by appending the `<webview>` **last** (after preload + listeners). `LocalHtml
   Reader` was already correct. Proof: `e2e-electron/viewer-flows.spec.ts` live test.
2. **Guest preload collapsed element-spanning selections to one character.**
   `reportSelection` sliced the container's `textContent` by `range.startOffset`/
   `endOffset`, which are child-node indices for element containers. Now it takes the
   exact text from `selection.toString()` and reads context off the DOM
   (`contextAround`). Proof: the same e2e (chip showed the full passage, not `"P"`).
3. **Blank `getURL()` → `normalizedUrl: ""` → server 400 (defensive).**
   `buildAnchorInput` now trims and coalesces a blank web-draft url to `undefined` so
   the server falls back to the source's stored `normalizedUrl`. Unit-covered in
   `FocusContext.test.ts`.
