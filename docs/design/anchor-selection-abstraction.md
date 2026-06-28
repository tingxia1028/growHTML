# Anchor Selection Abstraction — unifying "select text" vs "select region"

**Status: V1 Implemented (region principle extracted); V2/V3 deferred.**

Companion to `docs/design/selection-architecture.md` (which documents the *surface*
contract). That doc already names the two capture **modes**; this one asks the next
question: **can the "select a region" principle be lifted out of the pdf/image
adapters into one cross-source mechanism, the way the text-quote principle already
is?** It revises the current selection design accordingly.

---

## 1. Context / problem

Every document (source) exposes two ways to pick the passage an anchor hangs on:

- **Select characters** — a text run (a W3C `TextQuoteSelector`: `exact` + `prefix`/
  `suffix`). Survives edits and travels between copies because it re-locates by *text*.
- **Select a region** — a normalized rectangle `[x, y, w, h]` in `0..1` of a rendered
  box (a pdf page, an image). Geometric, no text; re-locates by *coordinates*.

Today the **text-quote** principle is genuinely shared infrastructure:
`src/adapters/web/textQuote.ts` (build + resolve a selector) and
`src/core/study-layer/rematch.ts::rematchText` are reused by html / web / pdf-text /
code with no per-type copy. By contrast the **region** principle is *implicitly*
shared but not *named*: `src/client/surfaces/overlay.ts` factors the drag gesture and
box-painting, yet the rest of "region-ness" is re-stated three times —

- the record carries a bare `rect` field on **two unrelated schemas**
  (`pdfSelectionAnchorSchema`, `imageRegionAnchorSchema`) with no shared type
  (`src/core/schema/anchor.ts:41,54`);
- `rematch.ts` has **two near-identical rect branches** that differ only in the
  `quote`-first fallback (`rematch.ts:160-173`);
- the draft -> request mapping (`buildAnchorInput`) and the server creation switch
  branch per-`anchorKind`, so adding region support to a *third* surface means
  editing five files that all already "know" what a region is.

**Intended outcome.** Name the region principle as a first-class, source-agnostic
`RegionTarget` the same way `TextQuoteSelector` names the text principle — so that (a)
"this surface renders to a box, therefore it supports region selection" becomes a
capability a new adapter *declares*, not code it re-derives; (b) schema / rematch /
server stop carrying duplicated rect logic; and (c) the door is open to region
selection on surfaces that don't have it yet (web/local-HTML, deferred today —
`selection-architecture.md:163`) without touching the core.

This is a **consolidation**, not a rewrite: the current design is already good
(modes are a clean union; the surface contract is uniform). The gap is that *region*
is a value scattered across records rather than a *concept* with one home.

---

## 2. Current map — source type × selection mode

Precise table of every (source, mode) pair: which `anchorKind`, what fields it
carries, where the client captures it, and how it re-locates on import.

| Source surface | Mode | `anchorKind` | Locator fields | Client capture | Re-location on import |
| --- | --- | --- | --- | --- | --- |
| Imported HTML / markdown (DOM iframe) | text | `html_selection` | `quote`, `selector`, `studyId` (+ `contextBefore/After`) | `readDomSelection` -> `AnchorDraft{mode:"quote",kind:"html"}` (`DomReader.tsx:66-103`) | `rematchText(ctx.text)` then re-find `studyId` locally (`rematch.ts:156-158`, `studyLayer.ts:209-213`) |
| Web snapshot (study-id HTML in webview) | text | `html_selection` | same as above | snapshot tab is a `DomReader` path (`readerForSource.tsx:73-87`) | same as html |
| Live web / local HTML (`<webview>`) | text | `web_text_quote` | `quote`, `normalizedUrl` (+ `contextBefore/After`) | guest preload -> `webSelectionToDraft` -> `AnchorDraft{mode:"quote",kind:"web",url}` (`webviewSelection.ts:166-177`) | `rematchText(ctx.text)`, keep `normalizedUrl` (`rematch.ts:156-158`, `studyLayer.ts:215-220`) |
| PDF (pdf.js text layer) | **text** | `pdf_selection` | `page`, `quote` (+ ctx); `rect` absent | `onMouseUp` -> `AnchorDraft{mode:"quote",kind:"pdf",page}` (`PdfReader.tsx:129-159`) | quote-first: `rematchText(pageText ?? text)`, rect fallback (`rematch.ts:160-168`) |
| PDF figure / formula / scan | **region** | `pdf_selection` | `page`, **`rect`**, `quote:""` | region gesture -> `AnchorDraft{mode:"region",kind:"pdf",page,rect}` (`PdfReader.tsx:196-215`) | rect locator; `matched` if `sameBinary`, else `fuzzy` (`rematch.ts:166-168`) |
| Image | **region** | `image_region` | **`rect`**, optional `quote` (label/OCR) | region gesture -> `AnchorDraft{mode:"region",kind:"image",rect}` (`ImageReader.tsx:56-71`) | rect locator; `matched`/`fuzzy` by `sameBinary` (`rematch.ts:171-173`) |
| Code (no UI reader yet) | text | `code_range` | `quote`, `filePath`, `startLine/endLine`, `symbol` | — (schema only) | `rematchText` or `symbol` includes (`rematch.ts:175-180`) |

Key seams the table threads through:

- **Schema** — `src/core/schema/anchor.ts`. `rect` is declared **independently** on
  `pdfSelectionAnchorSchema` (optional, `:41`) and `imageRegionAnchorSchema`
  (required, `:54`). There is no shared `rect` / `RegionTarget` type.
- **Draft union** — `src/client/focus/FocusContext.tsx:13-41`. `QuoteAnchorDraft` vs
  `RegionAnchorDraft`, discriminated on `mode`. `RegionAnchorDraft` already has the
  *exact* shape a unified region wants: `{ rect, page?, url? }`.
- **Draft -> request** — `buildAnchorInput` (`FocusContext.tsx:69-121`): five
  `mode × kind` branches.
- **Paint list** — `PaintAnchor` (`surfaces/types.ts:30-43`): a *superset* record
  with optional `quote`/`page`/`rect`; each reader filters by `anchorKind` and reads
  the fields relevant to it.
- **Region gesture + box** — `src/client/surfaces/overlay.ts`: `normalizeDragRect`,
  `isRealRegion`, `placeRegionBox` (already shared by pdf + image).
- **Server create** — `src/server/app.ts:437-495`: per-`anchorKind` branch;
  `.refine()` requires *a non-empty quote OR a rect* (`app.ts:106-108`).
- **Portable transport** — `portableAnchorSchema` (`pack.ts:9-21`) and `toPortable`
  (`studyLayer.ts:69-88`): `rect` is copied per-kind. `realizeAnchor`
  (`studyLayer.ts:222-238`) rebuilds per-kind.
- **Rematch** — `rematch.ts:154-185`: `rematchAnchor` dispatches by `anchorKind`;
  the two geometric branches are duplicated.

---

## 3. What's shared vs duplicated

Reading the pipeline as five stages (capture -> normalize -> record -> paint -> rematch),
across the two modes and across source types:

| Stage | Text mode | Region mode | Verdict |
| --- | --- | --- | --- |
| **Capture** (gesture) | per-surface DOM read (DomReader / guest preload / pdf text layer) — irreducibly surface-specific | `normalizeDragRect` + `isRealRegion` — **already shared** for pdf+image (`overlay.ts`) | text: correctly per-surface. region: **shared, but only between the two surfaces that opted in** |
| **Normalize** (-> draft) | `webSelectionToDraft`, `readDomSelection`, pdf `onMouseUp` all emit `mode:"quote"` | both emit `mode:"region"{rect,page?,url?}` — **identical payload** | the draft union is the clean part; region payload is already uniform |
| **Record** (schema) | `quote`+ctx is the shared envelope (`anchor.ts:16-18`); `TextQuoteSelector` is the shared value type | `rect` re-declared on 2 schemas; **no shared region type** | **text principle is named; region principle is NOT** <- the gap |
| **Paint** (overlay/highlight) | `applyHighlight` / `highlightQuote` shared (`annotationLayer.ts`) | `placeRegionBox` shared; box -> same `applyHighlight` note card | both well-shared at the presentation layer |
| **Rematch** (import) | `rematchText` shared across html/web/pdf-text/code (`rematch.ts:97-149`) | `pdf_selection` rect branch ~= `image_region` rect branch (`rematch.ts:160-173`) — **duplicated** | text: one resolver, fully shared. region: **two copies of one idea** |

**So:** the *presentation* and *gesture* halves of region selection are already
factored. What is **not** abstracted is the **region as a portable locator** — the
schema field, the rematch rule, the transport copy, and the create-branch. Those are
exactly the places that re-state "what a region is" per source type, and exactly the
places a third region-capable surface would force you to edit.

The asymmetry is the whole finding: **text** has a named value type
(`TextQuoteSelector`) + one resolver (`rematchText`) reused everywhere; **region** has
shared *helpers* but no named *locator type* and a *per-kind* resolver — so it reads
as "pdf happens to have a rect, image happens to have a rect" instead of "both carry a
RegionTarget."

---

## 4. The abstraction question — can region selection be ONE principle?

**Yes.** A region is fully described by `{ rect:[x,y,w,h]; space }` where `space`
identifies the box the rect is normalized to (a pdf page number, or "the whole
image"). Everything else region adapters do is already shared. Three concrete options:

### Option A — full unification: one `AnchorTarget` + per-adapter resolver interface

Collapse both modes into one target type with a `mode` discriminator and route
*everything* (capture -> normalize -> locate -> paint -> rematch) through a per-source
`SelectionAdapter` interface.

```ts
type TextTarget   = { mode: "text";   quote: string; contextBefore: string; contextAfter: string };
type RegionTarget = { mode: "region"; rect: [number, number, number, number]; space: RegionSpace };
type RegionSpace  = { kind: "page"; page: number } | { kind: "whole" };
type AnchorTarget = TextTarget | RegionTarget;

interface SelectionAdapter {
  capture(ev): AnchorTarget | null;          // surface-specific
  toRecord(target, source): AnchorRecord;    // -> stored anchor
  paint(target, host): void;                 // highlight / box
  rematch(target, ctx): RematchResult;       // re-locate on import
}
```

- **Pro:** maximally DRY; a new surface is *one* object.
- **Con:** a **big-bang refactor** of schema, server, rematch, client, and the
  studypack format at once — high blast radius against a working, e2e-covered system,
  and the prompt's whole point is *region*, not re-litigating the text path. The
  discriminated-union `anchorSchema` (`anchor.ts:64-70`) and `PaintAnchor` superset
  already give 80% of A's benefit with none of its risk. **Not recommended as V1.**

### Option B (recommended) — extract a shared `RegionTarget` mechanism; keep mode-specific records

Name region selection the way text selection is named, and *reuse* that one
definition everywhere a rect appears — **without** flattening the existing kinds or
touching the text path.

Introduce one core module, `src/core/region/region.ts`:

```ts
export type Rect = [number, number, number, number];        // normalized 0..1
export type RegionSpace =
  | { kind: "page"; page: number }   // pdf
  | { kind: "whole" };               // image (and any single-box surface)
export type RegionTarget = { rect: Rect; space: RegionSpace };

export const rectSchema: z.ZodType<Rect>;                  // the ONE rect zod
export function normalizeRect(...): Rect;                  // (re-exports overlay math)
export function rematchRegion(t: RegionTarget, ctx): RematchResult; // the ONE rect resolver
export function isRegionAnchorKind(k: AnchorKind): boolean; // pdf_selection-with-rect | image_region
```

Then:

- **Schema** — both `pdfSelectionAnchorSchema` and `imageRegionAnchorSchema` import
  `rectSchema` (one source of truth) instead of inlining the tuple twice
  (`anchor.ts:41,54`). Records stay separate; only the field *type* unifies.
- **Rematch** — `rematch.ts` collapses its two geometric branches into one call to
  `rematchRegion`; the `pdf_selection` branch keeps its quote-first try then *delegates
  the rect fallback* (`rematch.ts:160-173` -> one shared tail). PortableAnchor's
  `rect` keeps traveling unchanged.
- **Client** — `RegionAnchorDraft` (`FocusContext.tsx:30-39`) is re-expressed in terms
  of `RegionTarget` (it already *is* `{rect, page?}`); `buildAnchorInput`'s two region
  branches (`FocusContext.tsx:70-82`) read one `regionTarget -> request` helper.
- **Capability flag** — a surface declares `supportsRegion: true`. `overlay.ts`'s
  gesture is already shared; the *only* thing gating region selection on web/local-HTML
  today is that those readers don't mount the gesture. With the flag + shared gesture,
  enabling it later is "mount the gesture + map `space:{kind:"whole"}`", **zero core
  changes**.

- **Pro:** small, additive, backward-compatible (stored rects are byte-identical);
  directly answers the prompt (region becomes one principle); each existing adapter
  plugs in by swapping its inline rect for the shared type.
- **Con:** the *record* layer still has two kinds carrying a rect (we don't collapse
  `pdf_selection`+`image_region` into one `region` kind). That's deliberate — see section 5
  backward-compat; collapsing kinds is a storage migration we explicitly defer.

### Option C — hybrid (the staged path)

Ship **B** now (name the principle, dedupe rematch/schema/client). Keep **A**'s
`SelectionAdapter`/`AnchorTarget` as the *documented north star* for if/when a fourth
region surface or a non-rect region (polygon, time-range on audio/video) actually
arrives — at which point the resolver-interface earns its complexity. This is the
recommendation: **B's seams are a strict subset of A's**, so B is a down payment on A,
not a detour.

### Recommended design + the seam interfaces

Adopt **Option B** (with C's framing). The seams:

1. **`RegionTarget` + `RegionSpace`** (`src/core/region/region.ts`) — the named
   region locator, mirroring `TextQuoteSelector`. One `rectSchema`, one
   `rematchRegion`, one `normalizeRect`.
2. **`SurfaceCapability`** — a tiny per-reader declaration
   `{ modes: ("text"|"region")[] }`. Replaces the implicit "pdf and image happen to
   have a region button." Drives whether a reader mounts the shared gesture.
3. **`regionTargetToRequest(target, source) -> CreateAnchorInput`** — the single
   region draft->request map, replacing the two region arms of `buildAnchorInput`.

How each existing adapter plugs in:

| Adapter | Today | After Option B |
| --- | --- | --- |
| `DomReader` / webview | text only | unchanged (`modes:["text"]`); free to gain `"region"` later via the flag |
| `PdfReader` | inline rect + own rect rematch arm | `modes:["text","region"]`; region uses `RegionTarget{space:{page}}`; rematch delegates to `rematchRegion` |
| `ImageReader` | inline rect, separate kind | `modes:["region"]`; `RegionTarget{space:{whole}}`; rematch via `rematchRegion` |
| (future audio/video/canvas) | n/a | declare `modes`, map their box to `RegionSpace`, reuse the gesture + resolver |

---

## 5. Impact / migration

What changes, and what is guaranteed not to break.

- **Schema (`src/core/schema/anchor.ts`)** — `rect` tuple replaced by an imported
  `rectSchema` on both kinds. **Wire-compatible**: same JSON shape, so every stored
  anchor and every `.studypack` validates unchanged. `anchorKind` values are
  untouched, so the discriminated union and all readers' `anchorsOfKind` filters keep
  working.
- **Rematch (`src/core/study-layer/rematch.ts`)** — the two geometric branches
  (`:160-173`) become one `rematchRegion` call. **Behavior preserved**: same
  `matched`/`fuzzy`-by-`sameBinary` semantics; covered by the existing
  `rematch.test.ts` cases, which become the regression gate.
- **Client (`FocusContext.tsx`)** — `RegionAnchorDraft` re-typed over `RegionTarget`;
  `buildAnchorInput`'s region arms call `regionTargetToRequest`. The `mode` union and
  the five-row mapping table in `selection-architecture.md:149-156` stay valid (region
  rows now share one implementation).
- **Server (`src/server/app.ts`)** — the `pdf_selection`/`image_region` create
  branches (`:458-495`) call the shared region constructor path; the `.refine()`
  quote-or-rect guard (`:106-108`) is unchanged.
- **Overlay (`src/client/surfaces/overlay.ts`)** — stays the gesture/box home; may
  re-export from `core/region` so the normalize math has one definition shared by
  client + core rematch.
- **Backward-compat with stored anchors:** **total.** Because we keep both
  `anchorKind`s and the identical `rect` JSON, no data migration runs; old vaults and
  old packs load as-is. (Collapsing `pdf_selection`+`image_region` into a single
  `region` kind — Option A — *would* need a migration and is **out of scope**.)

**Risks**

- *Over-generalizing `RegionSpace`* before a real third case exists. Mitigation: ship
  only `{page}` and `{whole}` (the two that exist); polygon/time-range are explicitly
  deferred.
- *Touching the rematch resolver*, which is the import correctness core. Mitigation:
  `rematchRegion` must be a behavior-identical extraction, gated by the unchanged
  `rematch.test.ts`; no semantic change in V1.
- *Concurrent edits*: this is design-only; the implementer should land section 6's V1 as a
  pure extraction with the existing test suite green before any new capability.

**Explicitly out of scope**

- Merging the two region `anchorKind`s into one (storage migration).
- Implementing region selection on web/local-HTML (the flag *enables* it; wiring the
  gesture there is a follow-up).
- Non-rect regions (polygon, audio/video time-range).
- Re-routing the **text** path through a resolver interface (Option A) — text is
  already well-abstracted; no churn warranted.

---

## 6. Staged plan

**V1 — name the region principle (smallest useful abstraction).** Pure extraction,
no behavior change, backward-compatible.

- *Add* `src/core/region/region.ts`: `Rect`, `RegionSpace`, `RegionTarget`,
  `rectSchema`, `rematchRegion`, `normalizeRect` (re-export of `overlay.ts` math).
- *Change* `src/core/schema/anchor.ts` — both kinds use `rectSchema`.
- *Change* `src/core/study-layer/rematch.ts` — geometric branches -> `rematchRegion`.
- *Change* `src/client/focus/FocusContext.tsx` — `RegionAnchorDraft` over
  `RegionTarget`; add `regionTargetToRequest`; region arms of `buildAnchorInput` use it.
- *Tests:* existing `rematch.test.ts`, `FocusContext.test.ts`, `overlay.test.ts`,
  `app.test.ts` stay green (they ARE the V1 gate); add a unit test that pdf-region and
  image-region rematch route through the one `rematchRegion`.

**V2 — capability-driven surfaces.**

- *Add* `SurfaceCapability` (`modes`) to `surfaces/types.ts`; each reader declares it.
- *Change* `readerForSource.tsx` / readers to mount the shared region gesture *iff*
  `modes` includes `"region"` — removing the ad-hoc region toggle wiring from
  `PdfReader` into a shared mount.
- Net effect: enabling region selection on a new surface = set a flag + map its box to
  a `RegionSpace`.

**V3 (deferred, only if a real case lands) — Option A.**

- Promote `RegionTarget`/`TextTarget` into a unified `AnchorTarget` and the
  per-adapter `SelectionAdapter` resolver; consider collapsing the two region
  `anchorKind`s behind a storage migration. Only worth it when a non-rect region or a
  fourth region surface forces it.

---

## 7. Extension — region capture (free-box selection + screenshot as anchor context)

A planned extension that builds directly on Option B. The feature: draw a **free box**
over *any* surface, make a note, and **capture that region as a screenshot stored as part
of the anchor's context**.

**Key design move: separate the *locator* from the *capture*.** Today region selection
conflates them because pdf/image are fixed-pixel surfaces (the `rect` IS a durable
locator). On a **reflowable** surface (HTML/web) a pixel rect is NOT a durable locator —
reflow moves it. So split:

| Layer | What it is | Used for |
| --- | --- | --- |
| **Locator** | "how to re-find it" — `TextQuoteSelector` (reflowable) or `rect` (fixed-pixel) | rematch on import |
| **Capture** | "what it looked like" — `{ rect, space, snapshotAssetId }` | display / recognition / **fallback when the locator can't re-resolve** |

- Fixed-pixel (image / pdf figure): `rect` doubles as locator **and** capture.
- Reflowable (HTML / web): the locator stays the **text/DOM range under the box** (durable,
  via `rematchText`); the `rect` is only a visual hint; the **screenshot is the permanent
  visual record** and the durability fallback.

**Storage (reuse existing systems):**
- The screenshot is stored as an **Asset** (reuse `assetSchema` / `src/core/store/assets.ts`
  / `/api/assets` / the `image` content type, content-hash dedup) — never inline base64.
- The anchor gains an **optional** `context.snapshot = { assetId, rect, space, capturedAt }`,
  generalizing context from "text before/after" to "text **and** an optional visual snapshot."
  Additive + backward-compatible. Putting it on the anchor (not the note) lets *any* note
  type anchored there share it.

**Slots onto Option B:** reuse `RegionTarget`; add `RegionCapture = RegionTarget +
snapshotAssetId?`; extend the per-surface capability to `{ modes, canCapture }` + a
`captureRegion(rect): Promise<Blob>` provider. Capture mechanisms per surface: canvas crop
(image/pdf), Electron `webContents.capturePage(rect)` (webview/live), html2canvas-or-Electron
(DOM iframe).

**Open decisions:** free-rect vs polygon/lasso (V1 = free-rect; polygon = crop bbox + mask,
later); which surfaces first; export/privacy (a snapshot can leak more than text — consider
`privateByDefault` so it's stripped from studypack export); size (downscale + hash dedup).

## 8. Extension — path to plugin extensibility

Goal: later, plugins (third-party) add new surfaces, selection modes, capture mechanisms, or
durable anchor kinds. The `SelectionAdapter` interface (Option A) **is** the plugin API. Two
tiers, very different risk:

- **Tier 1 — presentation & capture (open, low risk).** New viewers, gestures (rect/polygon/
  lasso), capture providers, context displays. Pure *client adapters* — they never threaten
  stored-data correctness. A plugin registers a `SurfaceAdapter` / `CaptureProvider`. The
  "free-box + screenshot" feature (§7) lives here and is cleanly plugin-able.
- **Tier 2 — new durable locator / anchor kinds (open, governed).** To let a plugin define a
  *new way to anchor* that persists + rematches, open the anchor model the way notes are
  already open: replace the **closed** `anchorKind` union with an **open** `locatorType:
  string` + `locatorData`, validated by a registered **`LocatorSpec { type, schema, rematch,
  paint }`** — mirroring `contentType` + `NoteContentSpec`. A plugin registers a `LocatorSpec`
  → a first-class durable anchor, zero core change. ("Do for anchors what we already did for
  notes.")

**The one hard constraint + its solution.** Anchors are persisted and shared (studypacks); a
receiver **may not have the plugin** that defined an exotic locator, so it can't re-locate it.
Solution = graceful degradation through the **universal text/snapshot `context`** (§7): every
anchor carries a plugin-agnostic text + visual record any client can show ("can't re-resolve
precisely, but here's what it was"). So the snapshot-in-context is not just a feature — it is
the **portability backbone** that makes plugin-defined locators safe.

**Timing (rule of three).** Do NOT freeze a public plugin API until ≥3 internal
implementations (image / pdf / free-box / maybe audio-video time-range) have shaped the
interface. Build the in-house abstraction now in this *shape* (adapter-per-surface + an open
locator registry) but expose the API only after it has earned its generality.

**Obsidian parallel.** Obsidian lets plugins add views/commands/editor extensions while its
core note/link storage format stays stable. Same split here: core owns the **durable anchor
model + rematch contract + universal context fallback**; plugins extend the **open registries**
(`LocatorSpec` / `SurfaceAdapter` / `CaptureProvider`).

---

### Summary

The text-selection principle is already a named, reused abstraction
(`TextQuoteSelector` + `rematchText`); the **region** principle is shared only at the
gesture/paint layer and is otherwise re-stated per source type (two schema rects, two
rematch branches, per-kind transport + create). The recommended move (Option B) is to
name region selection as a first-class, source-agnostic **`RegionTarget` = { rect,
space }** in `src/core/region/`, with **one `rematchRegion`**, **one `rectSchema`**,
and a **`regionTargetToRequest`** client map — plus a per-surface **capability flag**
so "renders to a box => supports region selection" becomes declared, not duplicated.
It is fully backward-compatible (no `anchorKind` change, identical rect JSON), is a
strict down payment on the fuller `AnchorTarget`/`SelectionAdapter` model (Option A,
deferred to V3), and keeps the already-clean text path untouched.

---

## Implementation log

V1 (§6) is implemented as a pure, backward-compatible extraction. §§7-8 (region
capture, plugin extensibility) and the V2 capability-driven surfaces / V3 full
`AnchorTarget`+`SelectionAdapter` unification remain **deferred** exactly as planned.

### Files changed (`git diff HEAD --stat`, region-relevant)

```
 src/core/region/region.ts            | new (3322 B)  — the named region principle
 src/core/region/region.test.ts       | new (1560 B)  — V1 routing gate
 src/core/schema/anchor.ts            |  5 ++--       — both rect fields → rectSchema
 src/core/study-layer/rematch.ts      |  5 ++--       — two geometric branches → rematchRegion
 src/client/surfaces/overlay.ts       | 22 +--        — normalize math moved to core, re-exported
 src/client/focus/FocusContext.tsx    | 30 ++--       — RegionAnchorDraft over Rect; regionTargetToRequest
```

(`git diff HEAD --stat` also lists `docs/samples/teacher-layer.studypack`, an
unrelated sample-data regeneration — different `packId`/`createdAt` plus an added
`textbook.review-pack` note — **not** part of this change.)

### `src/core/region/region.ts` exports

- `type Rect = [number, number, number, number]` — normalized 0..1.
- `type RegionSpace = { kind: "page"; page: number } | { kind: "whole" }` — only the
  two spaces that exist; polygon / time-range deferred.
- `type RegionTarget = { rect: Rect; space: RegionSpace }` — the named locator,
  mirroring `TextQuoteSelector`.
- `const rectSchema` — the ONE rect zod (`z.tuple([number,number,number,number])`).
- `function normalizeRect(rect, start, current): Rect` — THE home of the normalize
  math, moved verbatim from `overlay.ts`.
- `function rematchRegion(_target, ctx: Pick<RematchContext,"sameBinary">): RematchResult`
  — the ONE rect resolver (`sameBinary === false ? "fuzzy" : "matched"`).
- `function isRegionAnchorKind(kind: AnchorKind): boolean` — `pdf_selection || image_region`.

The module is a runtime leaf (only `zod` at runtime; `AnchorKind` / `RematchContext` /
`RematchResult` are type-only imports), so no import cycle with schema/rematch.

### Dedup landed (schema / rematch / FocusContext)

- **Schema** (`anchor.ts`) — `pdfSelectionAnchorSchema.rect` (`.optional()`) and
  `imageRegionAnchorSchema.rect` (required) both now import `rectSchema` instead of
  inlining the 4-tuple twice. Optionality stays per-kind; only the field *type* unifies.
- **Rematch** (`rematch.ts`) — the two near-identical inline rect tails collapse to one
  `rematchRegion(...)` call each: `pdf_selection` keeps its quote-first try then
  delegates the rect fallback (`space:{kind:"page",page:portable.page ?? 1}`);
  `image_region` delegates with `space:{kind:"whole"}`.
- **FocusContext** (`FocusContext.tsx`) — `RegionAnchorDraft.rect` is now `Rect`; new
  exported `regionTargetToRequest(target, source)` is the single region draft→request
  map; `buildAnchorInput`'s two region arms build a `RegionTarget` and route through it.
- **Overlay** (`overlay.ts`) — `normalizeDragRect` is now `export const normalizeDragRect
  = normalizeRect` (re-export of the core math); `NormalizedRect = Rect`. Overlay stays
  the gesture/box home for the readers; the math has one definition.

### Backward-compat confirmed

- **Identical rect JSON** — `rectSchema` is the same `z.tuple([z.number()×4])` the two
  schemas inlined before, so every stored anchor and every `.studypack` validates
  unchanged; no data migration.
- **`anchorKinds` unchanged** — `anchorKindSchema` enum is untouched; the two region
  kinds (`pdf_selection`, `image_region`) are kept separate (not collapsed), so the
  discriminated union and all `anchorsOfKind` filters keep working.
- **Rematch behavior preserved** — `rematchRegion` returns exactly the prior
  `sameBinary`-keyed `matched`/`fuzzy` result.

### New routing test

`src/core/region/region.test.ts` — the V1 gate asserting both region kinds re-locate
through the single `rematchRegion`: (1) `pdf_selection`-with-rect via `rematchAnchor`
equals `rematchRegion({space:{page}})` for both `sameBinary` states; (2) `image_region`
via `rematchAnchor` equals `rematchRegion({space:{whole}})`; (3) both kinds resolve
identically for the same rect + binary state. Full suite green
(`region.test.ts` + `rematch.test.ts` + `focus`: 3 files / 25 tests passed).

### Review findings

Self-review (code-review pass) surfaced no correctness or reuse findings requiring
change — the extraction is behavior-identical and gated by the existing + new tests.
Nothing fixed, nothing rejected (none raised); `fix=null` (no auto-apply requested).
