# Product Kit — vertical products as register-only plugin packs

> A **Product Kit** turns the generic AI Study Vault into a vertical product
> (Textbook, Research Paper, Exam Prep, …) WITHOUT changing the base. It only
> *registers a bundle* into the existing registries and renames the vocabulary.

## Iron law

A Product Kit does **not own** core data structures (Source / Anchor / Note /
StudyLayer / Workspace). It owns *the way those structures are interpreted*.
Concretely:

- Kits add note types via **domain-prefixed `contentType`s** (e.g.
  `textbook.explanation`) over the existing `Note.content = unknown` +
  `NoteContentSpec`. **No core schema changes.**
- Kits register commands / views / layouts / surface contributions into the
  existing `CommandRegistry` / `ViewRegistry` / layout presets / surface slots.
- Kits provide a **language map** that renames core concepts for the product
  (Source→"Textbook", Anchor→"Knowledge Point", Note→"Study Block", …).
- **Core never imports a kit.** The composition roots wire kits in: the server
  registers a kit's React-free content specs; the client installs the full kit.

## The seam

```ts
type ProductKit = {
  id: string; name: string; description: string;
  contentSpecs?: NoteContentSpec[];          // React-free: server + client register
  install(ctx: KitInstallContext): void;     // client: plugins, language, (later) commands/views
};

type KitInstallContext = {
  noteTypes: { register(spec, plugin): void };  // → core NoteContentSpec + client NoteTypePlugin
  language:  { register(language): void };
  commands:  { register(command): void };       // phase 2
  views:     { register(id, view): void };       // phase 2/3
  layouts:   { register(layout): void };         // phase 3
  surfaces:  { contribute(slot, items): void };  // phase 2 (selection toolbar, …)
};
```

Files:

```
src/kits/
  types.ts            ProductKit / KitInstallContext / KitLanguage
  language.ts         kit language registry (kitContentTypeLabel / kitTerm)
  clientContext.tsx   createKitInstallContext() — wires noteTypes+language into the
                      host registries; collects commands/views/layouts/surfaces (phase 2/3)
  clientKits.tsx      productKits = [textbookLearningKit]; installs them (side-effect)
  index.ts            REACT-FREE: kitContentSpecs (server registers these)
  server.ts           installServerKits() — called by createApp
  textbook-learning/
    contentTypes.ts   3 NoteContentSpecs (React-free, §4 schemas)
    noteTypes.tsx     3 NoteTypePlugins (render cards + edit forms)
    language.ts       domain language (§10)
    index.tsx         textbookLearningKit: ProductKit
```

Wiring: `src/server/app.ts` calls `installServerKits()` (React-free spec
registration for API validation); `src/client/workspace/views.tsx`
side-effect-imports `../../kits/clientKits` next to the built-in note types.

## Textbook Learning Kit

Domain language: Source→**Textbook**, Anchor→**Knowledge Point**,
Note→**Study Block**, Layer→**Learning Layer**.

### Content types (MVP — 3 Study Blocks)

| contentType | label | shape (see `contentTypes.ts`, schemas verbatim from spec §4) |
| --- | --- | --- |
| `textbook.explanation` | Explanation | title, level(simple/standard/advanced), explanation, analogy?, keyPoints[], commonMisunderstandings[] |
| `textbook.exercise` | Practice | question, type(single/multiple-choice/fill-blank/short-answer), options?, answer(string\|string[]), explanation, difficulty, relatedKnowledgePoints[] |
| `textbook.mistake` | Mistake | exerciseNoteId?, question, wrongAnswer, correctAnswer, mistakeReason?, correction?, retryCount, mastery(unknown/weak/improving/mastered) |

Each = one core `NoteContentSpec` (schema/createDefault/toSearchText, server+client
shared) + one client `NoteTypePlugin` (render card / edit form). They appear in the
composer type picker (labelled by domain name) and render in the note list — exactly
like the built-in flashcard/quiz, with **zero** App/Workspace/Shell edits.

## Three-phase roadmap (MVP, spec §16)

1. **Foundation + content types** ✅ landed (2026-06-25): ProductKit/KitInstallContext
   registry + Textbook Kit + language + 3 Study Block types (render/edit), wired
   server (validation) + client (composer/note-list).
2. **AI commands** ✅ landed (2026-06-25): `textbook.explain-concept` /
   `generate-practice` / `mark-as-mistake` — Focus→materializeAnchor→**structured AI
   generation**→typed Note, surfaced by a selection toolbar (see "Phase 2" below).
3. **Review Pack + propagation** ✅ landed (2026-06-25): `textbook.review-pack`
   (generate from a chapter's Explanation+Mistake), teacher-layer export / student
   import (reuse Study Layer V1/V2), mistake-layer **private by default** (layer
   policy), and a student layout preset (column approximation; full dock deferred).
   See "Phase 3" below.

## Phase-2 research notes (base capabilities found)

- **AI provider** (`src/ai/provider.ts`): `ModelProvider.complete(ChatRequest) →
  {message}` returns **free-text markdown only** — there is no structured/JSON
  output. `ChatContext` already carries `quote`/`contextBefore`/`contextAfter`/
  `sourceTitle`/`location`. The `MockModelProvider` echoes a deterministic markdown
  answer. **Implication:** phase 2 must add a structured-generation path (prompt the
  model for JSON, validate against the kit spec's zod schema, retry on mismatch) and
  make the mock emit **schema-valid JSON deterministically** for e2e (e.g. a
  `completeStructured`/endpoint that, under the mock, returns a fixed valid object
  keyed by contentType). e2e stays on the mock provider (determinism rule).
- **Commands & selection** (`src/client/commands/registry.ts`): `anchor.add-note`
  already does `focus.materializeAnchor()` → `createNote({contentType, content})` — the
  exact pattern phase-2 kit commands follow (generate structured content → typed Note).
  Commands gate on `focus.anchor`/`focus.draft`. **There is no selection toolbar yet**:
  a selection currently fills the chat "Source" chip (`.chat-source`) and the composer
  is the action surface. The `surfaces.contribute('selection-toolbar', …)` collector
  exists (phase-1 seam, `src/kits/clientContext.tsx`); phase 2/3 must add the toolbar
  component that reads `kitSurfaceContributions` and runs kit commands.

## Phase 2 — AI commands + structured generation + selection toolbar (landed 2026-06-25)

The textbook learning loop ("讲一下 / 生成练习 / 标错题") on a focused passage, register-only.

**Structured generation (React-free core).**
- `ModelProvider` gains an OPTIONAL `completeStructured(req) → {json}` (`src/ai/provider.ts`).
  `MockModelProvider` implements it by echoing a host-supplied schema-valid `sample`
  → deterministic offline/e2e output. Real providers may omit it; the helper then
  falls back to `complete()` + JSON extraction.
- `src/kits/structured.ts` — `generateStructuredContent(provider, {promptId, contentType,
  input})`: builds the kit prompt, asks the provider for JSON, `extractJson` (strips ```
  fences / scans braces), validates against the contentType's `NoteContentSpec.schema`,
  and **retries** (re-prompting with the error) up to N times. Unknown prompt/type or
  unsatisfiable output → `StructuredGenerationError` (→ HTTP 400).
- `src/kits/prompts.ts` — React-free prompt registry; `ProductKit.prompts[]` registered
  server-side by `installServerKits` (mirrors `contentSpecs`).
- Endpoint `POST /api/kits/generate {promptId, contentType, input} → {content}` (validated);
  client `entityClient.generateStructured(...)`.

**Prompt pack** (`src/kits/textbook-learning/prompts/`): one `KitPrompt` per command —
`build(input)→string` (the LLM instruction, JSON-only) + `mockContent(input)` (a
deterministic, schema-valid sample the mock echoes; unit-tested to parse against its spec).

**Commands** (`src/kits/textbook-learning/commands.ts`, host `Command`s registered via
`KitInstallContext.commands` → `CommandRegistry`): `textbook.explain-concept` →
`textbook.explanation`, `textbook.generate-practice` → `textbook.exercise`,
`textbook.mark-as-mistake` → `textbook.mistake`. Each: `isAvailable` = a passage in focus;
`run` = `materializeAnchor()` → `generateStructured(...)` → `createNote({contentType,
content, anchorIds})` — the same shape as built-in `anchor.add-note`.

**Selection toolbar**: `KitInstallContext.surfaces.contribute('selection-toolbar', items)`
collected in `clientContext` (`kitSurfaceItems(slot)`, priority-sorted). Host component
`src/client/workspace/SelectionToolbar.tsx` renders the items when a passage is focused and
dispatches the backing command; mounted under the chat "Source" chip in `views.tsx`. With
no kit installed it renders nothing (zero base-app impact).

**Deferred to phase 3**: Review Pack (`textbook.review-pack`), teacher-layer export /
student import (reuse Study Layer V1/V2), mistake-layer-private policy, student layout preset.

## Phase 3 — Review Pack + propagation policy + student layout (landed 2026-06-25)

Closes the MVP loop (spec §16), register-only.

**Review Pack** (`textbook.review-pack`): a 4th Study Block type (spec §4 schema:
title, scope{sourceId}, summary, keyPoints[], weakPoints[], flashcards[], exercises[])
with a render card + edit form. It is **source-level**, not anchored to one passage.
- Command `textbook.generate-review-pack` (`commands.ts`): `isAvailable` = an active
  source; `run` gathers the source's `textbook.explanation` + `textbook.mistake` notes
  (`client.notes(sourceId)`), calls `generateStructured('textbook.generate-review-pack',
  'textbook.review-pack', {sourceId, explanations, mistakes})`, and saves an unanchored
  review-pack Note.
- Surfaced via a new **`source-actions`** surface slot (not the selection toolbar — it's
  chapter-level). Host component `src/client/workspace/SourceActionsToolbar.tsx` renders
  `kitSurfaceItems('source-actions')` at the top of the study panel when a source is open;
  empty (and absent) with no kit installed.

**Propagation policy (spec §11)** — `src/kits/policy.ts` (React-free registry) +
`textbook-learning/policy.ts`. A kit declares `exportableContentTypes` /
`privateByDefaultContentTypes` / `copyableContentTypes`. The hard enforcement is the
**export filter**: `buildStudyPack` (`src/server/studyLayer.ts`) drops notes whose
contentType is private-by-default (textbook.**mistake**) and any anchor referenced only
by dropped notes — so a teacher's exported `.studypack` never ships a student's mistakes.
Generic notes (markdown, …) have no policy and stay exportable, so non-kit layers are
unchanged. Policies are registered server-side by `installServerKits` (like prompts).
Mistake notes are already `visibility: "private"` (the note schema default), so they stay
private locally too.

**Student layout preset (spec §8)** — `textbook-learning/layout.ts` registers a
`textbook.student-learning` `WorkspaceLayout` (Textbook library + reader + study/AI +
Learning Layers) via `KitInstallContext.layouts`. **Approximation:** the base
`WorkspaceShell` renders nodes as a left→right column strip, so this is the column form of
the §8 layout. **Deferred:** the full dock (left nav / center reader / right tutor /
*bottom* practice+mistakes) and a layout-switcher UI to activate the preset — both need a
dock layout engine the base shell does not have yet.

**Smoke** (`scripts/smoke-textbook-kit.ts`): seeds a textbook source into the dev vault,
fills its owned layer with all four block types, exports the layer to
`docs/samples/teacher-layer.studypack`, and **asserts the export excludes
`textbook.mistake`**. Run:
`STUDY_VAULT_ROOT=...\.vault-dev npx tsx scripts/smoke-textbook-kit.ts`, then in the
client do the §16 loop (Explain/Practice/Mistake on a passage → Review Pack from the
study-panel action → export the owned layer → import the teacher pack → confirm no Mistake
block imported).

**Deferred** (flagged): `copy-note-to-mine`, `anchor.rematch` UI (Study Layer V2 backlog),
full dock layout + layout switcher.
