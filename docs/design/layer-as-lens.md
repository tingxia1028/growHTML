# Layer as lens — user-definable layers + multi-membership note filtering

**Status: Implemented (V1).**

## Context

Today a **Study Layer** is "the unit of sharing": a per-source bundle of {anchors + notes}
with `importMode: owned | imported | subscribed`, an `enabled` on/off toggle (a disabled
layer's anchors aren't painted), and `.studypack` export/import (`src/core/schema/study-layer.ts`).
Every note/anchor carries a single optional `layerId` (`src/core/schema/note.ts:38`,
`anchor.ts:22`), and each source auto-creates one `owned` layer that all its notes land in.

We want layers to become a **richer, user-definable lens / category axis** that **filters
notes** — built-in stages (预习 / 学习 / 复习 / 拓展) plus arbitrary user-defined layers — and
a note can belong to **several** at once (e.g. 复习 + 重点 + a custom layer). Sharing becomes
**one capability** of a layer, not its defining purpose. This also collapses the separate
"review mode" idea: 复习 is just "filter to the 复习 layer."

The mechanism is mostly already present (`note.layerId` membership + `enabled` filter +
per-source layers); the change is to go **multi-membership** and generalize the UX.

## The core data change

- `note.layerId` (single) → **`note.layerIds: string[]`** (multi). This is the one required
  schema change.
- **Anchor visibility is derived, not stored.** An anchor is painted iff it has a note in an
  enabled layer. Reason: one anchor can be shared by several notes with different layers, so a
  stored `anchor.layerIds` would drift. So deprecate `anchor.layerId` as the filter source and
  derive from the notes on it. (Lower-touch alternative: mirror `anchor.layerIds[]` — rejected
  for the sync hazard; keep only if standalone note-less anchors must be filterable.)
- **Migration (backward-compatible):** existing single `layerId` → `[layerId]`; empty → the
  source's base/owned layer. Reuse the existing layer-backfill migration precedent (the one
  that backfilled the owned layer onto pre-layer records).

## Filter semantics (fixed)

A note is visible ⇔ `layerIds ∩ {enabled layers} ≠ ∅` (**OR** across its layers). The existing
`patchLayer(enabled)` toggle is reused; the layer switcher becomes a multi-select filter.
On create, a note defaults to the source's base layer if no `layerIds` is supplied (so nothing
is ever orphaned/invisible).

## Layer model additions (small, additive)

`studyLayerSchema` gains optional, presentation/organization-only fields:
- `role`: `"preset" | "custom" | "shared"` (preset = 预习/学习/复习/拓展; shared = imported).
- `color`, `order` — for the manager UI and the filter chips.
Preset stage layers are just pre-named layer records, created per source on demand (like the
owned layer is auto-created). `importMode` stays; sharing (export/import) is unchanged and is
now just something a layer *can* do.

## Impact map

| Area | Change |
| --- | --- |
| Schema | `note.layerIds[]` (`src/core/schema/note.ts`); deprecate `anchor.layerId` as filter source; layer `role`/`color`/`order` (`study-layer.ts`) |
| Migration | single→array backfill; default base layer; reuse existing layer migration |
| Server filter/paint | "an anchor paints iff it has a note in an enabled layer" (derive); note list filtered by enabled-layer OR |
| Studypack | a layer's notes = notes whose `layerIds` includes it; import merges membership into the target layer (`src/server/studyLayer.ts`, `pack.ts`) |
| Client | `NoteRecord.layerId?` → `layerIds: string[]`; `updateNote({ layerIds })` = add/remove/move; `WorkspaceContext` note filter = OR over enabled layers (`src/client/data/entityClient.ts`, `WorkspaceContext.tsx`) |
| UI | layer manager (create/rename/recolor/reorder/delete custom layers) + preset stages; a multi-select **filter** switcher; a "move/add to layer" action on a note |

## Defaults chosen (adjustable)

1. **Membership lives on the note** (`note.layerIds[]`); anchor visibility derived — cleanest
   (anchor = pure location, layer = the note's lens).
2. **OR filter** (a note shows if any of its layers is enabled).

## Staged plan

**V1:** the `note.layerIds[]` schema change + migration + the OR filter + derived anchor
painting + a layer manager (presets 预习/学习/复习/拓展 + user-defined) + a multi-select filter
switcher + a "move/add to layer" action. Sharing (export/import) already works — just teach it
multi-membership.

**Deferred:** cross-source layers; per-layer view styling beyond color; any scheduling/SRS
(out of scope — "复习" here is purely an organizational filter, not a timed-review subsystem).

## Tests

- Schema: `note.layerIds` accept/reject; migration single→array.
- Server: filter = OR over enabled layers; anchor paints iff a note on it is in an enabled
  layer; studypack export/import round-trips multi-membership.
- E2E: assign a note to multiple layers → toggle a layer → the note shows/hides by the OR rule;
  create a custom layer; move a note between 预习/复习.

## Implementation log

V1 shipped as proposed: multi-membership on the note, an OR visibility filter, derived
anchor painting, preset stages + a custom-layer manager, and a multi-select filter
switcher. Sharing (export/import) was taught multi-membership. The deferred list below
stays deferred.

### Files changed

Confirmed against `git diff HEAD --stat` (the on-disk working tree):

| File | What changed |
| --- | --- |
| `src/core/schema/note.ts` | Added `layerIds: z.array(layerIdSchema).default([])` (the one required schema change). Kept `layerId?` as a deprecated, migration-only field so the backfill can still read a pre-multi note's stored single id before it is dropped. |
| `src/core/schema/anchor.ts` | `layerId` kept but its doc comment now marks it DEPRECATED as the paint filter — anchor visibility is DERIVED from the notes on the anchor. Still backfilled by migration for legacy/standalone anchors. |
| `src/core/schema/study-layer.ts` | Added optional, presentation-only `role: "preset" \| "custom" \| "shared"`, `color: string`, `order: number`. None affect filter/visibility. |
| `src/core/study-layer/layers.ts` | Migration wraps single `layerId` → `layerIds`; lazy creation of the owned layer + the four preset stages; custom-layer helpers. |
| `src/server/app.ts` | Note POST defaults membership to `[owned]` (when a `sourceId` is given and no explicit `layerIds`); note PATCH does a full `layerIds` replace; note list + derived anchor painting filtered by `layerVisibilityFilter` (OR over the enabled set, honoring an explicit `enabledLayerIds` csv param); lazy preset/owned layer creation on layer-list; layer POST (custom), PATCH (color/order/enabled/rename), DELETE (custom-only, 409 otherwise) with cascade strip (see fixes). |
| `src/server/studyLayer.ts` | Threaded multi-membership through the layer/pack endpoints. |
| `src/client/data/entityClient.ts` | `updateNote({ layerIds })`, `createLayer`, `deleteLayer`, `patchLayer({ color, order })`. |
| `src/client/commands/registry.ts` | New `note.set-layers` command (full-membership replace) plus `createLayer`/`deleteLayer` client actions wired in. |
| `src/client/workspace/layerViews.tsx` | The Layers pane: grouped (owned/preset/custom/shared via `groupOf()`) multi-select filter, create-custom row, rename/recolor/reorder/delete controls. |
| `src/client/workspace/views.tsx`, `WorkspaceContext.tsx` | Per-note membership chips + checkbox picker (`.note-layers`); context note filter = OR over enabled layers. |
| `src/client/styles.css` | Layer pane, chips, picker, color-dot styling. |
| `docs/samples/teacher-layer.studypack`, `scripts/smoke-textbook-kit.ts` | Sample/smoke updated to multi-membership shape. |

### Migration approach

`migrateStudyLayers` backfills as proposed and is idempotent: a note's legacy single
`layerId` → `[layerId]`; a note with no membership → `[ownedLayer]` (the source's
auto-created owned layer). A pre-multi note loads with `layerIds: []` (the schema default,
since the strict envelope keeps the deprecated `layerId` only for the backfill to read),
then migration moves it into `[owned]` and drops the legacy field. Anchors continue to be
backfilled onto the owned layer for legacy compatibility even though painting is now
derived.

### New e2e spec

`e2e/layer-as-lens.spec.ts` (web mode, server on 127.0.0.1:4177, reader iframe,
`.sv-annotated` highlights) — 4 scenarios:
1. A note in TWO layers ({预习, 复习}) shows by OR; visible while either is enabled, hidden
   only when both are off, returns when one is re-enabled.
2. Create a CUSTOM layer → it lands in the custom group (`data-role="custom"`, delete
   control present) and its filter governs a note assigned solely to it.
3. Move a note 预习 → 复习; visibility follows the enabled-layer filter through the move.
4. DERIVED painting: an anchor stops painting (`.sv-annotated` → 0) when all its notes'
   layers are disabled, and repaints when one is re-enabled.

### Unit-test additions

- `src/core/schema/schema.test.ts`: `note.layerIds` defaults empty, accepts valid layer
  ids, rejects non-arrays and non-layer ids.
- `src/core/study-layer/layers.test.ts`: legacy note loads with `layerIds: []`; migration
  produces `[owned]`; a note carrying the deprecated single `layerId` is wrapped into
  `layerIds` and the legacy field is dropped.
- `src/client/data/entityClient.test.ts`: `updateNote({ layerIds })` full replace,
  `createLayer`, `deleteLayer`, `patchLayer({ color, order })` request shapes.
- `src/client/commands/registry.test.ts`: `note.set-layers` sets full membership (incl.
  clearing to `[]`) and is unavailable without both a note id and a `layerIds` array.
- `src/server/studyLayer.test.ts`: owned-layer stamping now asserts `note.layerIds`; preset
  stages are lazily created; OR filter over enabled layers (incl. explicit `enabledLayerIds`
  param); empty-membership always visible; OR across 4 layers; derived anchor painting via
  multiple notes; export/import round-trips multi-membership; custom-only delete (409 on
  preset/owned); POST default-to-owned vs explicit `layerIds`; plus the Finding-1 regression
  below.

### Review findings (all fixed; checks/unit/e2e green)

- **Finding 1 (medium → FIXED, `src/server/app.ts`):** notes became orphaned/invisible when
  their only custom layer was deleted. `DELETE /api/layers/:layerId` now cascade-strips the
  deleted id from every note's `layerIds` before deleting the layer, so a note that lived
  only in it collapses to `[]` (always visible) while notes with other memberships keep
  them. Chose server-side cascade (atomic) over a client cleanup. Stale delete-comment
  rewritten. Regression test added.
- **Finding 2 (high → FIXED, `src/client/workspace/layerViews.tsx`):** rename/recolor/reorder
  controls were rendered for all layers (only delete was gated), letting users mutate
  structural preset/shared layers against spec. Wrapped those controls in a
  `groupOf(layer) === "owned" || groupOf(layer) === "custom"` guard. Used `groupOf()` rather
  than a raw `role` check because an imported layer can have `importMode:"imported"` with
  `role` undefined — `groupOf()` correctly buckets it as `shared`.
- **Finding 3 (medium → FIXED, `src/server/studyLayer.test.ts`):** the test titled
  "empty membership always shows" never created an empty-membership note. Renamed it to
  "filters the note list by OR over enabled layers" and added a dedicated test that clears
  membership (`layerIds: []`), disables every layer, and asserts the note still shows.
- **Finding 4 (medium → FIXED, `src/server/studyLayer.test.ts`):** no coverage for notes in
  3+ layers. Added a test placing a note in 4 layers and disabling them one-by-one,
  asserting visibility holds until the last is off and returns when any one is re-enabled.

No findings were rejected as false positives; no remaining issues.
