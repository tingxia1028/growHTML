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
