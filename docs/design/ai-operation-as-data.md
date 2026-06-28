# AI Operation as Data — prompt-template + variable system

**Status: Implemented (V1).**

> Sections 1–8 below are the original research + design proposal. V1 shipped
> against a separately-agreed fixed scope that refined some names/locations; the
> authoritative record of what actually landed on disk is the
> **[Implementation log](#implementation-log)** at the end of this document. Where
> the proposal and the log disagree (e.g. schema field names), the log is correct.

---

## 1. Context / problem

### Where AI operations live today

An AI "operation" in this codebase is a **`KitPrompt`** — a hardcoded TypeScript
object whose prompt body is built by a `build(input): string` function:

```ts
// src/kits/types.ts:57-64
export type KitPrompt<Input = Record<string, unknown>> = {
  id: string;
  outputType: string;                 // the note contentType the output must validate against
  build(input: Input): string;        // <-- the prompt body, HARDCODED in TS
  mockContent?(input: Input): unknown;// deterministic sample the mock provider echoes
};
```

The four built-in textbook operations are literal TS files —
`src/kits/textbook-learning/prompts/explainConcept.prompt.ts`,
`generatePractice.prompt.ts`, `markAsMistake.prompt.ts`,
`generateReviewPack.prompt.ts` — each an object whose `build()` concatenates a
prompt string out of `input.anchorText`, `input.grade`, etc. They are aggregated
in `src/kits/textbook-learning/prompts/index.ts` (`textbookPrompts`), surfaced to
the server via `src/kits/index.ts` (`kitPrompts`), and registered into a
React-free `Map<string, KitPrompt>` by `installServerKits()`
(`src/kits/server.ts:15`) into the registry in `src/kits/prompts.ts`
(`registerKitPrompt` / `getKitPrompt` / `listKitPrompts`).

At generate time, `generateStructuredContent` (`src/kits/structured.ts:25`)
resolves `getKitPrompt(promptId)` + `getNoteContentSpec(contentType).schema`,
computes the deterministic `sample` (the prompt's `mockContent` or the spec's
`createDefault`), and delegates to the kit-agnostic engine `generateStructured`
(`src/ai/structured.ts:52`). The HTTP entry is `POST /api/kits/generate`
(`src/server/app.ts:987`), validated by `kitGenerateSchema`
(`src/server/app.ts:51-55`).

### Why `build()` blocks the "custom plugin" goal

The education version's headline promise is that a **teacher (non-coder)** can
author their own AI operations — "explain at grade 3 level", "generate 5
fill-in-the-blank questions in Chinese", "rewrite as a dialogue" — without
touching TypeScript, a build step, or a redeploy. As long as an operation IS a
`build()` function compiled into the bundle, that is impossible:

- Authoring requires writing + compiling TS and shipping a new client/server.
- Operations cannot be created/edited/deleted at runtime, per-vault.
- Operations cannot be shared as data (the way Study Layers already are, via
  `.studypack` — see `docs/design/study-layer.md`).

### Intended outcome

Treat the **operation as data**: the prompt text, its declared variables, and its
output type become a persisted, editable record in the vault. A tiny, pure
template ENGINE (`{{variable}}` substitution) turns that data + a runtime input
into the prompt string that the *unchanged* structured-generation engine already
knows how to run. Built-in `KitPrompt`s and stored operations resolve through
**one uniform path** so `/api/kits/generate` does not care which kind it ran.

---

## 2. Seam map (where a data-defined operation must plug in)

| Concern | Today (built-in `KitPrompt`) | Seam for a stored `Operation` |
| --- | --- | --- |
| **Resolve by id** | `getKitPrompt(id)` — `src/kits/prompts.ts:14` | New `resolvePrompt(id)` that tries the operation store first/last, falling back to `getKitPrompt`. Returns a common `ResolvedPrompt` (§4). |
| **Build prompt string** | `prompt.build(input)` — `src/kits/structured.ts:45` | `renderTemplate(operation.template, boundValues)` from new `src/ai/template.ts` (§3), wrapped so the resolved shape still exposes `build(input)`. |
| **Generate endpoint** | `POST /api/kits/generate` → `generateStructuredContent(provider, input)` — `src/server/app.ts:987-990` | **No new route needed for running.** `generateStructuredContent` switches `getKitPrompt` → `resolvePrompt`. The body schema `kitGenerateSchema` (`src/server/app.ts:51`) is unchanged: `promptId` may now be an operation id. |
| **Output-schema validation** | `getNoteContentSpec(contentType).schema` + the `prompt.outputType === contentType` check — `src/kits/structured.ts:32-38` | Identical. A stored operation carries `outputType`; the same check and the same `NoteContentSpec` validation run. `src/core/notes/contentTypes.ts` is untouched. |
| **Deterministic mock sample** | `prompt.mockContent?.(input)` else `spec.createDefault()` — `src/kits/structured.ts:41` | A stored operation has no `mockContent` fn → falls back to `spec.createDefault()`. The mock provider already echoes the sample (`src/ai/index.ts` mock); deterministic by construction. |
| **UI invocation** | A kit `Command` (`src/kits/textbook-learning/commands.ts`) dispatched from `SelectionToolbar`/`SourceActionsToolbar` via `WorkspaceContext.dispatch` (`src/client/workspace/WorkspaceContext.tsx:525`); the command calls `ctx.client.generateStructured({promptId, contentType, input})` and emits a draft through `ctx.actions.onGenerated` → preview. | A single generic command `operation.run` (§5) that reads `{operationId, outputType}` from `ctx.payload`, gathers variable-source values from `focus`/`chatContext`, calls the **same** `generateStructured`, and emits the **same** `GeneratedDraft` (`src/client/commands/registry.ts:23`). The preview loop is reused verbatim. |
| **Persistence** | None (operations are code). | New `createSnapshotStore` per the `entities.ts` pattern (§4): add `operations: "operations.jsonl"` to `entityFileNames` (`src/core/store/entities.ts:24`) + an `operationSchema` in `src/core/schema/`. CRUD `/api/operations` mirroring concepts/relations (`src/server/app.ts:746-832`). Client seam: new methods on `entityClient` (`src/client/data/entityClient.ts`). |

The crucial property: **the only mechanism change is at the resolve step**
(`getKitPrompt` → `resolvePrompt`). Everything downstream — schema lookup,
validation, retry, mock sample, the preview/save loop — is reused unchanged.

---

## 3. The engine (底座) — `src/ai/template.ts`

### Why it lives in `src/ai`

`src/ai` owns *mechanism*; kits/data own *domain* (see
`docs/design/ai-orchestration.md`, "Iron rule: `src/ai` never imports a kit").
The template engine is pure string→string transformation with zero knowledge of
notes, anchors, kits, or content types. It must be reusable by any caller
(future agent loops, batch jobs) and trivially unit-testable with no fixtures.
So it belongs beside `src/ai/structured.ts`, importing nothing from `src/kits`
or `src/core`.

### Proposed API

```ts
// src/ai/template.ts  (NEW — pure, no imports from src/kits or src/core)

/** A `{{name}}` placeholder reference found in a template. */
export type TemplateVariableRef = { name: string };

/**
 * Scan a template for `{{name}}` placeholders. Returns the DISTINCT variable
 * names in first-seen order. Names are trimmed; `{{ anchorText }}` === `{{anchorText}}`.
 * Unknown/garbage braces that don't match the name grammar are ignored (left as
 * literal text by renderTemplate), so authoring can't crash extraction.
 */
export function extractVariables(template: string): string[];

/** Values bound for a render. Scalars are stringified; arrays are joined. */
export type TemplateValues = Record<string, unknown>;

export type RenderOptions = {
  /** Separator for array values. Default: "\n". */
  arrayJoin?: string;
  /** Rendered text for a name with no provided value. Default: "" (drop it). */
  missing?: (name: string) => string;
};

/**
 * Substitute every `{{name}}` with its value from `values`:
 *  - string  → as-is
 *  - number/boolean → String(v)
 *  - array   → v.map(String).join(opts.arrayJoin ?? "\n")
 *  - null/undefined/missing → opts.missing?.(name) ?? ""
 *  - object  → JSON.stringify(v) (escape hatch; arrays handled above)
 * Literal text (including stray single braces) passes through unchanged.
 */
export function renderTemplate(
  template: string,
  values: TemplateValues,
  opts?: RenderOptions
): string;
```

### Resolution rules (V1, deliberately minimal)

- **Grammar**: `\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}`. A name is an identifier;
  anything else between braces is left as literal text. This keeps the engine
  total (never throws on author input) and gives a single regex for both
  `extractVariables` and `renderTemplate`.
- **Missing variable**: renders to `""` by default (so an optional `subject`
  simply vanishes), but `missing` is injectable so the server can choose
  strict-mode (e.g. throw / annotate) later without an engine change.
- **Array join**: `["a","b"]` → `"a\nb"` (newline by default; configurable).
  This matches how the existing review-pack command passes `explanations` /
  `mistakes` arrays as input (`src/kits/textbook-learning/commands.ts:88`).
- **Escaping**: V1 does **no** HTML/markdown escaping — the output is an LLM
  prompt, not HTML. Object values fall back to `JSON.stringify` so a template can
  embed a structured value verbatim. (A literal `{{` is not expressible in V1;
  noted as a V2 seam.)

### The variable-declaration model

An operation declares the variables its template expects. The declaration tells
the UI what fields to show and tells the runtime where each value comes from:

```ts
// Proposed shape (lives with the Operation schema in src/core/schema, §4).
export type OperationVariableSource =
  | "anchorText"     // the focused passage's quote (focus.anchor?.quote / draft)
  | "sourceTitle"    // active source title (chatContext.sourceTitle)
  | "existingNotes"  // source-level: the source's notes' content (array) — for review-pack-like ops
  | "literal";       // a fixed value baked into the operation (the `default`)

export type OperationVariable = {
  name: string;                  // must match a `{{name}}` in the template
  label?: string;                // human label for the builder form (defaults to name)
  source: OperationVariableSource;
  default?: string;              // used by source:"literal", or as a fallback for others
  required?: boolean;            // builder hint; runtime still tolerates missing (renders "")
};
```

V1 binds a **small fixed set** of sources (the union above). The binding logic
(source → value) is a pure function over the command context — see §5. This keeps
"where values come from" out of the engine (`src/ai/template.ts` only sees a flat
`TemplateValues`), preserving the iron rule.

### Explicitly-deferred V2 extension seams (named, not built)

- **Selects / enums** as a variable source (e.g. a `grade` dropdown the teacher
  defines) — declare in `OperationVariable` (`source: "select"`, `options: []`);
  the engine is untouched (the chosen value is just another scalar).
- **Conditionals / loops** (`{{#if}}`, `{{#each}}`) — would extend the grammar.
  Kept out of V1 to keep the engine a single regex pass. The seam: a `compile()`
  step that returns an AST instead of doing inline regex replace.
- **Post-processing** (trim, max-length, lowercase per variable) — a
  `transform?: string[]` on `OperationVariable`, applied in the binding layer
  before values reach `renderTemplate`. Engine unchanged.
- **Escaped literals** (`\{\{`) — a grammar tweak; out of V1.

---

## 4. Data model + storage + resolution

### The `Operation` record

Modeled exactly like the other vault entities (concept/relation/layer): a
`recordEnvelopeSchema`-wrapped record with a domain payload.

```ts
// src/core/schema/operation.ts  (NEW)
import { z } from "zod";
import { operationIdSchema, recordEnvelopeSchema } from "./common";

export const operationVariableSourceSchema = z.enum([
  "anchorText", "sourceTitle", "existingNotes", "literal"
]);

export const operationVariableSchema = z.object({
  name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
  label: z.string().optional(),
  source: operationVariableSourceSchema,
  default: z.string().optional(),
  required: z.boolean().default(false)
});

export const operationSchema = recordEnvelopeSchema("operation", operationIdSchema).extend({
  name: z.string().min(1),                 // teacher-facing title ("Explain for Grade 3")
  description: z.string().default(""),
  outputType: z.string().min(1),           // a registered NoteContentSpec contentType
  scope: z.enum(["anchor", "source"]).default("anchor"), // passage-level vs source-level
  template: z.string().min(1),             // the {{variable}} prompt body
  variables: z.array(operationVariableSchema).default([]),
  visibility: z.enum(["private", "shared", "public"]).default("private") // shareability later
});

export type OperationRecord = z.infer<typeof operationSchema>;
export type OperationVariable = z.infer<typeof operationVariableSchema>;
```

Supporting additions:
- `src/core/ids.ts` — add `operation` to `entityKinds` with prefix `op`
  (`idPrefixByKind`), so `createEntityId("operation")` yields `op_<ULID>` and
  `operationIdSchema` validates it. This is the same pattern as every other
  entity (`src/core/ids.ts:3-16`).
- `src/core/schema/common.ts` — add `operationIdSchema = idSchema("operation")`.
- `src/core/schema/index.ts` — `export * from "./operation"` (and optionally add
  to `vaultEntitySchema` if operations should travel in full-vault export).

### Storage — mirror `createSnapshotStore` / `entityFileNames`

```ts
// src/core/store/entities.ts  (EXTEND)
export const entityFileNames = {
  ...,                       // existing 8 files
  operations: "operations.jsonl"
} as const;

export type EntityStores = {
  ...,
  operations: SnapshotStore<OperationRecord>;
};

// in createEntityStores(...):
operations: createSnapshotStore({
  filePath: filePath(entityFileNames.operations),
  schema: operationSchema, storage
}),
```

`createVault` already seeds an empty file for every `entityFileNames` entry
(`src/core/vault.ts:97-99`), so the new store needs no extra bootstrap. The
`SnapshotStore` (`src/core/store/snapshotStore.ts`) gives `list/get/upsert/delete`
with the same write-lock + last-writer-wins dedupe the other entities use.

### CRUD endpoints — mirror concepts/relations (`src/server/app.ts:746-832`)

```
GET    /api/operations           → { operations: OperationRecord[] }   (vault.stores.operations.list())
POST   /api/operations           → 201 { operation }                   (createEntityId + operationSchema.parse + upsert)
GET    /api/operations/:id       → { operation } | 404
PATCH  /api/operations/:id       → { operation }                       (merge + bump updatedAt + re-validate + upsert)
DELETE /api/operations/:id       → { ok: true } | 404
```

`POST`/`PATCH` should run a **template-vs-variables consistency check** server-side
(a `StructuredGenerationError`-style 400 when `extractVariables(template)`
references a name with no declaration, or vice-versa) — see §8. Body validation
reuses `operationSchema` exactly as `conceptSchema`/`relationSchema` are reused at
`src/server/app.ts:758` / `:805`.

### Client seam — `entityClient` methods

Add to `src/client/data/entityClient.ts` (alongside the concepts/relations
methods, `:301-323`), plus the `OperationRecord` TS type:

```ts
operations() { return getJson<{ operations: OperationRecord[] }>("/api/operations"); },
createOperation(input) { return sendJson("POST", "/api/operations", input); },
updateOperation(id, input) { return sendJson("PATCH", `/api/operations/${id}`, input); },
deleteOperation(id) { return sendJson("DELETE", `/api/operations/${id}`, undefined); },
```

### Generate-time unification — `resolvePrompt(id)`

The keystone. A single resolver returns a **common shape** that both a built-in
`KitPrompt` and a stored `Operation` satisfy, so `generateStructuredContent`
stops caring which kind it has:

```ts
// Proposed — lives server-side (it reads the operation store), e.g. src/kits/structured.ts
//            or a new src/server/operations/resolve.ts. NOT in src/ai (it touches the store).
export type ResolvedPrompt = {
  id: string;
  outputType: string;
  build(input: Record<string, unknown>): string;
  mockContent?(input: Record<string, unknown>): unknown;
};

export async function resolvePrompt(
  id: string,
  store: SnapshotStore<OperationRecord>
): Promise<ResolvedPrompt | undefined> {
  const builtin = getKitPrompt(id);            // src/kits/prompts.ts
  if (builtin) return builtin;                 // KitPrompt already IS ResolvedPrompt's shape

  const op = await store.get(id);              // src/core/store/snapshotStore.ts
  if (!op) return undefined;
  return {
    id: op.id,
    outputType: op.outputType,
    build: (input) => renderTemplate(op.template, bindOperationValues(op, input)),
    // no mockContent → generateStructuredContent falls back to spec.createDefault()
  };
}
```

`generateStructuredContent` (`src/kits/structured.ts:25`) changes one line —
`const prompt = getKitPrompt(...)` becomes `const prompt = await resolvePrompt(...)`
— and gains the operation store as a dependency (threaded from `createApp`, which
already holds `vault.stores`). Note `KitPrompt` is **structurally assignable** to
`ResolvedPrompt`, so existing prompts need no wrapping.

`bindOperationValues(op, input)` maps each declared `OperationVariable` to a value:
`source:"literal"` → `default`; `anchorText`/`sourceTitle`/`existingNotes` → read
from the runtime `input` the command supplied (the command is what knows
`focus`/`chatContext`; the server just consumes the flattened `input`). The
server-side binder can also fill from `input` keyed by `variable.name` directly,
keeping the server agnostic about UI sources.

> **Where binding really happens:** to keep the server free of focus/UI concepts,
> the **command** (§5) does the source→value gathering on the client and passes a
> flat `input: { [name]: value }` to `/api/kits/generate`. The server-side
> `build()` then just `renderTemplate(template, input)`. `bindOperationValues`
> on the server reduces to "apply `literal` defaults + pass the rest through",
> which also lets non-UI callers (tests, batch) drive an operation directly.

---

## 5. Upper layer (造操作 UI)

Two surfaces: an **Operations Manager** (CRUD) and a **runnable action** wired
into the existing toolbar + preview loop.

### Operations Manager (a workspace view)

A new registered workspace view (peer of `conceptViews.tsx` /
`layerViews.tsx` under `src/client/workspace/`), reachable from a dock panel:

- **List** — `entityClient.operations()`; each row shows name, `outputType`,
  `scope`, Edit / Delete.
- **Create / Edit form** (the *builder*):
  - **Name** + **Description** (free text).
  - **Output type** — a `<select>` populated from `listNoteContentSpecs()`
    (`src/core/notes/contentTypes.ts:30`), so a teacher picks any registered
    content shape (`markdown`, `flashcard`, `quiz`, `textbook.explanation`, …).
    The picker is the bridge between "free-text operation" and "validated note".
  - **Scope** — anchor (passage-level) vs source (whole-document) radio.
  - **Template editor** — a `<textarea>` for the `{{variable}}` body, with a
    **variable-insert affordance**: a small palette of the available sources
    (`anchorText`, `sourceTitle`, `existingNotes`) that inserts `{{name}}` at the
    cursor. As the user edits, run `extractVariables(template)` live and
    reconcile against the declared variables list (add missing, flag orphans).
  - **Declared variables** — a small editable table (name, label, source,
    default, required), auto-seeded from `extractVariables`.
  - **Test run** — a button that fires the same `operation.run` path against the
    current focus and shows the result in the **existing GenerationPreview**
    (§ below). This is the authoring "test run" surface — we do **not** build a
    second preview.
  - **Save** — `createOperation` / `updateOperation`.

All data access goes through `entityClient`, consistent with the rule that
"workspace nodes never call `fetch` directly"
(`src/client/data/entityClient.ts:1-4`).

### Surfacing a custom operation as a runnable action

Built-in kit actions reach the UI as `KitSurfaceItem`s in the
`selection-toolbar` / `source-actions` slots, each pointing at a registered
`Command` (`src/kits/textbook-learning/surfaces.ts`,
`src/client/workspace/SelectionToolbar.tsx`). Stored operations are *runtime
data*, not compile-time surface contributions, so they need a dynamic path:

1. **One generic command** `operation.run`, registered once in the core command
   registry (`src/client/commands/registry.ts`). Its `payload` carries
   `{ operationId, outputType, scope }`. In `run`, it:
   - gathers values for each declared source from `ctx.focus` / `ctx.chatContext`
     (e.g. `anchorText` ← `ctx.focus.anchor?.quote || ctx.chatContext?.quote`,
     `existingNotes` ← `ctx.client.notes(sourceId)` for source-scope) — exactly
     the gathering the textbook commands already do
     (`src/kits/textbook-learning/commands.ts:13-15,84-88`);
   - materializes an anchor for anchor-scope (`ctx.focus.materializeAnchor()`);
   - calls `ctx.client.generateStructured({ promptId: operationId, contentType:
     outputType, input })` — the **same** client method the built-ins use
     (`src/client/data/entityClient.ts:427`);
   - emits the **same** `GeneratedDraft` via `ctx.actions.onGenerated`
     (`src/client/commands/registry.ts:23-30`), so the result flows into the
     preview stage.

2. **A "Custom actions" affordance** in the UI: a small list/menu (next to the
   `SelectionToolbar`, or a dropdown in it) populated at render time from
   `entityClient.operations()` filtered by `scope` against the current focus.
   Each item dispatches `operation.run` with its `operationId` via
   `WorkspaceContext.dispatch` (`src/client/workspace/WorkspaceContext.tsx:525`).
   This reuses the existing toolbar plumbing without forcing operations through
   the static `kitSurfaceContributions` array.

### Reusing the generate→preview→edit→save loop

The loop already exists end-to-end and is the natural test-run + run surface:
`onGenerated` parks a `GeneratedDraft` in `WorkspaceContext.pendingDraft`
(`WorkspaceContext.tsx:491`), `GenerationPreview` renders it through the same
client NoteType plugin a saved note uses
(`src/client/workspace/GenerationPreview.tsx:33`), and Save dispatches
`anchor.add-note` with explicit `anchorIds`
(`WorkspaceContext.tsx:545-556`). Because `operation.run` emits the identical
draft shape and a registered `outputType`, **the preview, edit, regenerate, and
save behaviors all work for custom operations with zero preview-side changes.**
(Design will be cross-referenced with `docs/design/generation-preview.md` once
that lands.)

---

## 6. Staged plan

### Phase V1 — minimal usable "operation as data"

Engine + data model + storage + minimal builder + run-through-preview.

**Add:**
- `src/ai/template.ts` — `extractVariables`, `renderTemplate`, `OperationVariable`-agnostic
  (pure; the variable model type can live with the schema, the engine only sees `TemplateValues`).
- `src/ai/template.test.ts` — pure-engine unit tests (§7).
- `src/core/schema/operation.ts` — `operationSchema`, `operationVariableSchema`.
- `entityClient` operation methods + `OperationRecord` type
  (`src/client/data/entityClient.ts`).
- `resolvePrompt` + `bindOperationValues` (server-side; in `src/kits/structured.ts`
  or a new `src/server/operations/resolve.ts`).
- `operation.run` generic command (`src/client/commands/registry.ts`).
- Operations Manager view + builder form (new `src/client/workspace/operationViews.tsx`).
- "Custom actions" affordance (extend `SelectionToolbar` host or a sibling).

**Change:**
- `src/core/ids.ts` — register `operation` kind (`op` prefix).
- `src/core/schema/common.ts` — `operationIdSchema`.
- `src/core/schema/index.ts` — export operation schema.
- `src/core/store/entities.ts` — `operations` file + store.
- `src/server/app.ts` — `/api/operations` CRUD (mirror `:746-832`); thread the
  operations store into `generateStructuredContent` so it can call `resolvePrompt`.
- `src/kits/structured.ts` — `getKitPrompt` → `resolvePrompt` (one-line resolve swap;
  validation/sample/delegate unchanged).
- Register `operation.run` and the operations view in the client composition root.

**Out of scope for V1 (no code):** select/enum variables, conditionals/loops,
per-variable transforms, escaped literals, sharing/export, AI-assisted template
authoring.

### Phase V2 — richer authoring + sharing (deferred)

- **Variable sources**: `select` (teacher-defined dropdowns), more focus-derived
  sources (`contextBefore/After`, page, source metadata).
- **Engine extensions**: `compile()` AST + `{{#if}}` / `{{#each}}`; escaped `\{\{`.
- **Per-variable transforms** (`transform: ["trim","maxLen:200"]`).
- **Shareability**: an operation `.opspack` export/import echoing the Study Layer
  `.studypack` mechanism (`docs/design/study-layer.md`,
  `entityClient.exportLayer`/`importPreview`/`importCommit`). `visibility` and the
  `recordEnvelope` `createdBy` already anticipate this.
- **Surface integration**: let an operation opt into a real `selection-toolbar`
  slot with an icon/priority, bridging dynamic operations into the static surface
  model.

---

## 7. Test strategy

| Layer | What | Where |
| --- | --- | --- |
| **Pure engine** | `extractVariables` (distinct, order, whitespace, ignores garbage braces); `renderTemplate` (scalar/array/missing/object/escaping rules, separators, idempotence) | `src/ai/template.test.ts` (NEW) — no fixtures, mirrors `src/ai/structured.test.ts` style. |
| **Schema** | `operationSchema` accepts/rejects (bad `name` regex, missing `template`, unknown `outputType` left to runtime); variable name grammar | extend `src/core/schema/schema.test.ts`. |
| **Server resolution + validation** | `resolvePrompt` returns built-in for a kit id and a rendered build for a stored op; the `outputType !== contentType` guard still 400s; template-vs-variables consistency 400; `/api/operations` CRUD round-trip | `src/server/app.test.ts` (existing kit-generate + concepts/relations tests are the template). |
| **Kit wrapper** | `generateStructuredContent` runs a stored operation end-to-end (mock provider echoes `spec.createDefault()` sample → validates) and a built-in still works | `src/kits/structured.test.ts`. |
| **E2E (web, mock)** | Author an operation in the builder → test-run shows it in GenerationPreview → Save persists a note of the chosen `outputType`; run a saved custom action from the toolbar | new `e2e/operation-authoring.spec.ts`, leaning on the existing preview/textbook specs. |

**Determinism caveat (mock provider).** A stored operation has no `mockContent`,
so the mock path returns `spec.createDefault()` for its `outputType`
(`src/kits/structured.ts:41`) — a fixed, schema-valid object. E2E assertions
must therefore key on the **structure/type** of the generated note (and that
preview/save round-trips), **not** on prompt-specific text — because the mock
ignores the rendered template body. Engine unit tests (which *do* assert the
exact rendered string) are where template substitution correctness is pinned;
the e2e only proves the wiring (author → resolve → generate → preview → save).
This split keeps both deterministic.

---

## 8. Risks & open questions

1. **Binding sources to the command `input`.** Decision: the **client command**
   gathers source→value (it has `focus`/`chatContext`) and posts a flat
   `input: { name: value }`; the server's `build()` just renders. This keeps the
   server (and `src/ai`) free of UI concepts and lets tests/batch drive operations
   directly. Risk: a teacher declares a source the current focus can't supply
   (e.g. `existingNotes` on an anchor-scope run) → value is missing → renders `""`.
   Mitigated by `scope` gating which operations appear for a given focus, and by
   the `missing` injection point for future strict mode.

2. **Validating templates against declared vars.** `POST`/`PATCH /api/operations`
   should reject (400) when `extractVariables(template)` and the declared
   `variables[].name` disagree (orphan placeholder or unused declaration). Open
   question: hard error vs. warning. Recommendation: warn in the builder live,
   **soft-allow** orphan placeholders (they render `""`) but **block** a declared
   variable whose `source` is `literal` with no `default` only if `required`.

3. **Id collisions between built-in promptIds and operation ids.** Operation ids
   are `op_<ULID>` (new prefix), structurally distinct from kit prompt ids like
   `textbook.explain-concept`. `resolvePrompt` checks `getKitPrompt` first, so a
   stored op can never shadow a built-in. The dotted-namespace convention for
   kit prompts vs. the `op_` prefix for stored operations keeps the two id spaces
   disjoint by construction.

4. **Migration of the existing 4 textbook prompts.** Recommendation: **keep them
   as code** for V1. They carry bespoke `mockContent` (deterministic e2e
   fixtures — `explainConcept.prompt.ts:29`) that the data model has no
   equivalent for, and they back kit `Command`s with kit-specific surfacing.
   They prove the `ResolvedPrompt` shape is a superset of `KitPrompt`. A later
   slice *could* express them as seeded operations once the data model supports
   per-operation mock samples, but that is not required and not in scope.

5. **Shareability.** Deferred to V2 (`.opspack`, mirroring `.studypack`). The
   schema is pre-shaped for it (`recordEnvelope` + `visibility`), so adding it
   later is additive, not a migration.

6. **Output-type drift.** An operation references `outputType` by string; if a kit
   that registered that contentType is later deactivated/uninstalled,
   `getNoteContentSpec(outputType)` returns undefined → the existing 400
   "Unknown contentType" path fires (`src/kits/structured.ts:33`). Acceptable for
   V1; a builder-time check that the `outputType` is currently registered is a
   nice-to-have.

7. **`createdBy` provenance.** Operations are authored by a user but produce
   `ai`-created notes. The operation record's envelope `createdBy` is `user`
   (the author); the generated note keeps the existing note-creation `createdBy`
   semantics. No change needed, noted for clarity.

---

## Appendix — cited symbols/paths

- `src/kits/types.ts:57` — `KitPrompt` (`build(input): string`).
- `src/kits/textbook-learning/prompts/*.prompt.ts` — hardcoded prompt bodies.
- `src/kits/prompts.ts` — `registerKitPrompt` / `getKitPrompt` / `listKitPrompts`.
- `src/kits/server.ts:15` — `installServerKits()` registers prompts.
- `src/kits/structured.ts:25-52` — `generateStructuredContent` (resolve + validate + delegate).
- `src/ai/structured.ts:52` — `generateStructured` (mechanism: inject/extract/parse/retry).
- `src/ai/index.ts` — provider selection (mock default = deterministic).
- `src/server/app.ts:51-55,746-832,987-999` — generate body schema; concepts/relations CRUD; generate route.
- `src/core/store/entities.ts:24-58` — `entityFileNames` + `createEntityStores`.
- `src/core/store/snapshotStore.ts` — `createSnapshotStore` (`list/get/upsert/delete`).
- `src/core/schema/common.ts:26` — `recordEnvelopeSchema`.
- `src/core/schema/concept.ts` — entity schema template.
- `src/core/ids.ts:3-29` — entity kinds / id prefixes / `createEntityId`.
- `src/core/vault.ts:97-110` — file seeding + `createEntityStores` wiring.
- `src/core/notes/contentTypes.ts:11-30` — `NoteContentSpec`, `getNoteContentSpec`, `listNoteContentSpecs`.
- `src/client/data/entityClient.ts:301-323,427` — concepts/relations methods; `generateStructured`.
- `src/client/commands/registry.ts:23-30,166-197` — `GeneratedDraft`; `anchor.add-note`.
- `src/kits/textbook-learning/commands.ts:13-15,21-45,84-88` — value gathering; `generateBlock`; review-pack input.
- `src/kits/textbook-learning/surfaces.ts` — `KitSurfaceItem` toolbar contributions.
- `src/client/workspace/SelectionToolbar.tsx` — surface rendering + dispatch.
- `src/client/workspace/WorkspaceContext.tsx:479-581` — command context, `dispatch`, preview actions.
- `src/client/workspace/GenerationPreview.tsx` — the preview/edit/save view.
- `docs/design/ai-orchestration.md` — iron rule + structured-generation engine.
- `docs/design/study-layer.md` — share/import (`.studypack`) precedent for V2 shareability.

---

## Implementation log

V1 shipped. This section records the actual on-disk state and supersedes §§1–8
where they differ. The proposal's core thesis held: **the only mechanism change
is at the resolve step** (`getKitPrompt` → `resolvePrompt`); spec lookup,
validation, mock sample, retry, and the preview/save loop are reused unchanged.

### Files changed (`git diff HEAD --stat`)

**New files:**
- `src/ai/template.ts` — the pure `{{var}}` engine (`extractVariables`, `renderTemplate`).
- `src/ai/template.test.ts` — pure-engine unit tests.
- `src/core/schema/operation.ts` — `operationSchema` + `operationVariableSchema`.
- `src/kits/resolvePrompt.ts` — `resolvePrompt` + `bindOperationValues` (NOT in
  `src/kits/structured.ts` as the proposal floated; its own module).
- `src/client/workspace/operationViews.tsx` — Operations Manager / builder view
  (+ `buildForkTemplate`).
- `src/client/workspace/operationViews.test.tsx` — `buildForkTemplate` unit tests.
- `e2e/operation-authoring.spec.ts` — end-to-end author → preview → save → run → prefs spec.

**Modified files:**
- `src/core/ids.ts` — register `operation` kind (`op` prefix).
- `src/core/schema/common.ts` — `operationIdSchema`.
- `src/core/schema/index.ts` — export `./operation`.
- `src/core/schema/schema.test.ts` — operation schema accept/reject cases.
- `src/core/store/entities.ts` — `operations: "operations.jsonl"` file + `SnapshotStore`.
- `src/kits/structured.ts` — resolve swap (see below); threads the operation store.
- `src/kits/structured.test.ts` — stored-op end-to-end through `generateStructuredContent`.
- `src/kits/types.ts` — optional `KitPrompt.params` (placeholder declarations for prefs fill).
- `src/kits/textbook-learning/prompts/explainConcept.prompt.ts`,
  `generatePractice.prompt.ts` — declare `params` (grade/subject/difficulty).
- `src/server/app.ts` — `/api/operations` CRUD, `/api/operation-prefs` GET/PUT,
  params-merge in `/api/kits/generate`, `operationConsistencyError`.
- `src/server/app.test.ts` — CRUD round-trip, consistency 400, prefs, params-merge.
- `src/client/data/entityClient.ts` — operation CRUD + prefs methods + `OperationRecord`/`OperationPrefs` types.
- `src/client/data/entityClient.test.ts` — client method coverage.
- `src/client/commands/registry.ts` — generic `operation.run` command.
- `src/client/commands/registry.test.ts` — `operation.run` coverage.
- `src/client/workspace/WorkspaceContext.tsx` — load operations + prefs, merge/order
  anchor- and source-scope action lists.
- `src/client/workspace/SelectionToolbar.tsx`, `SourceActionsToolbar.tsx`,
  `WorkspaceShell.tsx`, `dock.ts`, `presets.ts`, `views.tsx` — surface the manager
  view + custom actions in the toolbars/dock.
- `src/client/styles.css` — manager/builder styling.

### The engine (`src/ai/template.ts`)

Shipped as proposed in §3 and obeys the iron rule (imports nothing from
`src/kits`/`src/core`). One regex `/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g`
backs both functions:

```ts
export function extractVariables(template: string): string[];
export function renderTemplate(
  template: string,
  values: Record<string, unknown>,
  opts?: { arrayJoin?: string; missing?: (name: string) => string }
): string;
```

Total (never throws on author input): missing/null → `""` (override via `missing`),
arrays → joined on `\n` (override via `arrayJoin`), objects → `JSON.stringify`,
scalars → `String()`, stray single braces pass through.

### The resolvePrompt swap

`src/kits/structured.ts` changed its one resolve line and gained an optional store
parameter:

```ts
// before: const prompt = getKitPrompt(request.promptId);
const prompt = await resolvePrompt(request.promptId, store);
```

`resolvePrompt(id, store?)` (`src/kits/resolvePrompt.ts`) checks `getKitPrompt`
first (built-ins win, id spaces disjoint by construction), else loads the stored
`OperationRecord` and wraps it as a `ResolvedPrompt` (= `KitPrompt`) whose
`build()` is `renderTemplate(op.promptTemplate, bindOperationValues(op, input))`.
A stored op has no `mockContent`, so the mock path falls back to
`spec.createDefault()`. `bindOperationValues` applies `literal` defaults and fills
other vars from runtime input. The store is threaded from `createApp`
(`vault.stores.operations`) into `generateStructuredContent(provider, merged, 3, store)`.

### Prefs storage (operation-prefs.json)

A workspace-level addition beyond the original proposal. `operation-prefs.json`
lives in `vault.paths.studyDir` (same `vault.storage` atomic-write path as
`workspace.json`) and holds `{ order: string[]; disabled: string[]; params:
Record<string, Record<string,string>> }`:
- `order` / `disabled` — the merged toolbar action list (built-in command ids +
  `op_` ids) ordering and on/off toggles, surfaced by the manager and read by both
  toolbars via `WorkspaceContext`.
- `params` — per-built-in placeholder values (e.g. `grade`/`subject`). On
  `/api/kits/generate` the server merges `prefs.params[promptId]` UNDER the runtime
  input (`{ ...params, ...input.input }`) so runtime values always win, and only
  the prompt's declared `params` placeholders are fillable — the固化 prompt body is
  never user-editable. Routes: `GET`/`PUT /api/operation-prefs`.

This also backs the **fork** flow (`operation.source: "custom" | "fork"`,
`forkedFrom`): `buildForkTemplate` approximates a built-in's body as an editable
`{{var}}` template so a teacher can fork-and-edit a code prompt into a data op.

### New e2e spec

`e2e/operation-authoring.spec.ts` (mock provider) drives the full loop: author a
custom action in the builder → 试一下 preview renders the rendered template →
Save persists a note of the chosen `outputType` → run the saved action from the
toolbar → enable/disable toggle → edit a built-in placeholder param and assert it
persisted to `operation-prefs.json`. Per the §7 determinism caveat, assertions key
on note structure/type and prefs state, not mock-ignored prompt text.

### Review findings

Fixed:
- **(medium) Missing `GET /api/operations/:operationId`** — added in
  `src/server/app.ts` (returns `{operation}` or 404), mirroring
  `GET /api/concepts/:conceptId`; it was the one CRUD verb missing.
- **(medium) Missing unit test for `buildForkTemplate` edge cases** — exported
  `buildForkTemplate` from `src/client/workspace/operationViews.tsx` and added
  `operationViews.test.tsx` covering normal fork, params present, `params=[]` (no
  extra tokens), and the `build()`-throws → empty-string fallback.

Rejected:
- **(high) "Schema field names deviate from approved specification"** — REJECTED
  as a false positive. The shipped fields `outputContentType` / `promptTemplate` /
  `declaredVariables` / `source` / `forkedFrom` in `src/core/schema/operation.ts`
  match the **governing fixed-scope 定稿** exactly. The reviewer compared against
  §4 of this proposal (which used `outputType` / `template` / `variables` /
  `visibility`); that proposal is superseded by the fixed scope. No contract
  mismatch exists; renaming would violate the fixed scope. No change made. (For
  the record: the proposal's `visibility` field was dropped in favor of
  `source`/`forkedFrom`, which the fork flow needed.)

Other low-severity review items (unused-param/input redundancy, `existingNotes`
always present in the input object) were assessed as benign — `existingNotes` is
only *fetched* when a declared variable asks for it (`registry.ts` guards the
`ctx.client.notes` call), and the flat well-known keys in the input object are
intentional so flat-named templates and the built-in params merge keep working.

### Still deferred (unchanged from §6 V2)

Select/enum variable sources, engine `compile()` AST + `{{#if}}`/`{{#each}}`,
per-variable transforms, escaped `\{\{` literals, and `.opspack` share/import all
remain out of scope.
