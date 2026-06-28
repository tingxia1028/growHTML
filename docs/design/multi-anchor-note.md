# Multi-anchor note UX — V1

**Status: Implemented (V1).**

## Premise

A note can already hang off several passages: `NoteRecord.anchorIds` is a list,
not a single id, and the paint pipeline (`groupForRenderer`) already groups one
note under *every* anchor it references. The data model has always allowed it —
what was missing was the UX to (a) attach an existing note to a second passage
and (b) show/navigate a note that lives in more than one place. V1 is **pure UX
over data the layer already supports: zero schema change.**

## What shipped

### 1. `note.link-anchor` command — link a note to another passage

A new command (`src/client/commands/registry.ts`) that materializes the current
selection into an anchor — the *same* `focus.materializeAnchor()` path that
`anchor.add-note` and `bookmark.add` use — and **appends** that anchor's id to
the target note's `anchorIds` via a full-array `updateNote`, then calls
`onNoteCreated` so the host re-fetches and repaints. The target note is the card
the user clicked (`payload.noteId`).

Concurrency-safe append (review finding 1, fixed): the append base is read
**fresh** from the server (`ctx.client.notes(ctx.sourceId)`, then
`find(id === noteId)`) immediately before writing — *not* the
`payload.noteAnchorIds` snapshot the card captured at render time. Two rapid
link dispatches against a stale snapshot would each append to the same old list
and the second write would clobber the first's new anchor. The payload snapshot
is kept only as a fallback when the note can't be resolved fresh (no active
source, note absent from the list, or `notes()` throws). The new anchor is
deduped against the fresh list.

### 2. Multi-anchor painting

No new code path: because a note carries all its anchor ids and
`groupForRenderer` already maps a note to each, once `link-anchor` adds an
anchor the note paints at the new passage on the next repaint. Locked in by a
unit test in `annotations.test.ts` ("paints a single multi-anchor note under
EVERY anchor it claims").

### 3. "Anchored at N places" card + jump-between

`NoteAnchorControl` (`src/client/workspace/noteAnchorControl.tsx`, rendered per
note in `StudyView`):

- **"Link to selection"** button, always shown, disabled until a passage is
  focused (saved anchor or fresh draft). Dispatches `note.link-anchor`.
- When the note has **> 1** anchors: a `MapPin` "Anchored at N places"
  indicator plus **one jump button per anchor**. Each jump resolves its anchor
  record from `ctx.anchors` and calls `focus.setAnchor` (mirrors the bookmark
  jump); the button is **disabled** when layer painting filtered that anchor out
  of the visible set. A single-anchor note shows only the link button, so
  existing cards are unchanged but for the new affordance.

Kept in its own module (not `views.tsx`) so it's testable without pulling in the
heavy pdfjs reader surfaces.

## Files changed

`git diff HEAD --stat` (feature-relevant):

```
 e2e/multi-anchor.spec.ts                        | 136 ++++ (new)
 src/client/annotations.test.ts                  |  13 ++
 src/client/commands/registry.test.ts            |  71 +++
 src/client/commands/registry.ts                 |  50 +-
 src/client/styles.css                           |  45 ++
 src/client/workspace/noteAnchorControl.test.tsx | 136 ++++ (new)
 src/client/workspace/noteAnchorControl.tsx      |  82 +++ (new)
 src/client/workspace/views.tsx                  |  11 +
```

New files (were untracked, now **staged, not committed** — review findings 2 & 3):
`src/client/workspace/noteAnchorControl.tsx`,
`src/client/workspace/noteAnchorControl.test.tsx`,
`e2e/multi-anchor.spec.ts`.

## Tests

- **`registry.test.ts` — `note.link-anchor`**: materialize + append (full-array
  replace); append to an empty list; **appends onto the FRESH server list, not
  the stale payload snapshot**; **dedupes against the fresh list** (concurrent
  link already added it); dedupe (no `updateNote` when already linked);
  availability gating (needs `noteId` + a focused anchor/draft).
- **`noteAnchorControl.test.tsx`**: single-anchor shows only the link button;
  multi-anchor shows count + one jump per anchor; **3+/4-anchor case shows the
  full count ("Anchored at 4 places") and one jump each** (finding 4); jump
  click focuses the anchor record; a jump whose anchor was filtered out of the
  visible set is disabled and never calls `setAnchor`; link button disabled
  without a focused passage.
- **`annotations.test.ts`**: a single multi-anchor note paints under every
  anchor it claims.
- **`e2e/multi-anchor.spec.ts`** (new): note on passage A → link to B → paints
  at both → "Anchored at 2 places" → jumps work. Extended (finding 5) with a
  third passage C: link C → "Anchored at 3 places" + 3 jumps + paint at all
  three + server-side assertion of 3 `anchorIds` + jump to each + idempotent
  re-link.

All check / unit / e2e suites pass.

## Follow-up: jump now actually REVEALS the passage (scroll-to-anchor)

V1 above wired the jump buttons to `focus.setAnchor`, but that only updated focus
*state* — the reader did not scroll, so jumping to (or re-clicking) an off-screen
anchor left it off-screen. This follow-up makes a jump actually **reveal** the
passage: scroll it into the reader viewport with a brief flash. It is the **third leg**
of the per-surface seam — WRITE (paint), READ (select), and now REVEAL — modeled as a
uniform `SurfaceCapability` in the reader contract
(`docs/design/anchor-selection-abstraction.md` §8): the host drives reveal identically
for every surface; a surface that can scroll implements it once; one that can't simply
ignores the props. The same fix powers the bookmark-row jump
(`docs/design/bookmark-modeling.md`).

### `revealSeq` nonce (FocusContext)

`src/client/focus/FocusContext.tsx` adds a `revealSeq: number` to the context value,
**bumped on every `setAnchor(non-null)`** and on `materializeAnchor` (a draft promoted
to a fresh anchor). The nonce is the crux of the re-click case: re-selecting the **same**
anchor (a multi-anchor jump button, a bookmark row) leaves `activeAnchorId` unchanged, so
a reveal effect keyed on the id alone would never re-fire. Bumping a nonce on every focus
gives the readers a value that always changes, so the scroll re-triggers. `setAnchor(null)`,
`setDraft`, and `clear` deliberately do **not** bump it (there is no passage to scroll to).

### Threading: `activeAnchorId` + `revealSeq` through the reader contract

The two REVEAL props are added to the uniform `SurfaceReaderProps`
(`src/client/surfaces/types.ts`) — `activeAnchorId?` (the focused anchor id) and
`revealSeq?` (the nonce). `views.tsx` `SourceViewerView` passes
`activeAnchorId: focus.anchor?.id` + `revealSeq: focus.revealSeq` into
`readerForSource`, which threads both into **every** annotatable reader. There is **zero
per-surface branching for reveal in `views.tsx`** — the host hands all readers the same
two props; adding/enabling reveal on a new surface needs no host change. All readers are
**prop-driven** (no `useFocus`), keeping them unit-testable in jsdom without a
`FocusProvider`.

### One shared reveal helper + per-surface delegation

`src/client/annotationLayer.ts` adds the single shared `revealAnchorInDoc(root,
anchorId)`: find the `[data-sv-key="…"]` element (quote-escaped), `scrollIntoView({ block:
"center" })`, and add a transient `.sv-active` flash (a ring/glow CSS class, also added
there) cleared after ~1s. It is framework-free and fully try/catch-guarded (cross-origin
/ torn-down realms, jsdom without `scrollIntoView`), and returns whether it found a target
(the PDF path uses a `false` return to first scroll a virtualized page in). Every reader
keys a `useEffect` on `[activeAnchorId, revealSeq]` and delegates:

- **`DomReader`** (the iframe reader, and the snapshot webview's nested `DomReader`):
  calls `revealAnchorInDoc` on its `contentDocument`. A pending reveal requested before
  the fresh document painted is also honored from `bindFrame` after paint (via an
  `activeAnchorId` ref).
- **`LocalHtmlReader`** and the **live `WebviewReader`** tab: the guest DOM is a separate
  WebContents the host can't reach, so they call the shared `revealWebviewAnchor`
  (`src/client/selection/webviewSelection.ts`) which sends `sv:reveal` over IPC; the
  guest preload (`electron/webview-preload.ts`) calls the **same** `revealAnchorInDoc`
  against its own document. The live `WebviewReader` targets only the active live tab
  (the snapshot tab reveals through its nested `DomReader`).
- **`PdfReader`**: tries `revealAnchorInDoc` on the viewer; if the target page is
  virtualized (not yet rendered, so no painted element), it `scrollPageIntoView` on the
  lifted `PDFViewer` ref, then re-reveals on the next `textlayerrendered` event —
  correctly handling off-screen pages.
- **`ImageReader`**: calls `revealAnchorInDoc` on its frame (each region box carries
  `data-sv-key` via `applyHighlight`).

### Surfaces covered vs. deferred

**Covered (reveal honored):** the DOM iframe reader (`DomReader`) — the primary path for
imported-HTML/bookmark sources; the snapshot webview (nested `DomReader`); the live
webview tab and `LocalHtmlReader` (via `sv:reveal` IPC); `PdfReader` (incl. virtualized
off-screen pages); `ImageReader` (region boxes). **Deferred:** none of the annotatable
readers are left out — every surface that can scroll now reveals. A surface that
genuinely can't reveal would simply no-op on the optional props (the contract allows it),
but no such annotatable surface exists today.

### Handlers unchanged

The multi-anchor jump buttons (`noteAnchorControl.tsx`) and the bookmark rows
(`bookmarkViews.tsx`) still just call `focus.setAnchor(...)`; reveal now follows
automatically from the nonce bump — no handler change was needed.

### New / extended e2e + unit proving the reveal

- **`e2e/multi-anchor.spec.ts:171`** — new test **"multi-anchor reveal: jumping to an
  off-screen anchor scrolls it back into the reader"**: a note on a top passage linked to
  a bottom passage with a 2400px spacer between → scroll the reader to the bottom so the
  top anchor is off-screen (`anchorInView` polls `false`) → click its jump button → it
  re-focuses **and** scrolls back into view (`anchorInView` → `true`). The **re-trigger
  subtest** (lines 218-223) scrolls away and re-clicks the **same** jump button, proving
  the `revealSeq` bump re-fires the scroll even though the focused anchor id is unchanged.
- **`src/client/focus/FocusContext.revealSeq.test.tsx`** (new): `revealSeq` starts at 0,
  bumps on `setAnchor(non-null)`, bumps **again on re-selecting the same anchor**, and
  does **not** bump on `setAnchor(null)` / `setDraft` / `clear`.
- **`src/client/surfaces/DomReader.reveal.test.tsx`** (new): renders `DomReader`
  **without** a `FocusProvider` (proving prop-driven, no `useFocus`) and asserts that an
  `[activeAnchorId, revealSeq]` change scrolls the painted `data-sv-key` element into view
  + flashes it, and that a `revealSeq` bump re-fires.
- **`src/client/annotationDom.test.ts`**: direct unit coverage of the shared
  `revealAnchorInDoc` (scroll + flash; no-op on unknown id / null root / empty id; quote
  escaping; swallowing a missing `scrollIntoView`).

> Note (`npm run check` fix): `annotationDom.test.ts:110` used `delete el.scrollIntoView`
> on a non-optional DOM member (TS2790); changed to `delete (el as { scrollIntoView?:
> unknown }).scrollIntoView` so the delete is type-legal. `check` / unit / e2e all pass.

## Deferred

- **Cross-source** multi-anchor (a note spanning passages in *different*
  sources).
- **Reorder** anchors on a note.
- **Bulk** link / unlink.
- **Selection-toolbar affordance** (review finding, low): link is currently only
  on the note card, not surfaced from the selection toolbar — minor spec
  deviation, deferred.

## Rejected review finding

**"No test for a multi-anchor note with one anchor in a disabled layer"
(medium) — rejected as unreachable in V1.** Layer visibility is per-**note**
(`note.layerIds`), not per-anchor. The server derives anchor painting from note
membership (`src/server/app.ts`): an anchor paints iff some note referencing it
sits in an enabled layer. A single multi-anchor note's anchors all share that
one note's membership, so they paint or hide *together* — a visible
multi-anchor note always has ALL its anchors painted; when hidden, its card
disappears entirely. The "2 anchors split across enabled/disabled layers" state
cannot occur (no per-anchor layer assignment in V1). The defensive
disabled-jump guard (anchor absent from the painted set) is already unit-tested
in `noteAnchorControl.test.tsx`.
