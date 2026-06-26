# Generation Preview — generate → preview → edit → save

A staging seam between a kit AI action and note persistence. Before this slice an
AI action **generated and saved in one step**: click "Explain" and a Study Block
note appeared in the list, already committed. This adds a **preview stage** —
generate, render, optionally edit, then Save / Regenerate / Discard — so nothing
is persisted until the user accepts it. It is additive and register-respecting:
no `src/ai` change, no server change, no new core entity.

## The problem: AI actions auto-saved

The textbook kit commands (`explain-concept` / `generate-practice` /
`mark-as-mistake` / `generate-review-pack`, `src/kits/textbook-learning/commands.ts`)
each did `materializeAnchor()` → `generateStructured(...)` → **`createNote(...)`**
in a single `run`. The generated content went straight into `notes.jsonl` and the
note list, with no chance to inspect or fix it. A misfired prompt, an off-grade
explanation, or an unwanted card was a saved note to delete after the fact.

The model output is also non-deterministic for a real provider, so "review before
commit" is the natural shape — the same shape every other AI-assist surface
(Claude Artifacts, Copilot suggestions) uses. The base already had all the pieces
(a NoteType registry that can `render()`/`edit()` any content type, an
`anchor.add-note` command that persists) — they just needed decoupling.

## The design: decouple generate from save

The keystone is a new command action, **`onGenerated`**, that diverts an AI
action's output into a **pending draft** instead of saving it. The draft is parked
in `WorkspaceContext`, rendered by a dedicated `GenerationPreview` view, and only
crosses into a real note when the user clicks **Save**.

```
kit command.run                WorkspaceContext               GenerationPreview
──────────────────             ────────────────               ─────────────────
materializeAnchor()
generateStructured(...)
  │
  ├─ onGenerated wired? ──yes──► setPendingDraft(draft) ──────► render(draft.content)
  │                                                              [Edit] → edit(...)
  │                                                              [Save] ─┐
  │                                                              [Regenerate]
  │                                                              [Discard]
  └─ no (legacy) ──► createNote(...)  (auto-save fallback)               │
                                       savePendingDraft(content) ◄───────┘
                                         │
                                         └─► dispatch("anchor.add-note",
                                               { content, contentType,
                                                 anchorIds: [draft.anchorId] })
```

### The `GeneratedDraft` and `onGenerated`

A `GeneratedDraft` (`src/client/commands/registry.ts`) is a unit of AI output
**before** it is persisted — everything Save and Regenerate need, and nothing
more:

```ts
export type GeneratedDraft = {
  promptId: string;                  // for Regenerate (re-run the same generation)
  contentType: string;               // which NoteType plugin renders/edits it
  input: Record<string, unknown>;    // for Regenerate (same input)
  content: unknown;                  // the generated content
  anchorId?: string;                 // where Save attaches (undefined = unanchored)
  sourceId?: string;
};
```

`CommandActions` gains an optional `onGenerated(draft)`. The textbook commands now
emit through it **when the host wired it**, and only then. The shared
`generateBlock` body and the source-level review-pack command both gained the same
two-line branch: build the `input`, generate, then

```ts
if (ctx.actions.onGenerated) {
  ctx.actions.onGenerated({ promptId, contentType, input, content, anchorId, sourceId });
  return;
}
// legacy auto-save fallback (no preview host wired)
```

The anchor the command already materialized is carried on the draft, so Save can
attach there without re-materializing (see below). Anchor-scoped commands pass
`anchorId: anchor?.id`; the source-level Review Pack passes `anchorId: undefined`
(it saves unanchored on the source).

### The preview reuses the note registry's `render()`/`edit()`

`GenerationPreview` (`src/client/workspace/GenerationPreview.tsx`) holds no
type-specific code. It looks up the client NoteType plugin for
`draft.contentType` via `getNoteType(...)` — **the same plugin a saved note of
that type uses** — and shows `plugin.render({ content })`, or
`plugin.edit({ content, onChange })` when the Edit toggle is on. A saved note and
its draft therefore look identical, and any kit content type gets a working
preview for free, with zero preview-side changes. The Edit working copy is seeded
from the draft and **re-seeded whenever the draft identity changes**, so a stale
edit can't leak across a fresh generation or a regenerate.

It is a **separate DOM subtree** from `.note-list`, mounted in the study panel
(`views.tsx`) above the chat log. A draft can preview here while **no** note yet
exists in the list — Save is what moves it across — which is exactly what the e2e
asserts (`savedCards` count stays 0 while the preview is visible).

### Save reuses `anchor.add-note` with a pre-materialized anchor

Save does **not** add a new persistence path. `savePendingDraft(content)`
dispatches the existing `anchor.add-note` command with the edited content and the
draft's anchor passed as an explicit `anchorIds`:

```ts
dispatch("anchor.add-note", {
  content,
  contentType: draft.contentType,
  anchorIds: draft.anchorId ? [draft.anchorId] : []
});
```

`anchor.add-note` gained one branch to honor this: when `payload.anchorIds` is
present (**even as `[]`**) it uses those ids and **skips** focus materialization;
otherwise it keeps the legacy "materialize from the current selection" path. This
matters because the generating command already created the anchor — without the
override, Save would materialize a *second* anchor from whatever the focus happens
to be. A present-but-empty array (`[]`) is the source-level case (Review Pack):
save unanchored, do not fall back to focus. The draft is cleared **before** the
async dispatch so a rapid double-click on Save sees a null draft and early-returns
rather than firing two `add-note` dispatches.

### Regenerate / Discard

- **Regenerate** (`regeneratePendingDraft`) re-runs the *same*
  `generateStructured({ promptId, contentType, input })` from the draft and swaps
  the new content into the pending draft in place (a fresh draft identity, so the
  Edit copy re-seeds). A `regenerating` flag disables the action buttons while
  it's in flight. The mock provider is deterministic, so a regenerate may yield
  identical content — the UX must not depend on the content changing (the e2e only
  asserts it stays pending and nothing new is saved).
- **Discard** (`discardPendingDraft`) drops the pending draft (`setPendingDraft(null)`).
  Nothing was persisted, so there is nothing to undo.

## States

| State | `pendingDraft` | `regenerating` | What renders |
| --- | --- | --- | --- |
| Idle | `null` | `false` | `GenerationPreview` returns `null` (seam invisible) |
| Previewing | draft | `false` | `plugin.render(content)` + Save / Edit / Regenerate / Discard |
| Editing | draft | `false` | `plugin.edit(content, onChange)` (Edit toggled), working copy local |
| Regenerating | draft | `true` | render of the old content; buttons disabled; "Regenerating…" |
| Saved | `null` (cleared first) | `false` | preview gone; the note now lives in `.note-list` |
| Discarded | `null` | `false` | preview gone; note list unchanged |

## Backward-compat fallback

The whole feature is gated on the host wiring `onGenerated`. The textbook commands
keep their **legacy auto-save path** verbatim for any host that doesn't:
`if (ctx.actions.onGenerated) { … return; }` then the original
`createNote(...)` + `onNoteCreated`. Tests that drive a command without a preview
host still see a note created (covered in `commands.test.ts`). Likewise
`anchor.add-note` without `payload.anchorIds` is byte-for-byte its old self
(materialize-from-focus), so every non-preview caller is unchanged.

## What was deliberately NOT changed

- **`src/ai/*`** — untouched. The preview is a client-side staging step over the
  *existing* `generateStructured` result; the engine, provider boundary, and the
  iron rule ("`src/ai` never imports a kit", `docs/design/ai-orchestration.md`)
  are unaffected.
- **The server** — untouched. No new route, no schema change. Save still goes
  through `POST /api/notes` via `anchor.add-note`; Regenerate still hits the
  existing `POST /api/kits/generate`. The draft lives only in client memory until
  Save.
- **The NoteType registry / content specs** — unchanged. The preview *consumes*
  the same plugins; it adds none.
- **No new core entity** — a draft is transient `WorkspaceContext` state, not a
  persisted record. Nothing reaches `notes.jsonl` until Save.

This keeps the slice additive: with no kit installed, or a host that doesn't wire
`onGenerated`, the app behaves exactly as before.

## Files

- `src/client/commands/registry.ts` — `GeneratedDraft` type; `CommandActions.onGenerated`;
  `anchor.add-note` honors explicit `payload.anchorIds` (skips materialize).
- `src/client/workspace/WorkspaceContext.tsx` — `pendingDraft`/`regenerating` state;
  `onGenerated` action wires `setPendingDraft`; `savePendingDraft` /
  `regeneratePendingDraft` / `discardPendingDraft`.
- `src/client/workspace/GenerationPreview.tsx` — the preview view (render/edit via
  the NoteType plugin; Save/Edit/Regenerate/Discard; JSON fallback for unknown types).
- `src/client/workspace/views.tsx` — mounts `<GenerationPreview />` in the study panel.
- `src/kits/textbook-learning/commands.ts` — `generateBlock` + review-pack emit via
  `onGenerated` when wired (legacy auto-save fallback kept).
- `src/client/styles.css` — `.generation-preview*` styles.
- Tests: `src/client/commands/registry.test.ts`,
  `src/kits/textbook-learning/commands.test.ts`, `e2e/generation-preview.spec.ts`.

## Cross-reference

`docs/design/ai-operation-as-data.md` (the data-defined-operation proposal) reuses
this loop verbatim: a custom `operation.run` emits the identical `GeneratedDraft`,
so preview/edit/regenerate/save work for stored operations with **zero**
preview-side changes.
