# Selection & Anchoring Architecture

How a passage the user picks in a reader becomes a stored **Anchor**, across every
viewer type and both capture **modes** (text quote + geometric region).

## Principle: selection is a property of the SURFACE, not the viewer

A "selection" is captured differently depending on the *rendering surface*, but it
always flows into ONE sink: `useFocus().setDraft(draft: AnchorDraft)`
(`src/client/focus/FocusContext.tsx`). Nodes never talk to each other; they collaborate
through focus. Selecting never writes to storage — the draft is materialized into a real
Anchor lazily, only when an action needs one (save a note, ask AI, create a patch), via
`useFocus().materializeAnchor()`.

There are three selection-capable surfaces (plus one that can't select):

| Surface | DOM location | How selection is captured | Used by |
| --- | --- | --- | --- |
| **dom-iframe** | `iframe[title="Source reader"]` (srcDoc) | Host attaches `selectionchange`/`mouseup`/`click`/`keyup` to the iframe's `contentDocument` (`bindReaderFrame` in `App.tsx`) — it owns that document. | Imported HTML / markdown / webpage (the HTML study pipeline) |
| **electron-webview** | a `<webview>` (separate WebContents) | Host **can't** reach the guest DOM. A guest **preload** (`electron/webview-preload.ts`) runs inside the webview, listens for selections, and posts them to the host over the `sv:selection` IPC channel as a W3C TextQuoteSelector. | live web (`WebviewReader`) **and** local HTML files (`LocalHtmlReader`) |
| **pdf-text-layer** | pdf.js text layer in the host page (`PdfReader`) | Host listens on its own `.textLayer` (`mouseup`), plus a rubber-band region gesture. | PDFs |
| **image overlay** | host-page `<img>` + overlay (`ImageReader`) | Rubber-band region gesture (no text). | images |
| _native `file` iframe_ | `iframe[title="PDF reader"]` | **cannot select** (Chromium-rendered code/word/transcript). No capture — expected. | code / word / transcript |

### The unified webview selection layer

Both webview surfaces (live web + local HTML) used to be separate; selection capture
was duplicated. It now lives once in `src/client/selection/webviewSelection.ts`:

- `webviewPreloadUrl()` — the guest preload `file://` url (`window.studyVault?.webviewPreloadUrl`), or `undefined` outside the desktop app.
- `bindWebviewSelection(webview, onSelection, extraHandler?)` — attaches the guest preload to the element and translates its `sv:selection` IPC messages into `onSelection(selection, pageUrl)` calls. Returns a disposer. `extraHandler` lets `WebviewReader` handle the extra channels it owns (`sv:ready`, `sv:open-tab`) on the same single `ipc-message` listener.
- `normalizeWebSelection(raw)` — pure, unit-tested validation of the cross-IPC payload → `WebSelection | null` (rejects blank/missing/non-object).

`WebviewReader` and `LocalHtmlReader` both call `bindWebviewSelection`; `App.tsx` wires
each reader's `onSelection` into `focus.setDraft(...)`.

### The bug this fixed

`LocalHtmlReader` (local `.html` files) rendered in a `<webview>` but never attached the
guest preload, so selecting text did nothing — no source chip, no Ask AI / note. The fix
gives it the same shared capture path as the live-web webview.

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

### Local-HTML text-quote anchoring decision

Local HTML is stored **raw** with NO `data-study-id` injection (`src/server/localFiles.ts`)
— it's served straight from its original directory via `/api/local/<path>` so its relative
assets resolve. Therefore its selections **cannot** be `html_selection` anchors (those need
injected study-ids). Instead they are emitted as `kind:"web"` quote drafts keyed by the
file's local URL (`localFileUrl(originalPath)` in `App.tsx`), so they materialize as
`web_text_quote` anchors — reusing the same W3C TextQuoteSelector infra as live web pages
(`buildAnchorInput` maps `kind:"web"` → `web_text_quote` with `normalizedUrl = url`).

### Region capture gesture

- **PDF** (`PdfReader`): a `Text | Region` toggle in the reader toolbar. In **Region** mode the text layer is made click-through and dragging on a page draws a marquee; on release the normalized rect `[x,y,w,h]` (0..1 within that page) + page number become a `pdf_selection` region (empty quote). Text mode keeps the existing text-quote selection.
- **Image** (`ImageReader`): images render as a host-page `<img>` (a new viewer kind `image`, registered in `src/client/viewers.ts`, instead of the native `file` iframe which can't be overlaid). Dragging anywhere on the image rubber-bands a rect → an `image_region` anchor.
- Saved regions are drawn back as boxes (`.pdf-region-box` / `.image-region-box`) that hook the same shared floating note card as every other surface (`applyHighlight`).
- **Local HTML / live web region selection is intentionally deferred** — text-quote is sufficient there this round.

## Server API (`src/server/app.ts`)

`createAnchorRequestSchema`:
- `anchorKind` enum now includes `image_region`.
- `rect: [number,number,number,number]` optional.
- `quote` is now optional (defaults `""`); a `.refine()` requires **either** a non-empty quote **or** a rect.
- `pdf_selection` passes `rect` through (`createPdfSelectionAnchor` already accepts it).
- `image_region` has a creation path via `createImageRegionAnchor` (`src/adapters/image/anchor.ts`), mirroring the pdf adapter.
- `POST /api/sources/image` seeds an image source from base64 bytes (parallels `/api/sources/pdf`), used by tests and programmatic import.

`entityClient.CreateAnchorInput` gained `rect` + `image_region`; `PdfAnchor` gained optional
`rect`; new `ImageAnchor` type.

## Test matrix

Real tests only. "Verified e2e" = driven through the running app; "unit" = vitest.

| Viewer × mode | Coverage | Where |
| --- | --- | --- |
| imported HTML — quote | **e2e (web)** | `e2e/loop.spec.ts` (select → chip → note → highlight → patch → persist) |
| PDF — quote | unit (mapping) + exercised by region e2e harness | `FocusContext.test.ts`, `app.test.ts` (`pdf_selection by page+quote`) |
| PDF — region | **e2e (web)** | `e2e/regions.spec.ts` (drag region → `pdf_selection` w/ rect + box) |
| image — region | **e2e (web)** | `e2e/regions.spec.ts` (drag region → `image_region` + box) |
| native file (code/word) | routing invariant **e2e (web)** | `e2e/regions.spec.ts` (image uses ImageReader, never native iframe; native-file path has no web seed) |
| live web — quote | **e2e (electron)** wiring + unit | `e2e-electron/webview.spec.ts` (webview + preload), `webviewSelection.test.ts` |
| local HTML — quote | **e2e (electron)** wiring + unit | `e2e-electron/local-html.spec.ts` (webview + preload attached), `webviewSelection.test.ts`, `FocusContext.test.ts` (local-file web_text_quote mapping) |
| desktop shell smoke | **e2e (electron)** | `e2e-electron/app.spec.ts` (seed → select → note → overlay → chat) |
| server anchor API | unit | `app.test.ts` (web/pdf/pdf-region/image-region create; reject empty-quote-without-rect, missing page, missing rect) |
| sv:selection normalization + binding | unit | `src/client/selection/webviewSelection.test.ts` |
| buildAnchorInput all modes | unit | `src/client/focus/FocusContext.test.ts` |

### Documented limitation: webview-guest selection in e2e

Playwright **cannot reliably synthesize a real text selection INSIDE an Electron
`<webview>` guest** — it's a separate WebContents the host page can't script, and
`executeJavaScript` + a synthetic `mouseup` in the guest does not surface to the host in
this environment (observed: chip not produced; see the `[local-html] guest selection → chip
observable: false` log in `e2e-electron/local-html.spec.ts`). So the two webview surfaces
(live web, local HTML) are covered e2e by asserting the capture **wiring** (the guest
preload is attached), and the selection → `AnchorDraft` logic is covered by the vitest unit
tests above. We do not fake a passing selection.

### Gate

`npx tsc --noEmit` clean · `npm test` (vitest) green (169) · `npx playwright test
--config=playwright.config.ts` green (5). The web e2e vault is wiped before each run by
`e2e/global-setup.ts` so a stale accumulated vault can't make the "first source" default
point at the wrong document.
