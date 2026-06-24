# Concept / Relation UI — manual linking, inspector, list (P5)

This is the landing doc for **P5** of the frontend re-abstraction
(`frontend-workspace-redesign.md` §P5). The Concept / Relation **schema + HTTP API**
were already done in P0/P1; the frontend had never surfaced them. P5 adds a **manual**
concept/relation UI on top of the existing node/ViewRegistry runtime
(`workspace-runtime.md`).

> **Scope (user-confirmed):** manual linking + inspector + list only. **No** AI
> auto-extraction, **no** graph visualization. The note content model and the
> SurfaceReader contract are untouched. The existing note / anchor / patch / chat flow
> and the three original views (`library` / `source.viewer` / `study`) keep working
> unchanged — the new surface is **additive DOM**, so all 16 existing e2e keep their
> original selectors.

## What was added

```
src/client/
  inspectors/
    registry.tsx          NEW  InspectorRegistry: targetType → render(focus, ctx)
    views.tsx             NEW  registers the concept + relation inspectors
    ConceptInspector.tsx  NEW  the concept detail surface (fields, notes, relations, actions)
    RelationInspector.tsx NEW  a relation's detail + delete
  workspace/
    conceptViews.tsx      NEW  the `concept.list` view (list + new-concept form + inspector host)
    presets.ts            +    `studyVaultLayout` = threePane + the concept pane
    WorkspaceContext.tsx  +    conceptsVersion / refreshConcepts + concept/relation action wiring
    WorkspaceShell.tsx    +    side-effect import of ./conceptViews
  commands/registry.ts    +    concept.create / concept.link-note / relation.create
  data/entityClient.ts    +    updateNote(), allNotes()
  App.tsx                 ~    renders studyVaultLayout (was threePane)
src/server/app.ts         +    PATCH /api/notes/:id (link/relink a note's conceptIds/anchorIds)
src/client/styles.css     +    .concept-panel + inspector styles; 4-column app-shell grid
```

## 1. Concept list view — `concept.list`

A **new pane** registered like any other view (`registerView({ kind: "concept.list", … })`
in `conceptViews.tsx`) and added to the app's default layout as a 4th node. It renders
`.concept-panel` (additive — it does not alter the library/reader/study DOM). It:

- lists concepts (`entityClient.concepts()`), each row a `.concept-item`; clicking sets
  `focus.setFocus({ type: "concept", conceptId })`;
- has a **New concept** form (`.concept-name-input` + optional `.concept-description-input`)
  wired to the `concept.create` command;
- below the list, an **inspector host** that renders `renderInspector(focus, ctx)` when a
  concept or relation is focused.

It owns its own list state and re-fetches whenever `conceptsVersion` (see §5) bumps. Like
every view it reads/writes only through `useWorkspace()` + the entity client.

### Why a new pane (and a new preset) instead of editing `threePane`

The node-ify guardrail requires the existing panels' DOM to stay byte-for-byte identical.
`threePane` is also the pristine 3-pane reference asserted by `WorkspaceShell.test.tsx`
(exact panel order, no `.workspace-node-missing`). So `threePane` is left untouched and
the app renders **`studyVaultLayout`** = `threePane` + one additive `concept.list` node.
The grid (`.app-shell`) gained a 4th column (`340px`); `body` min-width bumped 1120→1460.

## 2. InspectorRegistry — `src/client/inspectors/registry.tsx`

The redesign §8 seam: `targetType → render(focus, ctx)`, mirroring the ViewRegistry.

```ts
registerInspector({ targetType, render(focus, ctx) }): void
getInspector(targetType): InspectorPlugin | undefined
renderInspector(focus, ctx): ReactNode   // resolve by focus.type; null focus or
                                          // un-inspectable focus → null (no throw)
```

Two inspectors are registered (in `inspectors/views.tsx`, imported as a side effect by
the concept pane): `concept` → `ConceptInspector`, `relation` → `RelationInspector`.

## 3. Concept Inspector — driven by `focus.type === "concept"`

`ConceptInspector` loads `conceptDetail(id)` → `{ concept, notes, relations }` plus the
candidate lists the pickers need (`concepts()` for relation targets, `allNotes()` for
note linking). It shows:

- **fields** — name (`.concept-inspector-name`), aliases, description;
- **linked notes** (back-refs) — each a `.concept-note-item`; clicking focuses the note
  (`focus.setFocus({ type: "note", noteId })`);
- **relations** touching the concept (either direction) — each a `.concept-relation-item`
  showing `from —kind→ to`, with a delete (`.concept-relation-delete`);
- **manual actions** — a note picker + **Link note**, and a relation-kind + target-concept
  picker + **Add relation**.

It re-fetches on `conceptsVersion` change. `RelationInspector` is the lighter relation
counterpart (find-in-list since there is no `GET /api/relations/:id`) with a delete.

## 4. Note ↔ concept linking (manual) — the implemented UX

The chosen path is **link an EXISTING note from the Concept Inspector** (redesign option
(b)), which is the fully end-to-end-tested flow:

1. focus a concept → its inspector opens;
2. pick a note from `.concept-note-select` (candidates = notes not already linked here);
3. **Link note** → `concept.link-note` command → `PATCH /api/notes/:id` appends the
   concept id to the note's `conceptIds` (idempotent — never duplicates);
4. the note immediately appears as a back-ref in the inspector, and the source's note
   list refreshes (the link is visible in the study panel too).

This required a new **`PATCH /api/notes/:id`** endpoint (see §6) and an `updateNote`
entity-client method. (Option (a), a concept picker in the composer at note-creation
time, was not needed to satisfy the manual flow and was left out to keep the study panel
DOM untouched; `POST /api/notes` already accepts `conceptIds`, so it's a trivial future
add.)

## 5. Commands — `commands/registry.ts`

Registered alongside the existing anchor commands, same `CommandContext` pattern (they
collaborate only via the entity client + action callbacks):

| command | availability | does |
| --- | --- | --- |
| `concept.create` | non-blank `conceptName` | `createConcept({ name, description? })` → `onConceptChanged` |
| `concept.link-note` | `noteId` + `conceptId` | append concept to note's `conceptIds` via `updateNote` (idempotent) → `onConceptChanged` |
| `relation.create` | two **distinct** concepts + `relationKind` | `createRelation({ from, to, relationKind, label? })` → `onRelationChanged` |

`CommandContext.payload` gained concept/relation fields; `CommandContext.client` widened
to include `createConcept` / `updateNote` / `createRelation`; `CommandActions` gained
`onConceptChanged` / `onRelationChanged`.

The WorkspaceContext wires those two callbacks to bump a **`conceptsVersion`** token
(and `onConceptChanged` also refreshes the source's notes). Concept surfaces watch
`conceptsVersion` to re-fetch; `refreshConcepts()` bumps it after a direct mutation
(relation delete, which has no command). This keeps the WorkspaceContext as the single
seam without bloating it with concept-specific data (the surfaces own that via the
entity client).

Relation **delete** is a direct `entityClient.deleteRelation(id)` + `refreshConcepts()`
(the mission required a `relation.create` command and "allow delete", not a delete
command).

## 6. New API — `PATCH /api/notes/:id`

Partial note update for attachment links only (content is not editable here):

```
PATCH /api/notes/:id   body: { conceptIds?: string[]; anchorIds?: string[] }
  → 200 { note }   (the updated note; arrays replaced, updatedAt bumped)
  → 404            unknown note id
  → 400            body has neither conceptIds nor anchorIds (refine)
```

Validated by `updateNoteRequestSchema`; the merged record is re-parsed through
`noteSchema` before upsert.

## 7. Test matrix

| layer | file | covers |
| --- | --- | --- |
| supertest | `src/server/app.test.ts` | PATCH links a note → back-ref in `GET /api/concepts/:id`; 404 missing note; 400 empty body |
| vitest | `src/client/data/entityClient.test.ts` | `updateNote` hits `PATCH /api/notes/:id` with `conceptIds` |
| vitest | `src/client/commands/registry.test.ts` | `concept.create` (create + availability); `concept.link-note` (append/idempotent/availability); `relation.create` (payload + no self-relation) |
| vitest | `src/client/inspectors/registry.test.tsx` | register/resolve by targetType; render with focus+ctx; null/un-inspectable → null; later registration wins; listInspectors |
| web e2e | `e2e/concepts.spec.ts` | FULL manual flow through the real UI: create concept → appears in list; link a seeded note via the inspector → persists (`GET /api/notes?conceptId=`); inspector shows the back-ref + fields; create `A —depends_on→ B` → shows in BOTH inspectors → delete → gone from both |

**Guardrail:** the 16 existing e2e (9 web + 7 electron) stay green with their **original
selectors** — the concept surface only ADDS DOM (`.concept-panel` …), never restructures
the existing panels.

### Gate (P5)

`tsc --noEmit` clean · vitest **223** (208 baseline + 15 new) · web e2e **10** (9 existing
+ the new concept spec) · electron e2e **7** — all green, no existing-e2e selector edits.
