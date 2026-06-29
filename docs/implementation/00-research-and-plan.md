# Research And Implementation Plan

## Current Goal

2026-06-29 update: pixel-match the Growte workspace frontend to the provided UI reference. Scope is the web/Electron React shell only: default demo reading state, TopBar Layer Lens popover, document/library/right-column polish, and visual verification through the running Vite app.

Implement Slice 1 of AI Study Vault: local Vault data layer, HTML adapter, server API, seed script, and a minimal no-AI client loop. Slice 1 is complete as of 2026-06-23; the next major slice is the AI Runtime/provider/action layer.

AI Study Vault should make learning materials into AI-addressable objects:

- `Source`: original learning material.
- `Anchor`: precise location inside a source.
- `Note`: learning record from user or AI.
- `Patch`: proposed source modification that must be reviewed before apply.
- `Concept`: extracted knowledge node.
- `Relation`: typed edge between learning objects.
- `Plugin`: extension mechanism for source formats, AI actions, context, views, exports, and tools.
- `AI Runtime`: provider-agnostic orchestration, context collection, structured result parsing, permissions, and history.

## Context Notes

- Project: GrowHTML, a local HTML learning-material workspace.
- Main scripts:
  - `npm run dev`: start server and client.
  - `npm run build`: run TypeScript compile and Vite build.
  - `npm run check`: run TypeScript compile without emitting files.
- Current workflow files live under `docs/implementation/`.
- Current branch: `codex/ai-study-vault`.
- Existing GrowHTML primitives that can be evolved:
  - `SelectionPayload` is an early `Anchor`.
  - `AiProposal` is an early `Patch`.
  - `ThreadEntry` is an early `Note` / AI interaction history.
  - `storage.ts` is a single-document persistence layer that can become a vault service.
  - `/api/ai/propose` is a first AI Action endpoint but is still tied to HTML replacement.

## Obsidian Reference Notes

Obsidian itself is not a public open-source application to copy from directly. Publicly useful references are:

- Obsidian's license page: local-first data ownership and app code rights boundary.
- `obsidian-api`: public TypeScript API definitions and architecture concepts.
- `obsidian-sample-plugin`: plugin shape, manifest, lifecycle, commands, settings, views.
- Open community plugins such as Dataview, Metadata Extractor, and Local REST API.

Borrowable ideas:

- Keep a small, stable core: `App`, `Vault`, `Workspace`, `MetadataCache`, `Plugin`, `View`.
- Treat files/data as user-owned, local-first, and externally inspectable.
- Use a registry-style plugin surface instead of hard-wiring every capability.
- Keep metadata/indexing separate from raw files.
- Make views and commands installable capabilities rather than core assumptions.
- Use APIs/lifecycles to register commands, views, settings, and cleanup handlers.

Do not borrow:

- Obsidian's exact UI, internal app code, or proprietary implementation details.
- Markdown-only assumptions as the center of the model.
- Plugin marketplace complexity for the first implementation.

## Open Questions

Use this section for product or engineering questions that must be answered before implementation.

| ID | Question | Status | Decision (2026-06-23) |
| --- | --- | --- | --- |
| Q-001 | Web/Vite first vs desktop (Electron/Tauri) early? | Re-decided 2026-06-23 | **Go desktop — Electron (confirmed).** A pure web app cannot embed arbitrary *live* webpages with an annotation overlay (X-Frame-Options + same-origin). Desktop webview (Electron `BrowserView`/`<webview>` + preload injection) can, and also unlocks direct local-filesystem access. Electron reuses the TS/Node/Express/React stack with least friction (core/adapters already pure TS); Tauri is lighter but needs Rust shell + Node sidecar and constrains webview injection. Originally "stay web for MVP"; superseded once embedded-browser web annotation became a goal. |
| Q-002 | Single HTML doc vs multi-source vault for MVP? | Resolved | Greenfield rewrite to a multi-source Vault. Slice 1 builds the vault data layer first (no AI). The single-doc GrowHTML / GrapesJS model is dropped. |
| Q-003 | Keep Claude/Codex vs pivot to OpenAI/Ollama? | Resolved | Provider is a plugin. Implement Claude Agent SDK as the first `ModelProvider` plugin (capability-based interface); add OpenAI-Compatible + Ollama later behind the same interface. |

## Approved Direction & Slice Plan (2026-06-23)

Decision: **greenfield rewrite in-place** (replace `src/`, keep git history and the TS/Vite/React/Express toolchain). Add **Zod** (DTO + AI-output + JSONL-record validation, and JSON-Schema generation for structured model output) and **Vitest** (data-layer unit tests). Storage is **JSONL behind a `Store` interface** (SQLite-swappable later). `core/` and `adapters/` stay pure TS (no React/Express imports) for future desktop repackaging.

### Why rewrite (not evolve)

- GrowHTML edits a GrapesJS component tree (`project.json`) as live editor state; the Vault treats source content as data and every change as a reviewable **Patch**. Two truth-sources cannot coexist cleanly, so the GrapesJS WYSIWYG layer is dropped for MVP.
- "Editing" is not its own abstraction. It decomposes into: `Source.content` (canonical bytes, single source of truth) + `Patch` (the only mutation primitive, append-only log) + `Anchor` (stable pointer: studyId + selector + quote + context). `Note`/`Concept`/`Relation` are overlays that reference anchors and never mutate content. The rendered view = `materialize(Source.content, appliedPatches)` + overlays — a projection, not stored editor state.

### Scope risk & competitive reality (red line — re-read before adding features)

Honest assessment so we don't drift into a pseudo-requirement:

- **Real, underserved core:** read → select → ask AI → answer **anchored back to the spot** + **persisted as reusable Note** + AI proposes **reviewable Patch to the source itself**, all **local + your own model (subscription)**. The patch-the-source-with-review idea is the genuinely novel bit (borrowed from Cursor/Canvas, applied to learning materials).
- **Competitive truth:** every single feature already exists well somewhere — NotebookLM (grounded Q&A + citations, cloud, no editing), Obsidian+Copilot (local + plugins + graph, markdown + annotate-only), Cursor/Canvas/Artifacts (reviewable AI edits, code/single-doc), MarginNote/Hypothesis/Heptabase (anchored annotation, no AI patch). **No tool does the full combination, but for many users one of them is ~80% enough.** The wedge is narrow: *AI-proposed reviewable edits to your local any-format materials, using your model, anchored and owned.*
- **Highest pseudo-requirement risk inside this project:** (1) **Concept/Relation/Graph** — classic PKM "sounds great, rarely maintained", high cost / uncertain ROI → treat as a late, optional bet, only after the core loop earns daily use; (2) **universal formats** (Word/PDF/code/audio) — each is a project, scope creep; (3) full **plugin marketplace** (PRD §17 already cut it).
- **Red line:** nail the HTML (then PDF) "ask + anchor + patch + note" loop to daily-use quality FIRST. Do not pull the graph or new formats forward. Rich note types and sharing are differentiators but stay tiered/deferred per their sections.

### Direction update (2026-06-23): desktop app + web annotation; editing deferred but kept

The product becomes a **desktop app (Electron recommended)** that is a superset, not a pivot away from editing:

- **Two source modes, one model** (already covered by `SourceAdapter.capabilities`):
  - Local files: HTML/MD (editable-capable), PDF/Word (annotation-only; Word may convert→HTML).
  - Web pages: embedded webview (`BrowserView`/`<webview>` + preload injection), annotation-only.
- **Editing is deferred but kept, modeled as capability + plugin contributions — not deleted:**
  - The `Patch` entity (schema/store) stays in **core** (dormant); the adapter's `applyPatch` stays as the `editable` capability.
  - The editing *experience* is pluggable: a **Patch-Review ViewPlugin** + **Rewrite/Insert AIAction plugins**. MVP simply does not register them, and a feature flag + `capabilities.editable` gate the UI → the reader runs read-only + annotate. Turning editing on later = register those plugins; no code changes. (Slice 1's C5a/C5b + patch API/UI stay dormant, not wasted.)
- **Source identity is polymorphic:** local = `contentHash`; web = **normalized URL** (strip tracking params, unify protocol, honor `rel=canonical`). Never use the raw URL as a primary key.
- **Web anchoring uses the W3C Web Annotation model** (TextQuote/TextPosition/Range selectors) so annotations are cross-user shareable — studyId injection does not persist on live third-party pages. Hypothesis (open-source) is the reference implementation.
- **Sharing + filter-by-author** reuses the reserved `Note.authorId`/`visibility`; add a remote `NoteService` keyed by normalized URL with author filtering. No CRDT (additive author-keyed set).
- **Honest scope note:** desktop + local multi-format + embedded-browser web annotation + AI + sharing + rich notes is a meaningfully bigger product. Sequence strictly: (S1 done: local HTML loop) → wrap in Electron shell → webview web-annotation (URL id + W3C anchor, read-only) → shared NoteService + author filter → PDF/Word adapters. Each step independently verifiable.

### Target module layout

```
src/core/        # pure data layer: schema/ (Zod, single truth), ids, vault, store/ (snapshot upsert + atomic rename), fixtures/
src/adapters/    # SourceAdapter interface + html/ (core.ts: parse/materialize/applyPatch via linkedom; anchor.ts: resolve + conflict guard)
src/ai/          # AI Runtime: runtime, capability-based ModelProvider, providers/claude-agent, actions/, context/, parser, permissions
src/plugins/     # registry for adapters/providers/actions/context/views/exports/note-content-renderers
src/server/      # Express API over core + ai
src/shared/      # shared DTOs (Zod)
src/client/      # React: library + reader + AI panel + Note/Patch history (Graph later)
```

### Source Adapter / Renderer / Overlay model (forward-compat; HTML-only in Slice 1)

Viewers are plugin-ized: each format registers a pair keyed by source `type`. Data ops live in core (pure TS); rendering + selection live in the client. The generic core never learns about formats; formats never re-implement Note/Patch/Concept content.

```ts
// core half (server, pure TS) — data/format operations
interface SourceAdapter {
  type: string
  capabilities: { editable: boolean; anchorKinds: AnchorKind[] }   // HTML/MD editable; PDF/image annotation-only
  load(src): Promise<LoadedSource>
  resolveAnchor(anchor): ...        // editable / locatable formats
  applyPatch?(patch): ...           // editable only
}

// client half — the "viewer", what the user asked about
interface SourceRenderer {
  type: string
  render(container, loaded): void                 // html→iframe/shadow, pdf→PDF.js, code→highlight, image→<img>
  captureSelection(): Promise<AnchorDraft | null>
  // overlay support: generic objects in, format-specific decoration out
  locateAnchor(anchor): Region | null             // anchor → position in THIS view
  decorate(overlays: Overlay[]): void             // draw highlights/markers
  onOverlayActivate(cb: (overlayId) => void): void
}
type Overlay = { id: string; anchorId: string; kind: 'note' | 'patch' | 'concept'; status?: string }
```

How Note/Patch/Concept "adapt" to any format — **the Anchor is the only contract; the format plugin owns "where + highlight", never the content**:

- core feeds the renderer the loaded source + the `Overlay[]` for visible anchors → `render()` then `decorate()` → click a marker → `onOverlayActivate` → the **generic** Note panel shows the Note's content. No per-format Note rendering.
- `Note` carries no `format` field. Two resolvers share one Anchor: core-side `resolveAnchor` (for Patch) and view-side `locateAnchor` (for highlight).

#### Note is its own independent layer (data + logic + render)

Note is NOT baked into the source — it is a separate layer composited over the Source layer, coupled only via `renderer.locateAnchor(anchor) → Region`. Source rendering never mutates to show a note; re-rendering the source never loses notes; non-editable formats (PDF/image) annotate fine.

```
writers ─────────────────►  core data  ────────►  layers (top → bottom)
user(UI) / AI provider / embedded CLI    notes.jsonl    Note Layer  (own render + logic, pure overlay)
   (all go through core APIs)            patches.jsonl
                                         sources/*       Source Layer (renderer, read-only view)
```

- Unidirectional data→render: every writer just writes data; the Note layer reactively re-renders. AI "adding an explanation" = writing a note record → it floats in; *feels* like direct editing, mechanically it is layered data writes.
- `NoteService` (CRUD/anchor-binding/link/filter, format-agnostic, single impl) is the logic; `NoteLayer` (draws highlights/margins/popovers in its OWN DOM, positions via `locateAnchor`) is the render. Both Source and Note layers are parallel.
- **Sharpened boundary:** Note = always its own overlay layer, never enters source content. Putting content *into* the document is explicitly a **Patch** (reviewable, editable-only), not a Note variant. Note = annotate; Patch = mutate source. Fully separated.
- **Embedded CLI is just another writer**, with a hard split by permission: note-type output → write `notes.jsonl` directly (`write_note`, additive/reversible); source-content changes → MUST emit a Patch for user review (`write_patch`/`modify_source`), never edit the source file directly.

#### Note layer can evolve into a shared layer (WeChat-Read-style; post-MVP)

Because Note is decoupled from Source via Anchor, "shared annotations over a shared source" = swap the `NoteService` backend (local JSONL → synced remote) + add identity/visibility. No source/renderer change. **No CRDT needed** — annotations are an additive set of independent author-keyed records (union/sync); CRDT is only for concurrent edits of *one* note's text, which we don't do.

- Prerequisites (deferred): (1) shared **source identity** via `Source.contentHash` — same hash = shareable, mismatched copies don't align; (2) **portable anchor resolution** by quote+context (already in the anchor design; unresolvable → orphaned); (3) sync + author + privacy (sharing is opt-in per note, tied to the permission model).
- Tiers by difficulty: personal multi-device sync (notes.jsonl via git/cloud) → small-group shared vault (author + visibility, server store) → public social annotation (canonical shared sources + aggregation + moderation).
- Forward-compat reserved now (cheap, MVP stays single-user/private): Note `authorId` + `visibility` (default `private`), `Source.contentHash`; `NoteService` is an interface so a synced backend drops in later.

Slice 1 implements only the HTML pair; PDF/Word/code/image are Slice 4 (M8–M10). Word MVP = convert `.docx`→HTML on import (mammoth.js) and reuse the HTML pair; a true editable `.docx` adapter is post-MVP.

#### Rich note content (beyond text; a differentiator vs Obsidian)

Because Note is its own render layer, its `content` is a **typed payload** rendered by a pluggable `NoteContentRenderer` keyed by `contentType` — parallel to `SourceRenderer`. This is essentially "Claude Artifacts attached to notes" and is the answer to "Obsidian annotations are text-only". Same **data-vs-code → sandbox** rule as the rest of the architecture:

| Tier | `contentType` | Nature | Safety | When |
| --- | --- | --- | --- | --- |
| A text | `markdown` | data | safe, built-in | MVP |
| B structured data | `mindmap` (tree→markmap), `diagram` (mermaid text), `flashcard`, `table` | declarative data, safe renderer | no sandbox | fast follow |
| C interactive code | `artifact` (animation / mini-game = AI-generated HTML/JS) | code | **sandboxed iframe** (`sandbox`, no same-origin, CSP), like Claude Artifacts | later |

Mind maps are tier B (tree data, safe); animations/mini-games are tier C (code → sandbox, same problem as runtime code plugins). AI Action ties in: `output:note` carries a `contentType` ("生成脑图"→mindmap, "做个互动 demo"→artifact). **Discipline: MVP ships tier A only; tier B (mindmap/diagram) is the first rich type; tier C waits until B proves used.** Cheap forward-compat now: add `Note.contentType` (default `markdown`); `content` stays a string payload (structured text/JSON for B, HTML for C).

**This is a first-class plugin extension point — the "note plugin" form.** `NoteContentRenderer` is registered in `plugins/registry.ts` keyed by `contentType`, exactly like `SourceRenderer`/`ViewPlugin`/`ModelProvider`. So new note types (mindmap, diagram, flashcard, artifact, …) ship as **note plugins**, not core changes. Tiering by the data-vs-code rule: tier-A/B renderers are data-safe and can be runtime-loaded like declarative slash commands (tier 1.5); tier-C `artifact` renders untrusted code in a sandboxed iframe and follows the deferred code-plugin path. `Note.contentType` is the registry key.

### Workspace shell & plugin freedom (forward-compat; built-in only in MVP)

Obsidian-level freedom splits into three tiers; we grant two by design and defer one:

1. **UI extension freedom (granted, by design):** the client shell defines named regions and plugins *contribute* into them — a miniature Workspace. This is how a plugin adds panels, a Graph/Timeline view, or **customizes the library/nav ("目录")**, without touching core UI.

```ts
type Region = 'leftNav' | 'mainView' | 'rightPanel' | 'bottomPanel' | 'commandPalette' | 'settings'
interface ViewPlugin       { id: string; region: Region; mount(container, ctx): Disposable }
interface NavContribution  { id: string; sections(ctx): NavSection[]; itemMenu?(source, ctx): MenuItem[] }
interface CommandPlugin    { id: string; title: string; run(ctx): void }
interface SettingsTab      { id: string; title: string; render(container): void }
```

2. **Capability freedom (granted but gated, by design):** filesystem / network / modify-source / read-vault are mediated by the permission model (PRD §7). Plugins declare permissions; the runtime enforces. Intentionally *not* unlimited — safer than Obsidian's full-trust model for a tool that edits user content and calls AI.
3. **Runtime third-party install (deferred, post-M8):** dropping in untrusted `.js` needs a plugin loader + sandbox + API-version contract. MVP plugins are first-party, compiled-in, registered in `plugins/registry.ts` — they get tiers 1–2 fully, just aren't user-installable at runtime yet.

**Tier 1.5 — declarative actions (data, safely runtime-loadable):** user-authored slash commands (`.study/commands/*.md`) are *data, not code* (safe-templated prompt + declared context/output/permissions, no eval), so they can be loaded/installed at runtime **without a sandbox** — a safe shortcut to user-installable, shareable plugins that beats the deferred tier-3. See the Slice 2 AI Action note.

Cheap forward-compat for Slice 1: build the client shell with regions/slots and register views through the registry from day one (even with only built-in views), so adding View plugins later needs no UI refactor — same `capability + registry` pattern as Provider/Adapter.

### Frozen decisions for Slice 1

- **Schema is Zod-first, single source of truth.** One record envelope shared by every entity: `{ id, type, schemaVersion, createdAt, updatedAt, createdBy }` (`createdBy: "user" | "ai" | "system"`). TS types derive via `z.infer`. The same Zod schema feeds C2 JSONL validation, C6 API DTOs, and later AI structured-output JSON Schema.
- **ID rule:** `<type>_<ulid>` (e.g. `src_01J...`, `patch_01J...`) — prefix gives type at a glance, ULID gives time-sortable order for JSONL.
- **Store semantics (C2):** entity files (`sources/anchors/notes/patches/concepts/relations.jsonl`) are **snapshot upsert** stores (one current record per id, last-write-wins), written by **atomic temp-file + fsync + rename** (handle Windows replace). Pure-log files (`conversations.jsonl`, `ai-calls.jsonl`) are append-only. Full event-sourced log is deferred.
- **HTML parser frozen: `linkedom`** in `core/adapters` (DOM-like `querySelector`/`outerHTML`/serialize, no browser). Fallback to `jsdom` only if serialization fidelity fails. Patch application MUST stay in core — never leak to the frontend DOM.
- **Fixture contract:** C1 emits golden, schema-validated fixtures (sample Source + HTML body + Anchor + Patch). C4 and C5 code against these fixtures; nothing is parallelized until the contract is frozen.
- **Vault root:** default `./data/vault/`, overridable via env; single vault for MVP.
- **Anchor is a discriminated union** keyed by `anchorKind` (`html_selection` | `pdf_selection` | `code_range` | `image_region`); `Note`/`Patch`/`Concept` stay format-agnostic and reference an Anchor. C1 defines the union but implements only `html_selection`.

### Core schema stability (after the extension discussions)

The data-layer-first bet paid off: every extension discussed (sharing, viewers, slash commands, workspace/plugins, embedded CLI, rich notes) resolves to **already-reserved fields** (`Note.authorId`/`visibility`, `Source.contentHash`), or to **plugin/runtime/config/log layers that never touch core entity schema**. The core entities (Source/Anchor/Note/Patch/Concept/Relation) are stable. Two schema actions — **done 2026-06-23 (C1 amendment; `check`+`test` green, 45 tests):**

1. **Add `Note.contentType`** — an **open string** `z.string().default("markdown")`, *not* a closed enum (note types are plugins; an enum would force a core change per plugin). Validate at runtime against registered `NoteContentRenderer`s. Orthogonal to `noteKind`: `noteKind` = semantic purpose (closed enum), `contentType` = render format (open). Update fixtures + schema tests.
2. **Promote `metadata` to the envelope** — move `metadata: z.record(z.string(), z.unknown()).default({})` into `recordEnvelopeSchema` (common.ts) so every entity gets a plugin escape hatch; remove the now-duplicate field from `source.ts`. This is what keeps the core schema stable against all future plugins — plugins stash data in `metadata`, not new columns.

Everything else discussed stays out of core entity schema (lives in plugin interfaces, the sync backend, `plugin-settings.json`, or `conversations.jsonl`/`ai-calls.jsonl`).

### Slice 1 — Vault data layer (Milestone 2, no AI, end-to-end verifiable)

| ID | Task | Deps | Parallel | Primary Files | Verification |
| --- | --- | --- | --- | --- | --- |
| C1 | Zod-first schema: record envelope, entity schemas, id rule, `z.infer` TS types, golden fixtures. Anchor as discriminated union (`anchorKind`), implement `html_selection` only. Reserve sharing forward-compat fields: Note `authorId` + `visibility` (`private`\|`shared`\|`public`, default `private`), Source `contentHash` — MVP behaves single-user/private | — | No | `core/schema/*` `core/ids.ts` `core/fixtures/*` | `tsc` passes; Vitest: schema accepts valid / rejects invalid; ids unique + well-formed |
| C2 | Store: per-entity **snapshot upsert** (last-write-wins) via atomic temp+fsync+rename; append-log files separate; delete semantics | C1 | No | `core/store/*` | Vitest: upsert→read, status update, delete, malformed-line tolerance, crash-safe rename |
| C3 | Vault open/create + `manifest.json` (version) + dir layout (`.study/`, `sources/`, `exports/`) | C2 | No | `core/vault.ts` | Vitest: empty vault has correct structure + manifest |
| C4 | Source ingest: write source file + `sources.jsonl` record (HTML first) | C3 | Yes (with C5a) | `core/store/sources.ts` | Vitest: ingest HTML → file + record + list shows it |
| C5a | HTML core (linkedom): parse, idempotent `data-study-id` inject, `materialize(content, appliedPatches)`, applyPatch (replace/insert/append/rewrite), serialize/save | C1,C3 | Yes (with C4) | `adapters/html/core.ts` | Vitest: apply each action mutates content; revert restores; inject idempotent |
| C5b | Anchor resolve + guards: build Anchor (studyId+selector+quote+context); resolve studyId→selector→quote fallback; **patch conflict detection** (verify oldText/quote still matches before apply, else return conflict) | C5a | No | `adapters/html/anchor.ts` | Vitest: resolve after edits/reorder; drifted patch returns conflict (not applied) |
| C6 | Server API: list sources / get rendered / create anchor / Note·Patch CRUD (no AI) | C4,C5a,C5b | No | `server/*` | Vitest + supertest: status codes + bodies per endpoint |
| C8 | **Seed/Migration** (non-optional): if `data/documents/main/content.html` exists import it, else generate a demo fixture source | C4,C5a | Yes | `scripts/seed.ts` | Vitest/script: a deterministic source exists after run |
| C7 | Minimal client: library + read-only reader + **browser selection capture**→anchor + manual Note + manual Patch (hand-typed HTML/content) → apply → revert | C6,C8 | No | `client/*` | Manual/E2E: select→anchor→note→patch→apply→revert→**reload still correct** |

Serial foundation: C1→C2→C3. **Freeze fixture + layout contract**, then C4 ∥ C5a; C5b after C5a; C6 integrates; C8 seeds deterministic material; C7 verifies the no-AI manual loop.

**Verification is test-first.** Add Vitest (`npm run test`), linkedom/jsdom (server-side HTML), and supertest (API) during C1/C2; Playwright optional for one C7 E2E. C1–C6 and C8 are fully automatable; only C7 needs manual QA. Tests isolate in `os.tmpdir()`. Full per-task matrix and the Slice 2 AI-mock strategy live in `02-verification-log.md`.

### Slice 1 implementation status (2026-06-23)

| ID | Status | Evidence |
| --- | --- | --- |
| C1 | Complete | Core Zod schemas, ID helpers, and golden fixtures implemented with schema/id tests. |
| C2 | Complete | JSONL snapshot stores, append logs, entity store mapping, and store tests implemented. |
| C3 | Complete | Vault open/create, manifest, layout, and vault tests implemented. |
| C4 | Complete | HTML source ingest/list/read helpers and tests implemented. |
| C5a | Complete | HTML core delegated to subagent Plato, integrated, and verified. |
| C5b | Complete | HTML anchor resolution and guarded patch conflict detection implemented with tests. |
| C6 | Complete | Express API for sources, anchors, notes, and patches implemented with supertest coverage. |
| C8 | Complete | Seed script and tests implemented; default vault can be seeded deterministically. |
| C7 | Complete | Minimal client implemented and browser-verified: content capture, anchor, note, patch, apply, revert, reload. |

### Later slices

- **Slice 2 (M3+M4+M5)**: AI Runtime + Claude Agent SDK provider plugin + Explain/Rewrite actions + Context collector → AI feeds the Patch loop.
  - Agentic providers run the local CLI as a subprocess (`claude-agent-sdk` / `claude-cli` / `codex-cli`) and ride the **subscription OAuth** of the local login (same host as `claude login`/`codex login`). This is how OpenClaw/Hermes do it and what GrowHTML already does. Capability flags: `{ subscriptionAuth, webSearch, stream }`.
  - **Hard constraints the provider plugin must enforce:** (1) in subscription mode, strip `ANTHROPIC_API_KEY` from the child env — it silently overrides OAuth and bills API; (2) post-2026-06-15 subscription Agent-SDK usage draws a separate monthly Agent-SDK credit pool, then API-rate credits — not unlimited; (3) OAuth is licensed for individual use — fine for this local tool, must switch to API-key mode before any multi-user release; (4) headless/CI can use `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token`.
  - **AI Action comes in two tiers under one `AIActionPlugin` interface:** (a) **code action** (compiled TS, full power: custom `buildPrompt`/`parseResult`, any output kind, declared context/permissions); (b) **declarative slash command** (a vault `.md` file authored by the user). The runtime treats both uniformly; design the interface to support both from day one, ship a few built-in code actions + a declarative loader. Slash-command file = frontmatter (`name`/`trigger`/`context`/`output`/`provider`/`permissions`) + a **safe-templated** prompt (`{{selection}}`, `{{section}}`, `{{relatedNotes}}` — no eval/code execution). `output: patch` → wrap into a reviewable Patch; `output: note` → Note layer. Live in `.study/commands/*.md` — user-owned, git-friendly, shareable as command packs. Precedent: Claude Code slash commands, Obsidian Copilot custom commands (both markdown). UI: `/` autocomplete in the chat box + selection floating menu.
- **Slice 3 (M6+M7)**: Concept/Relation data + Graph View.
- **Slice 4 (M8+)**: more adapters (md/pdf/code), more providers (OpenAI/Ollama), MCP, exports. PDF stays annotation-only per PRD.

### Salvage from old code (port logic, not files)

`externalImport.ts` (webpage/PDF import) → an HTML/PDF Source Adapter; standalone HTML export; structured-output schema approach. GrapesJS is not carried into MVP.

## Task Breakdown

| ID | Task | Dependencies | Can Parallelize | Primary Files | Implementation Plan | Verification Method | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| LIB-001 | Split Library into Open Folder and Recent Read | Current workspace source/folder flows | No | `src/client/workspace/WorkspaceContext.tsx`, `src/client/workspace/views.tsx`, `src/client/styles.css` | Replace the single `folderRoot` mode with a multi-root opened-folder list; keep Open Folder as the top Library section and always render Recent Read below it. Each folder root owns its `FileTree` and close button. Track source activation locally so Recent Read puts opened/read documents first while falling back to all sources. | `npm run check`; focused browser/DOM smoke for Open Folder + Recent Read layout; `npm run build`. | Complete |
| UI-REF-014 | Whole-shell pixel calibration pass | UI-REF-013 | No | `src/client/styles.css`, `src/client/workspace/presets.ts` | Compare the supplied 1576x890 reference with the current shell screenshot and tune the shared visual layer across topbar, brand, icon rail, dock panels, left pane rows, reader chrome, right panels, chat composer, typography, borders, shadows, neutral/accent colors, and the default right Anchor/AI Chat split. Preserve prior product decisions such as removed native/title/right-note chrome. | `npm run check`; Playwright screenshot/computed-style smoke against the current shell; `npm run build`. | Complete |
| UI-REF-013 | Unify left sub-pane styling | UI-REF-012 | No | `src/client/styles.css` | Add one shared visual layer for the left rail panes (`Library`, `Bookmarks`, `Concepts`, `Actions`, `Layers`) so their root chrome, header rhythm, form controls, list rows, active states, and empty states use the same spacing, radius, border, typography, and neutral-gray scale while preserving each pane's data/render logic. | `npm run check`; Playwright DOM/computed-style smoke while switching the left rail panes; `npm run build`. | Complete |
| UI-REF-012 | Restore frameless window controls | UI-REF-005 | No | `electron/main.ts`, `electron/preload.ts`, `src/client/electron.d.ts`, `src/client/workspace/TopBar.tsx`, `src/client/styles.css` | Keep the frameless/no-menu window but add desktop-only custom minimize, maximize/restore, and close buttons in the top-right chrome. Expose a narrow preload bridge and keep controls non-draggable. | `npm run check`; `npm run electron:build:main`; `npm run electron:build:preload`; Electron DOM smoke; `npm run build`; desktop client restart. | Complete |
| UI-REF-011 | Match opened-file reader tab header | UI-REF-010 | No | `src/client/styles.css`, `src/client/workspace/views.tsx` | Tune the active document tab to the reference's neutral file-tab treatment: white surface, soft gray border, muted document icon/close icon, medium gray title, and reference-like height/padding. Avoid changing reader body or source selection behavior. | `npm run check`; browser computed-style/screenshot smoke for `.reader-tab.active`; `npm run build`. | Complete |
| UI-REF-010 | Align UI control typography and grayscale | UI-REF-009 | No | `src/client/styles.css`, `src/client/theme/builtins.ts`, `src/client/theme/registry.test.ts` | Add a focused visual calibration layer for control text, muted labels, borders, icon gray, active blue, and popover/card shadows; sync default theme tokens so runtime injection uses the same lighter hierarchy. Keep layout unchanged while making controls lighter, less black, and closer to the reference. | `npm run check`; focused theme registry test; in-app browser screenshot/DOM computed-style sample; `npm run build`. | Complete |
| UI-REF-009 | Simplify AI Chat into pure bottom-input chat | UI-REF-008 | No | `src/client/workspace/views.tsx`, `src/client/workspace/WorkspaceContext.tsx`, `src/client/styles.css` | Remove note-authoring affordances from the AI Chat panel: no Note tab, no note type detection, no save-reply-as-note, no generation preview/selection note toolbar. Re-layout the panel as title, scrollable chat history, and a bottom command-style input bar. Force the chat composer submit path to `anchor.ask-ai`. | `npm run check`; browser DOM smoke for absent note controls, bottom input, and Enter-to-send; `npm run build`. | Complete |
| UI-REF-008 | Remove no-note anchor toggle and prune orphan anchors | UI-REF-007 | No | `src/client/workspace/TopBar.tsx`, `src/server/app.ts`, `src/server/app.test.ts` | Remove the Layer Lens switch for bare anchors; make source anchor painting strictly note-derived; delete anchors that no note references when reading the anchor list, deleting notes, or detaching anchors from notes. Preserve patch-referenced anchors for source-edit integrity while keeping them out of the painted list. | `npm run check`; focused `src/server/app.test.ts`; browser DOM smoke that the toggle text is absent; `npm run build`. | Complete |
| UI-REF-007 | Make dock panels contain responsive controls | UI-REF-006 | No | `src/client/styles.css` | Ensure docked panels size their contents within their own border boxes; make compact action rows such as the AI Chat composer wrap instead of clipping primary buttons. | `npm run check`; Playwright DOM width check for major panels/composer; `npm run build`. | Complete |
| UI-REF-006 | Match top-left brand mark | UI-REF-005 | No | `src/client/workspace/TopBar.tsx`, `src/client/styles.css` | Tune the Growte brand area to the reference: larger black anchor icon and Source Serif wordmark instead of the heavier sans-serif rendering. | `npm run check`; browser crop screenshot of the top-left brand area; `npm run build`. | Complete |
| UI-REF-005 | Hide native desktop title bar | UI-REF-004 | No | `electron/main.ts`, `src/client/styles.css` | Make the Electron window frameless so the OS title strip with `GrowHTML` is gone; mark the app TopBar as the drag region while preserving button clickability. | `npm run check`; `npm run electron:build:main`; restart Electron dev client. | Complete |
| UI-REF-004 | Remove folder tree wrapper shell | UI-REF-003 | No | `src/client/workspace/views.tsx`, `src/client/styles.css` | Render the open-folder file tree directly instead of wrapping it in a duplicate root-title card; keep a small close affordance without adding a panel shell. | `npm run check`; `npm run build`. | Complete |
| UI-REF-003 | Remove collapsed dock rails from the simplified desktop UI | UI-REF-002 | No | `src/client/workspace/dock.ts`, `src/client/workspace/dock.test.ts`, `e2e/layout-engine.spec.ts` | Disable pane collapse eligibility and ignore persisted collapsed state so the workspace never shows vertical rail tabs such as "Sources"; keep the dock tree and existing pane sizing behavior intact. | `npm run check`; targeted `dock.test.ts`; DOM smoke against the running client; `npm run build`. | Complete |
| UI-REF-002 | Remove extra desktop/topbar/right-note UI chrome | UI-REF-001 | No | `electron/main.ts`, `src/client/workspace/TopBar.tsx`, `src/client/workspace/views.tsx` | Hide the native Electron menu bar, remove the right-top reader/settings icon buttons, and suppress the saved note-list cards in the right study panel while leaving note creation and registries intact. | `npm run check`; restart Electron dev client. | Complete |
| UI-REF-001 | Recreate supplied Growte workspace reference | Existing Growte shell | No | `src/client/workspace/*`, `src/client/styles.css`, seed/demo content as needed | Keep the current dock/view registry architecture; tune the default study-vault layout, add a TopBar Layer Lens popover, and style the library/reader/right column to match the provided screenshot without changing core data contracts. | `npm run check`; run the app and capture/inspect a browser screenshot at the reference aspect ratio. | Complete |
| MECH-001 | Create implementation workflow docs | None | No | `docs/implementation/*` | Add Markdown files for planning, progress, verification, subagent handoff, and decisions. | Check files exist and review `git status`. | Complete |
| PLAN-001 | Create implementation branch | None | No | Git branch only | Switch to a dedicated branch for AI Study Vault planning and implementation. | `git status --short --branch` shows `codex/ai-study-vault`. | Complete |
| PLAN-002 | Research Obsidian borrowable architecture | PLAN-001 | Yes | `docs/implementation/*` | Use public Obsidian API/docs and open community plugin repos to extract safe architectural patterns. | Record source links and summarize borrow/do-not-borrow boundaries. | Complete |
| PLAN-003 | Draft technical architecture options | PLAN-002 | No | `docs/implementation/*` | Compare evolutionary migration from GrowHTML vs larger rewrite and recommend phased architecture. | Review plan with user before code implementation. | Complete |
| PLAN-004 | Define first implementation slice | PLAN-003 | No | `docs/implementation/*` | Pick Slice 1: Vault data layer, HTML adapter foundation, server API, seed, and minimal manual UI loop. | Acceptance criteria and commands are defined in this file and `02-verification-log.md`. | Complete |

## Parallelization Assessment

Implementation used one subagent where the ownership boundary was clean: `C5a` HTML core was delegated to Plato, then reviewed, integrated, and verified by Codex.

Likely future parallel tracks after the architecture is agreed:

| Task ID | Parallel Group | Reason Safe Or Unsafe | Integration Owner |
| --- | --- | --- | --- |
| CORE-DATA | A | Data model and JSONL persistence can be isolated in shared/server modules. | Codex |
| HTML-ADAPTER | B | HTML selection/anchor/patch logic can be isolated after core types are stable. | Codex |
| AI-RUNTIME | C | Provider/action/context interfaces can be designed against core types. | Codex |
| UI-SHELL | D | Navigation and panels can proceed after data contracts are agreed. | Codex |

Avoid future parallel work until core type names and storage boundaries are stable. For this slice, parallel work only started after C1-C3 froze the fixture and vault contracts.

## Implementation Steps

1. Technical research and discussion.
   - Plan: compare AI Study Vault goals with Obsidian's public architecture and current GrowHTML code.
   - Verification: summarize borrowable patterns, non-borrowable boundaries, and current-code migration points.

2. Architecture decision.
   - Plan: choose between evolutionary migration and rewrite.
   - Verification: record the decision and rationale in `04-decision-log.md`.

3. First implementation slice.
   - Plan: define the smallest useful closed loop before coding.
   - Verification: write acceptance criteria and commands in this file and `02-verification-log.md`.

## Acceptance Criteria

- Dedicated branch exists for AI Study Vault work.
- Obsidian reference boundaries are documented.
- Current GrowHTML reuse points are identified.
- User approves a technical direction before business code changes.
