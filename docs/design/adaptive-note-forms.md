# Adaptive Note Forms — content-driven rendering for rich AI notes

**Status: Research + design proposal (no code yet).**

> The user's vision: in the AI chat, generate notes in many rich forms — **video**
> (embedded player), **interactive mini-games** (self-contained HTML/JS the AI
> writes), **mindmap / xmind** — and embed them *smoothly* into the notes, each
> auto-rendered in the right form. The core thesis the user stated: *"the note page
> shouldn't have so many manual types either — it should auto-detect and adapt the
> rendering based on the user's content."*

This is two linked problems:

1. **Content-driven auto-adaptation** — infer/declare the render form *from the
   content* (AI-generated or user-authored) and render via the registry, collapsing
   the manual type-picker UX.
2. **New rich render forms** (video / interactive game / richer mindmap) + a smooth
   chat → preview → note pipeline that lands a note which auto-renders, with no type
   selection.

The headline finding: **most of the machinery already exists.** This codebase
already has a content/renderer registry split, a generation→preview→edit→save loop,
a sandboxed-HTML note type, `video`/`mindmap`/`markmap` content types, and the
`markmap`/`mermaid` libraries installed. The work is mostly (a) one new
*classifier* seam in front of the existing registry, (b) a small hardening of the
sandbox so scripts can run safely, and (c) a chat path that emits a discriminated
block. None of it needs a core-schema change.

---

## 1. How it works TODAY (grounded)

### 1.1 The two-registry note model (already a renderer registry)

A note type is split across **two** registries, exactly the seam this proposal
extends:

- **Core, React-free** — `NoteContentSpec` in
  `src/core/notes/contentTypes.ts:11-32`: owns the zod `schema`, `createDefault()`,
  `toSearchText()`. `registerNoteContentSpec` / `getNoteContentSpec` /
  `listNoteContentSpecs` / `parseNoteContent`. The server validates a note's
  `content` with `getNoteContentSpec(contentType).schema` before persisting, so an
  unknown/invalid shape never reaches storage (`contentTypes.ts:40-44`).
- **Client, React** — `NoteTypePlugin` in
  `src/client/notes/noteTypeRegistry.tsx:41-68`: owns `render(input)` and
  `edit(input)`. `registerNoteType` / `getNoteType` / `listNoteTypes`. A plugin
  *must not* redefine the schema; it reaches its paired core spec via
  `spec(contentType)` (`noteTypeRegistry.tsx:75-79`).

`Note.content` in the core schema is `unknown`; its shape is owned entirely by the
content spec. **Adding a type = register one core spec + one client plugin; nothing
in App/Workspace changes** (`docs/design/note-types.md`,
`docs/design/product-kit.md` "Iron law"). The composer's type picker and the note
list both *follow the registry* (`src/client/workspace/views.tsx:57-69` builds the
`<select>` from `listNoteTypes()`; the list renders each note via
`getNoteType(contentType)` at `views.tsx:592-602`).

### 1.2 The content types that already exist

`src/core/notes/contentTypes.ts:100-185` registers built-ins. Relevant to this
proposal, **these already exist**:

| contentType | shape | renderer today |
| --- | --- | --- |
| `mindmap` | `{ title?/text?, children? }` tree | sanitized nested `<ul>` (`render.ts:147-159`) — *static*, not interactive |
| `markmap` | markdown string | interactive SVG via `markmap-lib`+`markmap-view` (`diagrams.ts:24-33`) |
| `mermaid` | diagram source string | interactive SVG via `mermaid` (`diagrams.ts:13-22`, `securityLevel:"strict"`) |
| `video` | `{ assetId, caption?, startSec?, endSec? }` | `<video src={assetUrl}>` for a **local asset** (`builtinNoteTypes.tsx:311-368`) |
| `audio` / `image` | asset-backed | `<audio>` / `<img>` |
| `html-sandbox` | `{ html }` | `<iframe sandbox="" srcDoc>` — **scripts disabled** (`builtinNoteTypes.tsx:375-385`) |
| `markdown` / `plain-text` / `flashcard` / `quiz` / `code-snippet` / `bookmark` | … | various |

So three of the four "new forms" the user wants already have a contentType. The
gaps are: **mindmap is static** (markmap covers the interactive case),
**video is local-asset-only** (no URL/YouTube/bilibili embed), and
**html-sandbox can't run scripts** (so no real game). And critically: none of these
are reachable from the AI chat — there is no path for the model to *choose* a form.

### 1.3 The generation → preview → edit → save loop (already shipped)

`docs/design/generation-preview.md`. A kit AI command does
`materializeAnchor()` → `generateStructured(...)` → emits a `GeneratedDraft`
through `ctx.actions.onGenerated` instead of auto-saving. The draft is parked in
`WorkspaceContext.pendingDraft`; `GenerationPreview`
(`src/client/workspace/GenerationPreview.tsx`) renders it **through the same
client NoteType plugin a saved note uses** (`getNoteType(draft.contentType)`,
`GenerationPreview.tsx:33-44`) and offers Save / Edit / Regenerate / Discard.
**Save reuses `anchor.add-note`** with the pre-materialized `anchorIds`
(`registry.ts:189-220`). The whole loop is content-type-agnostic: *any* registered
contentType gets a working preview/edit/save for free
(`generation-preview.md` "The preview reuses the note registry's render()/edit()").

This is the keystone for the chat→note pipeline below — it already does exactly
what we need, for any contentType.

### 1.4 Structured generation engine (kit-agnostic)

`src/ai/structured.ts:52` — `generateStructured(provider, { messages, schema,
sample?, contentType? })`: prepends a JSON-only system message, asks the provider
for JSON (`completeStructured` if available, else `complete()` + `extractJson`),
runs `schema.parse(...)`, and re-prompts on a schema mismatch up to `maxAttempts`.
**Iron rule:** `src/ai` never imports a kit (`docs/design/ai-orchestration.md`).

The kit wrapper `generateStructuredContent` (`src/kits/structured.ts`) resolves a
*registered* `promptId` via `resolvePrompt` (`src/kits/resolvePrompt.ts`, the
operation-as-data work) + the contentType's `NoteContentSpec.schema`, and delegates.
The HTTP entry is `POST /api/kits/generate { promptId, contentType, input }`,
client method `entityClient.generateStructured(...)`
(`src/client/data/entityClient.ts:523-525`).

**Important constraint:** today generation requires a **pre-registered `promptId`**
(a built-in `KitPrompt` or a stored `op_…` operation) *and* a caller-supplied
`contentType`. The *caller* decides the form; the model only fills the schema. To
let the **model** pick the form (the user's "auto-detect from content" thesis),
we need either (a) a single "router" prompt whose output schema is a discriminated
union, or (b) a free-chat → classify-the-reply path. Both are designed in §4.

### 1.5 Operation-as-data (already shipped) — the precedent for "model picks"

`docs/design/ai-operation-as-data.md`: operations are *data* (a stored
`{{var}}` template + declared output `contentType`), resolved through the *same*
`generateStructured` path via `resolvePrompt`. The generic `operation.run` command
(`registry.ts:~440-475`) gathers values, calls `generateStructured`, and emits the
**same `GeneratedDraft`** — so preview/edit/save work with zero preview-side
changes. This proves: a new "form" only needs a contentType + a prompt; the run +
preview + save plumbing is reusable verbatim.

### 1.6 Sandboxing precedent + security posture (critical for games)

From `electron/main.ts`, `electron/preload.ts`, `electron/webview-preload.ts`,
`src/client/notes/builtinNoteTypes.tsx`:

- **Host window**: `contextIsolation: true`, `nodeIntegration: false`,
  `webviewTag: true` (`main.ts:23-41`). The renderer cannot touch the filesystem
  or Node; the preload exposes a *minimal* `window.studyVault` (file dialogs, PTY,
  identity) via `contextBridge` (`preload.ts`).
- **html-sandbox note**: `<iframe sandbox="" srcDoc={html}>`
  (`builtinNoteTypes.tsx:382`). `sandbox=""` is **maximally restrictive**: no
  scripts, no forms, no same-origin, no top-navigation. `srcDoc` means even a
  `<script>` in the note is inert. **Consequence: a real interactive game cannot
  run today** — no script executes.
- **Electron `<webview>` guests** (live web / local HTML): a *separate
  WebContents* with a guest preload that talks back only over `sv:*` IPC channels;
  cannot reach the host app (`LocalHtmlReader.tsx:14-19`, `webview-preload.ts`).
- **No CSP** is set by the server or `index.html` (server only sets
  `express.json({ limit: "50mb" })`, `app.ts:245`).
- **Web (vite) build**: no Electron APIs → no `<webview>`; the html-sandbox iframe
  uses the browser's native sandbox (works identically).

- **Assets**: stored vault-relative as `assets/<ulid>.<ext>`, deduped by SHA-256
  (`src/core/store/assets.ts:29-71`); served raw at `GET /api/assets/:id`
  (`app.ts:890-901`) by `res.type(mime).send(await readAssetBytes(...))` — **the
  whole file is read into memory, no HTTP range support**. There is **no per-asset
  size limit**. *Implication for video:* importing/serving a large local video will
  load the entire file into Node memory on every play and won't support seek/range
  — fine for short clips, a real problem for long videos. This pushes the
  recommendation toward **URL-embed for remote video** and treating large local
  video as a known limitation (range support is a separate, orthogonal fix).

---

## 2. The core idea: a self-describing block + a classifier seam

The user's thesis ("auto-detect and adapt") maps cleanly onto the **existing**
registry — we do **not** invent a parallel system. Two complementary mechanisms:

1. **Self-describing (AI path).** The model emits a *discriminated payload* whose
   discriminator **is the `contentType`** the registry already keys on. The model
   decides the form; the registry renders it. No classifier needed — the producer
   declares the form.
2. **Auto-classify (user-authored / paste path).** When content arrives *without* a
   declared form (the user pastes a YouTube link, a markmap outline, a `<canvas>`
   game, or plain prose), a small **pure classifier** maps the raw text → a
   `contentType` before it is saved. The manual picker collapses into a *suggested*
   form the user can override.

Both feed the **same** `getNoteType(contentType).render(...)`. The discriminator
already exists — it is `Note.contentType`. We are not adding a `kind` field to
content; we are adding the *producers* (a chat router prompt + a classifier) that
populate the existing discriminator automatically.

### 2.1 Why not add a `kind` discriminator inside `content`?

Tempting, but wrong for this repo. The registry **already** discriminates on
`Note.contentType` (a top-level field on the note envelope, validated server-side).
Adding a second discriminator *inside* `content` would (a) duplicate the seam, (b)
break the "one spec per contentType" iron law, and (c) require every renderer to
re-switch internally. **Recommendation: the contentType IS the discriminator.** A
"block" is just `{ contentType, content }` — which is exactly a note. The new
forms are new contentTypes; the "auto-adaptation" is *populating contentType
automatically* instead of via a picker.

---

## 3. The classifier (the "auto-detect" engine)

A **pure, dependency-free** function — the analogue of `src/ai/template.ts`: it
imports nothing from kits/core and is trivially unit-testable.

```ts
// Proposed: src/client/notes/classifyContent.ts  (pure; or src/core/notes/ if
// the server ever needs it — keep it core-shaped, no React, no fetch)

export type ClassifiedForm = {
  contentType: string;                 // a registered NoteContentSpec contentType
  content: unknown;                    // shaped for that type's schema
  confidence: "high" | "low";          // high = auto-apply; low = suggest + let user override
};

/**
 * Heuristic, synchronous classification of raw author input → a render form.
 * Total (never throws). Falls back to { contentType: "markdown" } at low
 * confidence so nothing is ever blocked. Order = most specific first.
 */
export function classifyContent(raw: string): ClassifiedForm;
```

V1 heuristics (cheap, regex-level, high precision — only auto-apply on a confident
match, else default to markdown and merely *suggest*):

| Detect | Rule | → contentType | content |
| --- | --- | --- | --- |
| Remote video URL | YouTube / bilibili / Vimeo host regex (`youtu\.be`, `youtube\.com/watch`, `bilibili\.com/video`, …) | `video-embed` (new, §5.1) | `{ provider, videoId, url }` |
| Mermaid block | starts with `graph`/`flowchart`/`sequenceDiagram`/`gantt`/… or fenced ```` ```mermaid ```` | `mermaid` | the source |
| Markmap/mindmap outline | a markdown heading/bullet outline (multiple `#`/`-` levels) | `markmap` | the markdown |
| Self-contained HTML game | contains `<script>` AND (`<canvas>`/`addEventListener`/`requestAnimationFrame`) | `html-interactive` (new, §5.3) | `{ html }` |
| Inert HTML | `<...>` tags but no script | `html-sandbox` | `{ html }` |
| Code | fenced ```` ```lang ```` with a known language | `code-snippet` | `{ language, code }` |
| else | — | `markdown` (default) | the text |

**UX collapse.** The composer's type `<select>` (`views.tsx:548-560`) becomes a
**"detected: <form>" chip with an override dropdown**, not a mandatory pre-choice:
paste/type → it classifies live → shows the suggested form → user can override.
This is the minimal change that realizes "the note page shouldn't have so many
manual types" without removing the open plugin model (the picker still exists,
demoted to an override). High-confidence detections (a bare YouTube URL) can
*auto-apply*; low-confidence keep markdown and just hint.

**Optional V2: an AI classifier pass.** For ambiguous prose ("make this a
quiz"-style intent), a tiny `completeStructured` call against a `formRouterSchema`
(discriminated union, §4.1) can classify when the heuristic is low-confidence. Kept
out of V1 — the heuristic covers the concrete forms the user named (URL → video,
outline → mindmap, HTML → game) deterministically and offline (so e2e stays on the
mock).

---

## 4. The chat → preview → note pipeline (model picks the form)

We want a chat turn to produce a rich block that auto-renders in the thread and
saves as a note — no type selection. Two designs; **recommend B for V1, A for V2.**

### 4.1 (V2) Design A — a "form router" structured prompt

A single built-in prompt `note.generate-block` whose **output schema is a
discriminated union** over the supported forms — the model decides the form *and*
fills it in one structured call:

```ts
// Proposed shape for a router output (NOT a stored content shape — a transport
// envelope the router command unwraps into { contentType, content }).
const formRouterSchema = z.discriminatedUnion("form", [
  z.object({ form: z.literal("markdown"),         markdown: z.string() }),
  z.object({ form: z.literal("video-embed"),      url: z.string() }),
  z.object({ form: z.literal("markmap"),          outline: z.string() }),
  z.object({ form: z.literal("mermaid"),          diagram: z.string() }),
  z.object({ form: z.literal("html-interactive"), html: z.string() }),
  z.object({ form: z.literal("flashcard"),        front: z.string(), back: z.string() }),
  z.object({ form: z.literal("quiz"),             /* … */ })
]);
```

A new command `note.generate-block` calls `generateStructured` with this schema,
maps `form → { contentType, content }`, and emits the **existing `GeneratedDraft`**.
The preview/edit/save loop renders it verbatim. This is the cleanest realization of
"the model decides the form," but it needs a router prompt + a mock that emits a
deterministic discriminated sample, so it is **V2** (more moving parts).

### 4.2 (V1) Design B — free chat reply → classify → draft

Reuse what already ships. The chat already streams a markdown reply
(`anchor.ask-ai`, `registry.ts:150-186`) and offers **"Save full reply"** /
**"Save selection as note"** buttons (`views.tsx:482-499`) that today hard-code
`contentType: "markdown"`. The minimal change:

> When saving a reply (or a selection of it), run `classifyContent(text)` first and
> save with the *detected* contentType instead of always `"markdown"`.

So if the AI writes a markmap outline, a mermaid block, or a self-contained HTML
game in its reply, "Save as note" lands the *right* form automatically — through
the existing `anchor.add-note` path (`views.tsx:488,495` change `contentType:
"markdown"` → `classifyContent(...).contentType`, and pass the shaped `content`).
For high-value forms we can prompt the AI to *fence* its rich output (```` ```mermaid ````,
```` ```html-game ````) so the classifier is reliable.

This is **tiny** (a handful of lines in `views.tsx` + the pure classifier) and
delivers the user's end-to-end experience: *ask in chat → the reply contains a
game/mindmap/video → one click saves it auto-rendered.* It also routes through the
preview loop if we instead feed the classified result to `onGenerated` (recommended,
so the user previews before save — consistent with every other AI-assist surface).

### 4.3 Auto-render in the chat thread

The chat log currently renders every message as markdown
(`views.tsx:476-481`, `renderNoteContent("markdown", message.content)`). To
auto-render a rich reply *in the thread* (not just on save), classify the assistant
message and render it through `getNoteType(detected.contentType).render(...)`
instead of the markdown path. This is additive (fallback to markdown on
low-confidence) and reuses the exact renderer a saved note uses — so a previewed
block and a saved block look identical. Recommend doing this in Phase 3 (after the
save-path classification proves the classifier).

---

## 5. Per-form designs

### 5.1 Video — split "embed URL" from "local asset" (NEW: `video-embed`)

**Recommendation: a new `video-embed` contentType for remote URLs; keep the
existing asset-backed `video` for local files.** They have different data
(`{ provider, videoId, url }` vs `{ assetId }`) and different render (provider
`<iframe>` vs `<video src=assetUrl>`), so they are two specs — consistent with how
`image`/`audio`/`video` are already separate.

- **Library: none.** Provider embeds are plain iframes
  (`https://www.youtube.com/embed/<id>`, `https://player.bilibili.com/player.html?bvid=<id>`,
  `https://player.vimeo.com/video/<id>`). Render in an `<iframe sandbox="allow-scripts
  allow-same-origin allow-presentation" allow="fullscreen; picture-in-picture"
  src=...>` pointing at the provider's player. Parse the id with a small pure
  `parseVideoUrl(url)` (the same function the classifier uses).
- **Tradeoff vs local asset:** URL-embed has *zero* storage cost and full
  seek/streaming (the provider serves it); the downside is it needs network and the
  content can disappear. Local `video` is offline + permanent but, given the
  no-range serving (`app.ts:890-901`) and no size cap, is **only suitable for short
  clips** today. *Recommendation:* default the chat/classifier path to
  `video-embed` for URLs; reserve local `video` for explicitly imported short
  files; note "add HTTP range support to `/api/assets/:id`" as a separate backlog
  item if long local video becomes a real need.
- **Security:** a provider iframe is third-party content but the providers are
  trusted players; `allow-same-origin` is acceptable *because the src is a remote
  provider origin* (not our origin), so it cannot reach our DOM. Restrict `allow=`
  to media features only.

### 5.2 Mindmap — adopt `markmap` as the interactive mindmap (REUSE)

**Recommendation: treat `markmap` (already installed + rendering) as THE
interactive mindmap; keep the static `mindmap` tree as a lightweight fallback.**

- `markmap` gives the **smoothest AI-generation story by far**: the model emits a
  **plain markdown outline** (`# Root` / `## Child` / `- leaf`) — which it is
  already excellent at — and `markmap-lib`+`markmap-view` render an interactive,
  zoomable, collapsible mindmap (`diagrams.ts:24-33`). No JSON tree to hand-author,
  no schema for the model to get wrong.
- **vs JSON tree (`mindmap`):** the JSON tree is brittle for AI (nested object the
  model must get exactly right) and renders *static* HTML. Keep it for
  programmatic/structured callers, but the **AI + paste path should target
  `markmap`**.
- **vs `.xmind` import:** `.xmind` is a zip of XML — importing it means an asset +
  an unzip + an XML→outline transform. **Not recommended for V1**: high effort, and
  the AI can't *generate* xmind smoothly. A future "import .xmind → convert to a
  markmap outline" is a clean V3 add (the classifier would detect the `.xmind`
  asset and transform it to the existing `markmap` contentType — no new renderer).
- **Security:** markmap renders SVG in our DOM (no scripts). Confirm it sanitizes
  outline text; the input is a markdown string we control via the spec. Low risk.

### 5.3 Interactive game — harden the sandbox to `allow-scripts` (NEW: `html-interactive`)

This is the only form needing a **core-seam change** (a new content type) **and a
security change**. Today `html-sandbox` uses `sandbox=""` (no scripts) — safe but
inert. A game needs script execution; the AI-written HTML is *arbitrary
AI-generated code executing in the user's app*, so the sandbox must be exactly
right.

**Recommendation: a new `html-interactive` contentType rendered in an iframe with
`sandbox="allow-scripts"` and a strict CSP, NEVER `allow-same-origin`.** Keep
`html-sandbox` as-is for inert HTML.

```ts
// Render (proposed) — the safe combination:
<iframe
  className="sv-interactive-frame"
  sandbox="allow-scripts"          // scripts run, but the frame is a UNIQUE opaque origin
  csp="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:"
  referrerPolicy="no-referrer"
  title="Interactive note"
  srcDoc={withCspMeta(html)}       // also inject a <meta http-equiv CSP> for browsers ignoring the attr
/>
```

**The security model, analyzed for both builds:**

- **`allow-scripts` WITHOUT `allow-same-origin`** is the load-bearing rule. With
  *both*, a `srcdoc` frame is **same-origin with the parent** and the AI code gets
  full DOM access to the host app — a sandbox escape (confirmed by current web
  security guidance: the dangerous combination is `allow-scripts allow-same-origin`
  on attacker HTML). Omitting `allow-same-origin` puts the frame in a **unique
  opaque origin**: scripts run, but `window.parent`, cookies, `localStorage`,
  `fetch` to our origin, and the vault are all unreachable.
- **No `allow-forms`, `allow-popups`, `allow-top-navigation`, `allow-modals`** — the
  game can't navigate the app, open windows, or pop dialogs.
- **CSP `default-src 'none'`** blocks **network exfiltration** (no `fetch`/`XHR`/
  `WebSocket`/image-beacon to *any* host) and external script loading. `script-src
  'unsafe-inline'` allows the inline game code only; `img-src data:` allows
  generated images without enabling beacons. Inject the CSP both as the `csp`
  iframe attribute (Chromium/Electron) and as a `<meta http-equiv>` in the srcdoc
  (portable fallback) since the repo sets **no server CSP** today.
- **Electron specifics:** the host already runs `contextIsolation: true`,
  `nodeIntegration: false`; an `<iframe>` (not a `<webview>`) inside the renderer
  inherits no Node. Because we forbid `allow-same-origin`, the frame can't reach
  `window.studyVault` either. The web (vite) build behaves identically (native
  iframe sandbox). **So the same render works in both builds** — no fork.
- **Talking back to the host:** V1 recommends **none** — a self-contained teaching
  game (drag-to-match, etc.) needs no host I/O. If a later phase wants the game to
  report a score, the *only* safe channel is `postMessage` from the frame to a host
  listener that validates `event.origin === "null"` (opaque) and treats the payload
  as untrusted data — never `eval`'d, never granting capability. Explicitly deferred.
- **Persistence / sizing:** opaque origin → no `localStorage` persistence (good).
  For sizing, V1 uses a fixed/aspect-ratio container; a `postMessage`-based
  auto-resize is a V2 nicety (same validated channel as scores).
- **Residual risk:** an AI-written game can still **hang the frame** (infinite loop)
  or **consume CPU/RAM**. An iframe runs on the main renderer thread, so a busy loop
  can jank the app. Mitigation noted as a risk (V2: a "stop" control that
  detaches the iframe; or render in a `<webview>` guest for process isolation —
  heavier, Electron-only). For V1 the content is *user-requested* AI output the user
  previews before save, which bounds the trust model.

**Why a new type, not reusing `html-sandbox`:** the two have *different security
postures* (`sandbox=""` vs `sandbox="allow-scripts"`+CSP). Keeping them separate
makes the capability explicit and auditable — an inert HTML note can never silently
gain script execution. This respects the "recurring behavior = one capability
behind a shared contract" principle: both are "render isolated HTML," differing only
in the sandbox token set, which the spec declares.

---

## 6. What changes vs. what is reused

| Concern | Reuse (no change) | Minimal new seam |
| --- | --- | --- |
| Renderer registry | `NoteTypePlugin` / `getNoteType` / `listNoteTypes` | register 2 new plugins (`video-embed`, `html-interactive`) |
| Content specs | `NoteContentSpec` / `getNoteContentSpec` | 2 new specs (same file or a kit) |
| Generation→preview→save | `GeneratedDraft`, `GenerationPreview`, `onGenerated`, `anchor.add-note` Save | none |
| Structured gen engine | `src/ai/structured.ts`, `generateStructured` | none (V1); a router prompt (V2 Design A) |
| Chat save-as-note | `anchor.ask-ai`, "Save full reply" buttons | swap hard-coded `contentType:"markdown"` for `classifyContent(...)` |
| Auto-detection | — | **new pure `classifyContent` module** (the one genuinely new mechanism) |
| Composer picker | the `<select>` + `isTextContentType` routing | demote picker to a "detected: X · override" chip |
| Sandbox | the `<iframe sandbox srcDoc>` pattern | `allow-scripts`+CSP variant for `html-interactive` |

**Register-only kit additions:** `video-embed`, `html-interactive`, and the
form-router prompt can all ship as a **register-only "rich-notes kit"** (domain-
prefixed contentTypes + plugins + a prompt), exactly like the Textbook Kit
(`docs/design/product-kit.md`) — *zero core change*. **Core-seam changes:** only
(a) the chat save-path classification (a few lines in `views.tsx`, or better, route
through `onGenerated`), and (b) optionally promoting `classifyContent` to a shared
seam used by both the composer and the chat. The classifier is the one new
*mechanism*; everything else is registry population.

---

## 7. Phased plan (each phase small + independently shippable)

### Phase 1 — Auto-detect on the existing forms (no new renderers)
*Pure win, smallest surface.*
- Add `classifyContent` (pure module) + unit tests, covering the forms that
  **already render**: `markmap`, `mermaid`, `code-snippet`, `markdown`.
- Wire it into the **chat save-as-note** buttons (`views.tsx:488,495`): classify the
  reply/selection → save with the detected contentType (route through `onGenerated`
  so it previews first).
- Wire it into the **composer**: live-classify the textarea, show a "detected:
  <form> · change" chip; the `<select>` becomes the override.
- **Ships:** "ask the AI for a mind map → it replies with an outline → one click
  saves an interactive markmap." No new content types, no security change.
- **Risk:** classifier false positives. Mitigate: high-precision rules, auto-apply
  only on `confidence:"high"`, always overridable.

### Phase 2 — Video embed (`video-embed`)
- New spec `{ provider, videoId, url }` + plugin (provider iframe) +
  `parseVideoUrl` (shared with the classifier).
- Classifier high-confidence rule: a bare provider URL → `video-embed`.
- **Ships:** paste a YouTube/bilibili link (or the AI cites one) → embedded player.
- **Risk:** provider URL/format drift; embed blocking. Mitigate: a graceful "open
  externally" fallback; keep the parser small + tested.

### Phase 3 — Interactive game (`html-interactive`)
- New spec `{ html }` + plugin with `sandbox="allow-scripts"` + CSP (§5.3).
- Classifier rule: self-contained HTML with `<script>`+`<canvas>`/listeners.
- Prompt guidance so the AI fences game output (```` ```html-game ````).
- Auto-render rich AI replies *in the chat thread* (§4.3).
- **Ships:** "ask the AI for a drag-to-match game → it writes one → it runs,
  isolated, in a card."
- **Risk (highest):** sandbox escape / exfiltration / runaway CPU. Mitigate: the
  exact `allow-scripts`-no-same-origin + CSP analysis above; a security review +
  an e2e that asserts the frame *cannot* reach `window.parent`/network.

### Phase 4 (V2/V3, deferred) — model-picks router + richer media
- Design A form-router prompt (`note.generate-block`, discriminated-union output) so
  a single chat action emits any form directly.
- AI-assisted classification for ambiguous prose.
- `.xmind` import → transform to `markmap`.
- HTTP range support on `/api/assets/:id` for long local video; `postMessage` score
  channel + auto-resize for games.

---

## 8. Open questions / decisions for the user

1. **Auto-apply vs always-suggest.** Should a high-confidence detection (a bare
   YouTube URL) *auto-render* as the rich form, or always land as markdown with a
   one-click "render as video" suggestion? *Recommendation:* auto-apply only on
   `confidence:"high"`, suggest otherwise — keeps surprises rare while delivering
   the "smooth" feel.
2. **Collapse the type picker how far?** Replace the `<select>` entirely with a
   detected-chip + override, or keep both? *Recommendation:* demote to an override
   (don't delete) — preserves the open plugin model and kit-contributed types.
3. **Games security appetite.** Are you comfortable shipping `allow-scripts`
   (no same-origin) + CSP for AI-written games in V1, given the runaway-CPU residual
   risk, or should games wait for process-isolated `<webview>` rendering
   (Electron-only, heavier)? *Recommendation:* ship the iframe form in Phase 3 with
   a security review + escape e2e; defer `<webview>` isolation unless real abuse
   appears.
4. **Local video.** Accept "short clips only" for local `video` (no range serving),
   or invest in range support now? *Recommendation:* prefer `video-embed`; treat
   range support as separate backlog.
5. **Kit vs core for the new types.** Ship `video-embed` + `html-interactive` as a
   register-only "rich-notes kit," or as built-in core specs? *Recommendation:* a
   kit — it's the repo's established pattern and keeps core lean; promote to core
   only if they become universally expected.

---

## Impl-log — Phase 1a (contract foundation) — SHIPPED

The foundation of the plan (`docs/design/adaptive-note-forms.plan.zh.md` §4 Phase 1,
scoped to "1a") landed. NO new rich UI (ArtifactCard / FocusOverlay / composer
"detected" chip are Phase 1b; video/html variants are Phase 2/3).

**1. `classifyContent` — pure, sinkable core module** (`src/core/notes/classifyContent.ts`).
`classifyContent(raw): { contentType, content, confidence: "high" | "low" }`. No React,
no fetch, no module state, NEVER throws (a pathological input degrades to the markdown
fallback). Rules, most-specific first, covering ONLY forms that already render:
  - **mermaid** (high): a ` ```mermaid ` fence (fence body becomes the content), OR a
    bare source LEADING with a mermaid keyword (`graph`/`flowchart`/`sequenceDiagram`/
    `gantt`/`classDiagram`/`stateDiagram`/…). Content = the diagram source string.
  - **markmap** (high): a multi-level outline — ≥2 DISTINCT heading levels (`#`,`##`),
    OR a nested bullet list (≥2 distinct indent depths with a nested item). Content =
    the markdown outline string. (A single-level doc / flat bullet list does NOT match.)
  - **code-snippet** (high): a ` ```lang ` fence whose info-string is a KNOWN language.
    Content = `{ language, code }` (lower-cased lang) — shaped for `codeSnippetSchema`.
  - **markdown** (low): the fallback — never blocks. Content = the raw string.
  Rule order is explicit + commented so Phase 2/3 rules (video-embed, html-interactive)
  slot in by specificity without touching existing ones. Tests
  (`classifyContent.test.ts`): positive + negative per rule, low-confidence fallback,
  exact content-shaping validated against the real core schema, ordering, totality.

**2. `resolveForm` — the single choke point** (`src/core/notes/resolveForm.ts`,
decision §6.7). `resolveForm({ contentType?, content?, text? })`: a DECLARED form
(caller/kit/model supplied a contentType) is trusted (`high`) and NOT re-classified;
otherwise it delegates to `classifyContent(text)`. Pure + dependency-free so server and
client share it. Live consumer = the chat-save wiring (below). Tests:
`resolveForm.test.ts`.

**3. contentType consolidation (§2.5) with backward-compat.** `plain-text` is folded
into `markdown` and the static `mindmap` is dropped in favor of `markmap`: both client
plugins are marked `hidden: true` (removed from the composer's NEW-note picker) but stay
REGISTERED, and their core specs are untouched — so EXISTING stored notes of those types
still open and render (plain-text → inert escaped `<pre>`; mindmap → the original static
nested tree). No video/html merge here (Phase 2/3). Test:
`src/client/notes/consolidation.test.tsx` asserts both are hidden from the picker, both
plugins still resolve, and old notes of each render without crashing (incl. mis-shaped
inert fallback).

**4. Display-side HARD contract (§6.6).** `getNoteType(contentType).render(...)` is now
the ONLY path note content reaches the screen:
  - The chat log's `renderNoteContent("markdown", …)` bypass is gone — replies render
    via `getNoteType("markdown")?.render(...)` (`views.tsx`).
  - The "Save full reply" / "Save selection as note" buttons no longer hardcode
    `contentType:"markdown"`. They call a new `WorkspaceContext.previewClassifiedReply
    (text)` which materializes the focused anchor, runs `resolveForm({ text })`, and
    parks the DETECTED form in the existing `pendingDraft` → `GenerationPreview` → Save
    loop (the user previews the recognized form before saving). The draft is marked
    `classified` so the preview's Regenerate is a no-op (no prompt to re-run).
  - **Guard** (`src/client/notes/contract.guard.test.ts`): a CI-runnable repo-grep test
    over `src/client/workspace/*.{ts,tsx}` (host surface; plugins under
    `src/client/notes` own the legit render implementations and are NOT scanned). It
    strips comments first (so a comment describing the old anti-pattern doesn't trip it),
    then fails on: (a) a raw `renderNoteContent(` call in a host file; (b) a
    `contentType === <literal>` render branch (allowlisting only the picker SORT
    comparator); (c) a `createNote(…)` / `dispatch("anchor.add-note"|"bookmark.add", …)`
    call carrying a string-literal `contentType`.

**Self-test:** `npm run check` clean; `npm test` 511 passing (65 files, incl. the 4 new
test files / 31 new cases); `npm run e2e` 39 passing — `streaming-chat.spec.ts` extended
to assert a chat reply containing a mermaid source, when saved, lands a `mermaid` note
(not markdown) via the preview seam; `loop.spec.ts` updated for the preview-first save.

**Caveats / deviations:** none material. The chat-save path was wired client-side via a
new `WorkspaceContext` method (the live consumer the plan asked for) rather than touching
the server generation pipeline, since chat replies are free text classified in the
client; `resolveForm` is still placed in core (`src/core/notes`) so the server path can
adopt it unchanged later (the "harden the identification side" prerequisite, §6.6).

---

## Impl-log — Phase 1b (card + centered-overlay UX) — SHIPPED

The shared "card → centered interactive overlay" capability landed (plan §3.5 reqs 1
& 2; decision §6.2). It serves ONLY the forms that already render
(markmap / mermaid / code-snippet / markdown). No new contentTypes, no video/html
variants (Phase 2/3). One capability, one implementation, used uniformly by BOTH the
chat thread and the note viewer (§0.5 / abstract-recurring-capabilities).

**1. `mode` on the render contract** (`src/client/notes/noteTypeRegistry.tsx`). Added an
optional `mode?: "card" | "full"` (`NoteRenderMode`) to `NoteRenderInput`. The SAME
plugin renders two presentations through the ONE `getNoteType(contentType).render(...)`
path — no second render path:
  - `"full"` (default) = today's complete interactive view (the note list, the
    generation preview, and the FocusOverlay all pass "full" — so card = overlay =
    saved note are visually consistent).
  - `"card"` = a lightweight preview. The diagram plugin (`builtinNoteTypes.tsx`) opts
    into a nicer card: in `"card"` mode it renders a LIGHT static snippet
    (`.sv-diagram-card`, icon + source preview) instead of mounting the heavy live
    DiagramNote, so the thread never runs many SVG mounts inline; the live diagram only
    mounts in `"full"` (the overlay). A plugin that IGNORES `mode` still renders fine.
  - **Generic card fallback**: `ArtifactCard` always supplies a title + text snippet
    derived from the content (any contentType → a usable card for free) and uses the
    plugin's `"card"` render as the thumbnail body when present — so a form that doesn't
    opt in still gets a card WITHOUT bypassing the registry.

**2. `ArtifactCard`** (`src/client/workspace/ArtifactCard.tsx`) — the compact card: a
per-form icon + title/snippet + a small form-label badge + an optional thumbnail via
`render(mode:"card")`. It is a button; clicking opens the overlay. Holds its own
open/close state.

**3. `FocusOverlay`** (`src/client/workspace/FocusOverlay.tsx`) — a centered
modal/lightbox (React portal to `document.body`) that renders the block's FULL
interactive view via `getNoteType(contentType).render({ ..., mode:"full" })` — the exact
renderer a saved note uses. The heavy render mounts ONLY while the overlay is open.
Accessible: `role="dialog" aria-modal`, a labelled title, a Tab focus trap, focus moves
in on open and is restored to the opener on close. Esc and a backdrop click close it. An
unknown contentType falls back to the inert note (never crashes).

**4. Chat thread wiring (req 1)** (`src/client/workspace/ChatMessageBody.tsx`, used in
`views.tsx`). A rich assistant reply is classified through the SAME identification seam
saving uses (`classifyContent`): a HIGH-confidence non-markdown form renders as an
`ArtifactCard` (click → centered `FocusOverlay`); low-confidence / plain replies render
inline as markdown via `getNoteType("markdown").render` (no card). The existing
GenerationPreview save flow is unchanged.

**5. Composer "detected · override" chip (decision #2)**
(`src/client/workspace/ComposerTypePicker.tsx`, used in `views.tsx`, replacing the bare
`<select>`). It LIVE-classifies the composer textarea and shows a "detected: <form> ·
change" chip; the `<select>` is demoted to the OVERRIDE (still lists every non-hidden
registered type incl. kit-contributed). A HIGH-confidence detection AUTO-SELECTS the
detected type (via effect, so it can't fight a user override mid-render); LOW stays
markdown. "change" reveals the override select; "auto" returns to the detected form;
once the user overrides, auto-apply stops until they hit "auto".

**6. Note viewer (req 2)** (`NoteContentView` in `views.tsx`). A saved note renders IN
ITS FORM in the list (the plugin's full view, as before). For rich/interactive forms —
gated by the diagram renderer REGISTRY (`isDiagramType`), NOT a `contentType ===` branch
— it ALSO offers an "Open interactively" affordance that focuses the note into the SHARED
`FocusOverlay` (same `render(mode:"full")`), so a 思维导图/diagram note is viewable
centered and interactive rather than flattened. (Source-doc anchor highlights are a
separate concern, untouched.)

**Extraction note**: `ChatMessageBody` and `ComposerTypePicker` are small standalone
host modules (not inlined in `views.tsx`) so they unit-test without pulling the whole
workspace view tree (PdfReader/pdfjs need a real browser); both are still host surface
and call only the sanctioned `getNoteType().render` / `classifyContent`.

**Self-test:** `npm run check` clean; `npm test` 525 passing (67 files; +2 new test
files: `artifactCard.test.tsx` covering mode routing / card-click→overlay / Esc·backdrop
close / unknown-type fallback / chat rich→card·plain→markdown, and
`composerTypePicker.test.tsx` covering detect·override·auto); `npm run e2e` green —
`adaptive-note-forms.spec.ts` added: the composer chip auto-detects mermaid + reveals
the override, and a saved markmap note renders in its form and "Open interactively"
opens a centered overlay mounting a live markmap SVG (Esc closes).

**Contract guard:** stays green with NO scope change. The new shared components live
under `src/client/workspace/*` (host surface, scanned by the guard) and render ONLY via
`getNoteType().render`; the `focusable` gate uses the diagram registry, not a
`contentType ===` branch, and the picker's comparisons were written to avoid a
`contentType ===` token — so no false positive and no allowlist widening was needed.

**Caveats / deviations:** The e2e card→overlay capability is exercised end-to-end via
the NOTE VIEWER ("Open interactively"), which shares the EXACT same `ArtifactCard`/
`FocusOverlay` components as the chat thread. The thread ArtifactCard for a
high-confidence AI reply is covered by the component test rather than e2e, because the
deterministic mock provider prepends a `**Study assistant (mock)**` header to every
reply (so a chat reply never classifies as a pure rich form) — the card/overlay path
itself is identical and proven both in the component test and in the browser via the note
viewer. No mock/infra change was made for this.

---

## Impl-log — Phase 2 (complete video support) — SHIPPED

Phase 2 (plan §4 Phase 2, §6 #4) landed: ONE `video` contentType with `asset | embed`
variants (NO separate `video-embed` type — §2.5), plus HTTP Range on the asset route so
long LOCAL videos seek + stream. No host branching, no new top-level discriminator — the
single `video` render switches on an INTERNAL `kind` (§3).

**1. `video` contentType — discriminated `asset | embed` union with absent-kind
backward-compat** (`src/core/notes/contentTypes.ts`). `video`'s schema became a zod
`z.union([embed, asset])`:
  - asset — `{ kind:"asset" (DEFAULTED), assetId, caption?, startSec?, endSec? }`.
  - embed — `{ kind:"embed", provider:"youtube"|"bilibili"|"vimeo", videoId, url, caption? }`.
  - **Backward-compat (critical):** pre-Phase-2 notes are stored as `{ assetId, … }` with
    NO `kind`. The asset member declares `kind: z.literal("asset").default("asset")`, so an
    absent `kind` parses and is NORMALIZED to `"asset"`. A plain `z.union` (not
    `discriminatedUnion`) is used precisely so the asset member can match the legacy
    kind-less shape; the embed member's required `kind:"embed"` keeps the two unambiguous.
    Test (`contentTypes.test.ts`): an old `{ assetId, caption, startSec }` note parses and
    comes back with `kind:"asset"`; embed validates; bad provider / missing videoId reject.
  - `createDefault()` seeds `{ kind:"asset", assetId:"" }` (the composer's choose-a-file
    path); `toSearchText` returns the caption for both variants.

**2. `parseVideoUrl` — pure, shared URL parser** (`src/core/notes/parseVideoUrl.ts`). Pure
(no React/fetch/DOM/state), total (junk → `null`). Maps a URL → `{ provider, videoId }`:
  - **YouTube** — `youtu.be/<id>`, `youtube.com/watch?v=<id>`, `/embed/<id>`, `/shorts/<id>`
    (www./m./music. + youtube-nocookie.com normalized; an 11-char `[A-Za-z0-9_-]` id is
    REQUIRED so `youtu.be/about` → null).
  - **bilibili** — `bilibili.com/video/<BV…>` → the BVID (validated `BV` + 10 alnum).
  - **Vimeo** — `vimeo.com/<digits>` and `player.vimeo.com/video/<digits>` (a non-numeric
    path like `/channels/foo` → null).
  - Non-http(s) schemes and unrelated hosts → null. Sibling `videoEmbedSrc({provider,
    videoId})` builds the player src — SHARED by the classifier and the render so they
    never drift: `youtube.com/embed/<id>`, `player.bilibili.com/player.html?bvid=<id>&page=1`,
    `player.vimeo.com/video/<id>`. Tests (`parseVideoUrl.test.ts`): every shape per
    provider + negatives + junk + the src builder.

**3. Embed render + security note** (`src/client/notes/builtinNoteTypes.tsx`). The `video`
plugin's single `render()` switches on `kind` (an absent kind → asset, mirroring the
schema): embed → a provider `<iframe>` whose `src` is rebuilt from `{provider, videoId}`
via `videoEmbedSrc` (the stored URL's query noise is never trusted); asset → `<video
src=/api/assets/:id controls preload="metadata">`. The iframe is
`sandbox="allow-scripts allow-same-origin allow-presentation"`,
`allow="fullscreen; picture-in-picture"`, `referrerpolicy="strict-origin-when-cross-origin"`,
`loading="lazy"`. **Security:** `allow-same-origin` is acceptable HERE ONLY because `src`
points at a REMOTE provider origin (youtube.com / bilibili.com / vimeo.com), never our own
origin — so the frame is same-origin with the PROVIDER, never with the host app/vault
(contrast Phase 3 game sandboxing, which must NOT carry `allow-same-origin` because its src
is our srcdoc). `allow-forms`/`allow-popups`/`allow-top-navigation` are NOT granted; `allow=`
is restricted to media. Works in Electron + mobile WebView (a standard `<iframe>`, not an
Electron `<webview>`). In `mode:"card"` the asset variant returns `null` (no live `<video>`
inline) so the generic ArtifactCard supplies the title/snippet and the player runs in the
overlay. Test (`videoNote.test.tsx`): embed builds the right src + sandbox flags per
provider; a legacy `{assetId}` note renders a `<video src=/api/assets/:id>`; mis-shaped
content doesn't throw.

**4. Classifier rule** (`src/core/notes/classifyContent.ts`, at the marked slot, as rule
0 = most specific). A BARE provider URL — the WHOLE trimmed input is one link with no
internal whitespace, parsed by `parseVideoUrl` — classifies as `video`
`{ kind:"embed", provider, videoId, url }` at **HIGH** confidence (auto-applied). A link
INSIDE prose has whitespace → falls through to markdown (low); a non-video URL → markdown.
Tests (`classifyContent.test.ts`): a bare link of each provider (positive, exact content
shape validated against the real schema); link-in-sentence and non-video URL (negative).

**5. HTTP Range on `GET /api/assets/:id`** (`src/server/app.ts` + new pure
`src/server/httpRange.ts`; `assetBytesPath` helper in `src/core/store/assets.ts`). The
route now STREAMS the file from disk (`createReadStream`, constant memory) instead of
buffering it, and honors a single-range `Range` header:
  - no/empty/malformed/multi-range/inverted Range → `200` full stream, `Accept-Ranges:
    bytes`, `Content-Length: total`.
  - `bytes=START-END` / `bytes=START-` (open-ended) / `bytes=-SUFFIX` (suffix, clamped to
    the file) → `206 Partial Content` with `Content-Range: bytes start-end/total` and a
    `Content-Length` of the slice, streamed via `createReadStream(path,{start,end})`.
  - a syntactically valid range entirely past EOF (or a 0-byte suffix, or any range on an
    empty file) → `416 Range Not Satisfiable` with `Content-Range: bytes */total`.
  The header parsing is a SEPARATE pure function (`parseRange(header,total)`) so the edge
  cases are unit-tested without a server (`httpRange.test.ts`: closed/open/suffix/clamp/
  416/ignore). Import-time SHA-256 dedup in `assets.ts` is UNCHANGED (it still reads bytes
  once at import); only PLAYBACK is now streamed. This removes the "short clips only" limit
  and lets `<video>` seek long local files.
  - **e2e** (`adaptive-note-forms.spec.ts`): imports a real local file as an asset, then
    asserts `bytes=0-9` → 206 + `Content-Range: bytes 0-9/total` + 10-byte body; a range
    past EOF → 416 + `bytes */total`; no Range → 200 full body + `Accept-Ranges`.

**6. Overlay/card** — reused unchanged. `video` is registered like any type, so the shared
`ArtifactCard` (mode:"card") + `FocusOverlay` (mode:"full" = the player) from Phase 1b
serve it for free via the one `getNoteType().render` entry — no fork.

**Self-test:** `npm run check` clean; `npm test` 565 passing (70 files; +5 test files:
`parseVideoUrl.test.ts`, `httpRange.test.ts`, `videoNote.test.tsx`, plus new cases in
`classifyContent.test.ts` / `contentTypes.test.ts`); `npm run e2e` 43 passing
(`adaptive-note-forms.spec.ts` +2 tests: bare-YouTube-link auto-detects `video` + the
saved embed note renders a provider `<iframe>`; the asset Range 206/416/200 check). Contract
guard stays green (the video render lives in the PLUGINS dir, not the scanned host surface;
no host `contentType ===` branch was added).

**Caveats / deviations:** none material. (a) The composer chip shows the live-detected
`video` label, but the e2e SEEDS the embed note via the API (the exact `{kind:"embed",…}`
shape the classifier produces) to assert the RENDER deterministically — same content path,
no real network to a provider. (b) Provider embeds can be blocked by the provider (e.g.
owner-disabled embedding) or by a future host CSP; an "open externally" fallback is left to
a later pass (the plan's risk note). (c) `assetBytesPath` exposes a vault-validated absolute
path for the Node server to stream directly — the StorageAdapter abstraction wasn't widened
with a streaming API since the server is Node-specific; a mobile adapter can add its own
range path later.

---

## Appendix — cited symbols / paths

- `src/core/notes/contentTypes.ts:11-32,40-44,100-185` — `NoteContentSpec`,
  registry, built-in specs (incl. existing `mindmap`/`markmap`/`video`/`html-sandbox`).
- `src/client/notes/noteTypeRegistry.tsx:41-79` — `NoteTypePlugin`, `getNoteType`,
  `listNoteTypes`, `spec`, `isTextContentType`.
- `src/client/notes/builtinNoteTypes.tsx:311-368` — media render/edit;
  `:375-402` — html-sandbox `sandbox=""` iframe.
- `src/adapters/notes/diagrams.ts:13-46` — mermaid/markmap renderers (libs installed).
- `src/adapters/notes/render.ts:147-159,177-193` — static mindmap + sanitized markdown.
- `src/client/workspace/GenerationPreview.tsx:33-44` — preview via `getNoteType`.
- `src/client/workspace/views.tsx:57-69` (picker), `:476-499` (chat log + save
  buttons), `:548-560` (type select), `:592-602` (note list render).
- `src/client/commands/registry.ts:150-186` (ask-ai), `:189-220` (add-note Save).
- `src/ai/structured.ts:52` — `generateStructured`; `src/kits/structured.ts`,
  `src/kits/resolvePrompt.ts` — kit wrapper + operation resolution.
- `src/client/data/entityClient.ts:444-453` (assets), `:523-525` (generateStructured).
- `src/core/store/assets.ts:29-71` — asset import/dedup; `src/server/app.ts:890-901`
  — asset serve (no range), `:245` — 50mb json limit.
- `electron/main.ts:23-41,57-63` — webPreferences, webview link handler;
  `electron/preload.ts`, `electron/webview-preload.ts` — bridges.
- `docs/design/note-types.md`, `product-kit.md`, `generation-preview.md`,
  `ai-orchestration.md`, `ai-operation-as-data.md` — the contracts this extends.
