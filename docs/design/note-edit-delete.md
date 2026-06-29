# Note edit + delete (V1)

Adds two capabilities that were missing from notes (sources/layers/relations/operations
already had delete; PATCH on notes only touched attachment arrays): **deleting a saved
note** and **editing a saved note's content in place**. Both reuse existing seams — the
command layer, the entity client, and the note-type **registry editor** — so no new
render/edit path and no host-side `contentType` branching are introduced (the display-side
contract guard stays green).

## Server

### `DELETE /api/notes/:noteId`
Mirrors `DELETE /api/operations/:id` and `/api/relations/:id`: `vault.stores.notes.delete(id)`
→ `200 {ok:true}` on success, `404 {error}` if the id is absent.

**Orphan-anchor cascade (corrected):** painting is *anchor*-derived — the reader maps
**every** anchor on a source to a highlight (the note text is only the hover content). So
deleting only the note record would leave its anchors behind and the **highlight would stay
painted**. The handler therefore:

1. Loads the note first (404 if absent) to capture its `anchorIds`.
2. Deletes the note record (as before).
3. Loads the remaining notes + all patches **once**, then for each of the deleted note's
   `anchorIds` deletes that anchor **iff it is now orphaned** — referenced by **no remaining
   note** (none whose `anchorIds` includes it) **and no patch** (none whose `anchorId` === it).

Anchors still shared by another note (multi-anchor / shared) or referenced by a patch are
**kept**. After the cascade, `refreshAnnotations` re-fetches an `anchors` list without the
orphan → the reader's clear-then-paint repaint drops the highlight. (Earlier V1 deliberately
"left anchors", which is what caused the stale-highlight bug; that decision is superseded.)

### `PATCH /api/notes/:noteId` — content extension
`updateNoteRequestSchema` gains an optional `content` field. When present, the handler
re-validates it against the note's **existing** `contentType` via
`parseNoteContent(existing.contentType, input.content)` (the same `getNoteContentSpec(...)
.schema` gate `POST /api/notes` uses) before persisting the merged record — an invalid
shape is rejected `400` (ZodError handler) and never reaches storage. The `contentType`
is **fixed** on edit (editing content within the same type; changing type is out of scope).
The existing `conceptIds`/`anchorIds`/`layerIds` behavior is unchanged; the refine now
also accepts a body carrying only `content`. The stale "Content itself is not editable
here" comment was updated.

## Client

- `entityClient.updateNote(id, { content })` — `content?: unknown` added to the input type.
- `entityClient.deleteNote(id)` — `DELETE /api/notes/:id`.
- **Commands** (`src/client/commands/registry.ts`):
  - `note.delete` — destructive; asks `actions.confirm(message)` first (the host wraps
    `window.confirm`; tests inject a stub; unwired ⇒ proceed), then `client.deleteNote` →
    `onNoteDeleted`. One command deletes every note type (delete is type-agnostic).
  - `note.edit` — `client.updateNote(id, { content })` → `onNoteCreated` (which already
    re-fetches notes + repaints, covering an edited note). Available iff a `noteId` and a
    defined `content` are in the payload.
  - `CommandActions` gains `onNoteDeleted` + `confirm`; the `client` Pick gains `deleteNote`.
- **WorkspaceContext** wires `onNoteDeleted: refreshAnnotations` and
  `confirm: window.confirm` into the command actions.

## UI affordances

- **Note card** (`views.tsx` `NoteContentView`): an `.note-actions` row with **Edit** and
  **Delete** buttons (plus the existing "Open interactively"). Delete dispatches
  `note.delete`. Edit opens the note in place using **`getNoteType(contentType).edit(...)`**
  — the SAME registry editor the composer uses — seeded with a working copy of the note's
  current content; **Save** dispatches `note.edit` with the edited content; **Cancel**
  discards the working copy. No bespoke editor, no `contentType ===` branch, no literal
  contentType (contract law §0.5 / contract guard).
- **Bookmarks pane** (`bookmarkViews.tsx`): a bookmark IS a note, so each row gains a
  delete button (sibling of the jump button — `.bookmark-row` keeps its class/`data-note-id`
  for existing selectors). Editing a bookmark's label is available through the bookmark
  plugin's own chip affordance; the pane focuses on jump + delete.

## Tests

- Server (`app.test.ts`): delete 200 then 404; content edit persists + contentType fixed;
  invalid content → 400 (unchanged); content + attachment edits coexist. **Orphan-anchor
  cascade:** delete a note whose anchor is exclusive → the anchor is also removed; delete a
  note whose anchor is shared by another note → anchor kept; an anchor referenced by a patch
  → kept; a multi-anchor note → only the now-orphaned anchor is removed, the shared one stays.
- Entity client (`entityClient.test.ts`): `updateNote({content})` PATCH body; `deleteNote`
  DELETE method/url.
- Commands (`registry.test.ts`): `note.delete` confirm/decline/unwired + availability;
  `note.edit` patch + refresh + availability.
- Bookmarks (`bookmarkViews.test.tsx`): delete button dispatches `note.delete`.
- e2e (`note-edit-delete.spec.ts`): create → edit content → persists across reload;
  create → delete (confirm accepted) → gone, stays gone after reload; **select a passage →
  save an anchored note (highlight painted) → delete → the `.sv-annotated` highlight is gone
  from the reader (not just the list row), and stays gone after reload** — the regression the
  orphan-anchor cascade fixes.
