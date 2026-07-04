# Slash Composer — `/类型` 通用生成入口 (chat + toolbar)

One command-line-like entry: type `/` + a note type's 中文名或英文 id, then either chat with AI
to generate that type or hand-author it — in the chat composer AND on the action toolbars. The
point (user's insight): this **inverts "every type needs a button" into "one entry enumerates
every type"** — the type registry already exists, so every current and future plugin note type
gets a first-class entry for free. Grounded 2026-07.

## 0. The found irony
The chat composer's placeholder has said **"Type / for commands"** since R-era (`views.tsx:505`)
— but there is NO slash parsing anywhere in the client (grep-verified). This feature fulfills an
affordance the UI already promises.

## 1. Shipped substrate (all the hard parts exist)
- **Type registry** — core `NoteContentSpec {contentType, schema, createDefault(), toSearchText}`
  (`contentTypes.ts:11`): `createDefault()` is exactly the manual-mode seed. The CLIENT type
  registry (`getNoteType` — render/edit, adaptive-note contract) is where display metadata lives.
- **Generation path** — declared-contentType structured generation → `GeneratedDraft` →
  preview → save (`generation-preview.md`; `resolveForm` TRUSTS a declared form). AI mode is a
  thin dispatch over this.
- **Manual path** — `getNoteType(type).edit()` (the registry editor the composer + edit-in-place
  already share; lands in the D5 floating editor after N1).
- **Commands** — `runCommand` (registry.ts:626) with MEM-1 capture already hooked.
- **List gating** — marketplace *effective-installed* (M1/F4) is the palette's list source;
  until M1, `listNoteContentSpecs()` + active-kit filter.
- **Operations** — user-authored AI operations (`operation.run`) are palette entries too (SC-3).

## 2. Model
```ts
// CLIENT type registry gains additive display/meta (core NoteContentSpec stays pure):
registerNoteType({ ..., title?: string, aliases?: string[], icon? })   // e.g. quiz → "判断题", ["quiz","判断","小测"]
// Palette entries are DERIVED, never hardcoded:
SlashEntry = { kind: "noteType"|"operation", id, title, aliases, icon?, kitId? }
```
- **Resolution:** exact contentType → exact alias → prefix match (中文+英文) → fuzzy; pinyin
  matching = SC-3. Ranked by: active kit's types first (M-A synergy), then memory recency
  (MEM digests, later), then alpha.
- **Parse:** `/quiz 三道关于压强的选择题` → `{ type: "quiz", instruction: "三道…" }`;
  bare `/quiz` → manual mode; bare `/` → the full palette (filtered as you type).

## 3. Two modes, one flow (everything reuses existing contracts)
| Input | Mode | Flow |
|---|---|---|
| `/type + instruction` | **AI** | dispatch the existing generate family with DECLARED contentType + instruction (+ anchor context when invoked from a selection; unanchored on the active source from bare chat) → `GeneratedDraft` → the existing preview (chat preview today; D5 floating editor after N1) → Save |
| `/type` (bare) | **手敲** | `createDefault()` seeds `getNoteType(type).edit()` → Save via the same path |
| `/` | palette | list all effective-installed types + operations, filter-as-you-type, Enter/click picks |
**Universality claim (why "兼容所有 note 类型" is literally true):** the palette enumerates the
registries; the AI mode rides the adaptive-note contract's declared-form trust; the manual mode
rides the registry editor. A newly installed kit's types appear with zero palette code — this
also dissolves the "11 subject types would need 11 buttons" problem (M-B synergy).

## 4. Surfaces (one `<SlashPalette>` component, three mounts)
1. **AI chat composer** — parse on input; palette drops above the input (fulfills the
   placeholder). Instruction remainder = the chat message body.
2. **Selection floating toolbar** — `/` keyboard trigger or a palette button while a selection
   is live; result anchors to the selection (same materialization `runAction` does).
3. **Anchor bar / bottom bar** — same component, focused-anchor context.

## 5. Phasing (honest about contention)
- **SC-0 — engine + component (parallel-safe NOW, new files only):** parse/resolve/rank engine
  (pure, unit-tested) + `<SlashPalette>` component + additive `title/aliases` on the client type
  registry + Chinese aliases for the built-in types. No contended files.
- **SC-1 — chat wiring:** ✅ SHIPPED (2026-07-04, SC-1-001). Palette mounted in the AI-chat
  composer, AI/manual dispatch live, e2e green (`/` → pick type → generate → preview → save;
  bare `/quiz` → manual editor; both route only through `getNoteType().render/edit`). NOTE: the
  `views.tsx` wiring + `openManualEditor` actually landed with N1b (02c0476, "slash 集成保留");
  SC-1-001 completed the missing `.chat-slash-palette` positioning CSS (it was rendering inline
  and shoving the textarea) + the e2e.
- **SC-2 — toolbar surfaces:** selection toolbar + anchor/bottom bar mounts (+ anchor-context
  materialization).
- **SC-3 — breadth:** ✅ SHIPPED (SC-3-001, 2026-07-05). Operations in the palette (built-in kit
  actions + custom `op_` ops via `slash/operationAdapter.ts`; effective-installed gated), pinyin
  matching (full + initials, reusing SEARCH-2's `pinyinForms`), active-kit-first ranking
  (`rankByActiveKit`). Picked operations dispatch the shipped `operation.run`; the chat composer
  MOUNT is wired (SC-3.3 — `slashEntries({operations,disabled,foregroundKitIds})` +
  `pickSlashEntry` operation routing). Memory-recency ranking deferred (no cheap client signal —
  see 04-decision-log).

## 6. Tests
Engine unit (parse/resolve: 中文 alias, English id, prefix, ambiguity, bare vs instruction);
palette component (filter/keyboard nav, jsdom); e2e per surface (SC-1/2): `/判断题 …` → AI draft
→ save → renders via `getNoteType().render`; bare `/摘抄` → editor seeded with createDefault.
MEM capture: rides the existing command hook (ai.generate / note.create) — no new wiring.
