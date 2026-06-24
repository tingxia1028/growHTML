# Note Types — client NoteType plugins (render + edit) + media notes (P4)

Landing doc for **P4** of `frontend-workspace-redesign.md` (§P4 + §6 Note model).
It decouples a note's **content** from its **editor** and its **renderer** via a
client `NoteTypeRegistry`, and turns on **structured** notes (flashcard, quiz,
mindmap, code) and **media (local asset)** notes (image/audio/video) plus a
**sandboxed HTML** note.

> **Success check (met):** adding a note type = register **one** core
> `NoteContentSpec` + **one** client `NoteTypePlugin`. **Zero** edits to
> App/Workspace/Shell — the composer's type picker and the note list both follow the
> registry.

## 1. The three-way split: content vs. editor vs. renderer

A note type is split across two registries so each half lives in exactly one place:

| Half | Where | Owns |
| --- | --- | --- |
| **content** (data) | `src/core/notes/contentTypes.ts` — `NoteContentSpec` | the zod `schema`, `createDefault()`, `toSearchText()`. **Server + client share it.** The API validates `content` with `getNoteContentSpec(contentType).schema` before persisting (unknown type → 400). |
| **editor + renderer** (React) | `src/client/notes/noteTypeRegistry.tsx` — `NoteTypePlugin` | `render(input)` (how a saved note is shown) + `edit(input)` (the composer editor). |

`Note.content` in the core schema is `unknown`; its shape is owned entirely by the
content spec. The client plugin **must not redefine the schema** — it reaches its
paired spec through `spec(contentType)` (which throws if there is no core spec, a
wiring bug) and `createDefaultContent(contentType)`. This is the iron law of P4:
content shape is defined once, in core.

```ts
// src/client/notes/noteTypeRegistry.tsx
type NoteRenderInput = { content: unknown; note?: NoteRecord; ctx?: unknown };
type NoteEditInput   = { content: unknown; onChange(next: unknown): void };

type NoteTypePlugin = {
  contentType: string;
  render(input: NoteRenderInput): ReactNode;   // saved note → display
  edit(input: NoteEditInput): ReactNode;        // composer editor → onChange(content)
  label?: string;                               // friendly name for the type picker
};

registerNoteType(plugin): void          // register (later wins for the same contentType)
getNoteType(contentType): NoteTypePlugin | undefined
listNoteTypes(): readonly NoteTypePlugin[]
spec(contentType): NoteContentSpec       // the paired core spec (throws if missing)
createDefaultContent(contentType): unknown
isTextContentType(contentType): boolean  // typeof createDefault() === "string"
```

**Editor contract.** `edit()` is a *controlled* editor: it renders from the `content`
it is handed and calls `onChange(next)` with the next content on every change. It
**never persists** — the composer collects `content` and POSTs it. A structured
editor (flashcard/quiz/…) always emits a value that satisfies the core schema; the
JSON editor (mindmap) validates against `spec(contentType).schema` and only emits
when it parses cleanly (invalid JSON/shape leaves the last valid content in place).

**Renderer contract.** `render()` **never throws** on a foreign/mis-shaped content —
it coerces with a tolerant `as*()` helper and falls back to inert, escaped `<pre>`
text, mirroring `renderNoteContent`'s contract. A foreign or hand-rolled note can't
crash the note list. An **unknown** contentType (no registered plugin) renders via
the exported `InertNote` fallback.

## 2. The 12 built-in plugins

Registered in `src/client/notes/builtinNoteTypes.tsx` (importing it runs the
`registerNoteType` calls — the same side-effect pattern as views/inspectors). Each
pairs with the matching core spec.

| contentType | content shape | render | edit |
| --- | --- | --- | --- |
| `markdown` | `string` | sanitized markdown HTML (`renderNoteContent`) | textarea (shared `.composer-input`) |
| `plain-text` | `string` | escaped inert `<pre>` (no markdown/HTML) | textarea |
| `mindmap` | `{ title?/text?, children? }` | nested `<ul>` tree (`renderNoteContent("mindmap")`) | JSON textarea, validated against the spec |
| `flashcard` | `{ front, back }` | flip card (`<details>/<summary>`) | front / back fields |
| `mermaid` | `string` | `<DiagramNote>` (async mermaid SVG) | textarea |
| `markmap` | `string` | `<DiagramNote>` (async markmap SVG) | textarea |
| `quiz` | `{ question, options[], answerIndex, explanation? }` | question + options (answer marked `.sv-quiz-answer`) | question + option rows + answer radio + "add option" |
| `code-snippet` | `{ language, code }` | `<pre><code class="language-…">` | language field + code textarea |
| `image` | `{ assetId, caption? }` | `<img src=/api/assets/:id>` + caption | file picker (desktop) + caption |
| `audio` | `{ assetId, caption?, startSec?, endSec? }` | `<audio controls src=…>` + caption | file picker + caption |
| `video` | `{ assetId, caption?, startSec?, endSec? }` | `<video controls src=…>` + caption | file picker + caption |
| `html-sandbox` | `{ html }` | scriptless sandboxed `<iframe>` | textarea |

**String vs. object routing in the composer.** `isTextContentType()` (decided by the
core spec's own default) routes string types (markdown/plain-text/mermaid/markmap)
through the shared `.composer-input` textarea + `submitComposer` (`payload.text`) —
**the exact path the existing composer e2e drive, unchanged**. Object types
(flashcard/quiz/mindmap/code/media/html-sandbox) hide that textarea and render the
plugin's structured `edit()`, holding the draft in `noteContent` and saving via
`submitNoteContent` (`payload.content`). `markdown` stays the default type.

The `anchor.add-note` command was extended with an optional `payload.content`
(structured object) that takes precedence over `payload.text`; `isAvailable` accepts
either non-empty text or a defined `content`.

## 3. Media (local asset) notes

Media is **not** embedded in the note — the note's content holds a structured
reference `{ assetId, caption? }`. The bytes live in the vault as an **Asset**:

- **EDIT (desktop-only):** "Choose file…" calls `window.studyVault.openFile()` (native
  dialog) → `entityClient.importAsset(absPath)` → `POST /api/assets/local-file {path}`
  copies the file into `vault/assets/<id>.<ext>` and returns an `AssetRecord`. The
  editor stores `asset.id` in the content. In a **browser** the picker is disabled
  with a "desktop app" hint (no native file path is available).
- **RENDER (browser-friendly):** the media element's `src` is
  `entityClient.assetUrl(assetId)` = `/api/assets/<id>` (the raw-bytes route). Because
  the file was **copied into the vault**, the note still renders after the original
  file is moved/deleted and after an app restart.

## 4. html-sandbox safety

An html-sandbox note renders its `{ html }` inside `<iframe sandbox="" srcDoc={html}>`.
The **empty** `sandbox` attribute is the most restrictive setting: no script
execution, no form submission, no same-origin access, no top-level navigation, no
popups. Delivering the HTML via `srcDoc` (not by injecting into the host DOM) means
even a `<script>` in the note is inert — it can never run or reach the host app. This
reuses the isolation principle of the `LocalHtmlReader` webview (untrusted content in
a separate, capability-stripped frame).

## 5. Wiring into the study view

`src/client/workspace/views.tsx` (the `study` view):

- **Note list:** each note renders via `getNoteType(note.contentType).render({content,
  note})`; an unknown type → `<InertNote>`. (Replaced the hard-coded
  `renderNoteContent` / `DiagramNote` / `isDiagramType` switch.)
- **Composer (Note mode):** the `<select>` lists **every** registered type
  (`listNoteTypes()`, markdown first). String types use the shared textarea; object
  types render the chosen type's `edit()` seeded from `createDefault()`. Save sends the
  structured `content` (string types keep the legacy `text` path).

`WorkspaceContext` gained `noteContent` / `setNoteContent` / `submitNoteContent` and a
type-change handler that re-seeds the structured draft from the new type's default.

## 6. Test matrix (REAL — no fake-green)

**Unit — `src/client/notes/noteTypeRegistry.test.tsx` (jsdom, +22 tests):**

- registry: a plugin exists for all 12 core specs; later registration wins; `spec()`
  returns the paired core spec / throws for unknown; `isTextContentType` correct.
- **render per type** (sample content): markdown (sanitized + escapes injected
  markup), plain-text (escaped inert), mindmap (tree), flashcard (flip card),
  mermaid/markmap (delegate to a mocked `DiagramNote`), quiz (question + marked
  answer), code-snippet (`<pre><code>` + language), image/audio/video (media element
  with `src=/api/assets/:id`), image-empty hint, html-sandbox (`sandbox=""` + `srcdoc`,
  no live `<script>`), and **never throws** on foreign content.
- **edit per type** — `onChange` emits content that **round-trips
  `spec(type).schema.parse`**: markdown, flashcard, quiz (incl. answer radio),
  code-snippet, mindmap (valid JSON emits / invalid does not), html-sandbox, media
  caption.

**Web e2e — `e2e/note-types.spec.ts` (+3, server-backed):**

- **flashcard** composer: front/back form → saved note renders a flip card.
- **quiz** composer: question/options/answer form → saved note renders the question +
  marked answer.
- **media render**: seed an asset (`POST /api/assets/local-file` on a temp PNG) + an
  `image` note (`POST /api/notes {contentType:"image", content:{assetId}}`) → the note
  list renders `<img src="/api/assets/<id>">` that actually decodes (`naturalWidth>0`).

**Electron e2e — `e2e-electron/note-types.spec.ts` (+1, desktop pick path):**

- **image note pick**: stub `dialog.showOpenDialog` (via `app.evaluate`) to return a
  temp PNG → choose the `image` type → "Choose file…" → `importAsset` → Save → the note
  renders `<img src=/api/assets/asset_…>` that decodes. Proves the full
  pick→import→render flow that the native dialog makes undriveable in web mode.

**Guardrail:** all existing e2e stay green on their **original selectors** — web 10
(loop/concepts/regions/viewer-flows) + electron 7 (app/terminal/webview/local-html/
viewer-flows). The composer's markdown text path (`.composer-input` + "Save Note") and
the `.study-panel > .chat-box`/`.note-list` structure are unchanged.

**Gate:** `tsc --noEmit` clean · vitest **245** (223 + 22) · web e2e **13** (10 + 3) ·
electron e2e **8** (7 + 1) — all green.
