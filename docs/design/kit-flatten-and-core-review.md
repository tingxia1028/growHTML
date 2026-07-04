# Kit Flatten + Core Review — V1 最小交付集的骨架收敛

User decisions (2026-07-04): ① the raw shell = import/read/anchor + THREE primitive tools
(写文字 / 链接文件 / 问AI存note) NOT as plugins; ② Textbook Kit = the one vertical, including
学科 note tools + 拼音 + TTS 朗读 + 语音输入 + 笔记导入导出; ③ the plugin/kit two-level
taxonomy is too messy → **user-facing there is ONLY the kit**; ④ review moves into core and
**must be generic first** — today it imports textbook-learning types directly.

## 1. REV-CORE — 复习通用化 + 沉核心

**Status: ✅ shipped (REV-CORE-001, 2026-07-04)** — capabilities + alias landed in
`src/core/notes/contentTypes.ts`; prompts/grade type/panel register from core;
`src/kits/review/` deleted; queue/panel read the registry.

**Coupling evidence (all to be severed):**
- `src/client/review/queue.ts:23` imports `mistakeSpec, reviewPackSpec` from
  `kits/textbook-learning/contentTypes`; `REVIEWABLE_CONTENT_TYPES` is a hardcoded list.
- `src/client/review/ReviewPanel.tsx:34` imports `mistakeSpec` (saving 错题 writes
  `textbook.mistake`).
- `src/kits/review/*` is a PLUGIN contributing what is actually the mission loop
  (kernel: 把理解外化成可检验的卡片…带复习 — the loop is core, not uninstallable).

**Design — a reviewable contract on the content-type registry** (the same move as the
adaptive-note contract: capability declared per spec, engine reads the registry, core never
imports kit files):

```ts
// src/core/notes/contentTypes.ts — extend NoteContentSpec
review?: {
  reviewable: true;                       // queue rule-2 eligibility (replaces the list)
  expectedAnswer?(content: T): string | null;  // gradable types expose the expected answer
}
mistake?: true;                           // marks a spec as 错题-material (queue rule-1)
```

- **Queue**: rule 2 selects any spec declaring `review.reviewable` (quiz/flashcard declare it
  in core built-ins; review-pack declares it in ITS OWN spec — kit extends by declaring).
  Rule 1 (错题优先) keys on the `mistake` capability, not a contentType string.
- **错题 type goes core**: new core built-in `mistake` spec (structure = today's
  textbook.mistake). Zero data migration: the registry gains an **alias map** so contentType
  `"textbook.mistake"` resolves to the same spec; existing vault records keep rendering,
  new saves write `"mistake"`. (Alias resolution lives in `getNoteContentSpec`.)
- **Check/grade/explain prompts move core**: `src/kits/review/prompts/*` →
  `src/core/review/prompts/` (or src/ai), registered at core seed time exactly like built-in
  note types. The quiz-shaped check flow in ReviewPanel is NOT a coupling to fix — quiz IS
  the core "可检验卡片" primitive per the mission sentence; it stays.
- **The review plugin dissolves**: panel + operations + memory events register from core;
  `src/kits/review/` deleted; manager no longer lists it. profileContext/server gate
  (REV-2) unchanged — already core-side.

## 2. FLAT — 只有 kit,plugin 降为 kit 内部结构

> **Status: ✅ shipped (FLAT-1-001, 2026-07-04)** — kit-granular installState + per-kit
> disabledGroups, lossless idempotent write-back migration (structural detection, no version
> field), subject kits → Textbook Kit capability groups (8 groups; plugin ids preserved as
> runtime registration vehicles; legacy pins/detection resolve via isKitInstalled alias),
> kit-only catalog source + single-screen 套件管理 (kit cards + group toggles + uninstall +
> ViewerConflicts; kitManager.css). Standalone plugins (flashcard/quiz/bookmark/diagrams/
> table-viewer) demoted to hidden always-on infrastructure.

**Model:** one user-facing install/uninstall unit = **kit** = a manifest of contributions
(note types, operations, panels, triggers), organized into named **capability groups**
(能力组) that can be toggled individually inside an installed kit (e.g. turn off 拼音 within
Textbook Kit). The old "member plugin" becomes a capability group — no longer independently
installable, no longer listed anywhere.

- `installState.ts`: derivation moves from plugin-granular to kit-granular with a
  `disabledGroups: string[]` per installed kit. Migration: existing installed member-plugin
  records collapse into their owning kit (any previously uninstalled member → that group
  starts disabled). Effective-installed = installed kits' enabled groups' contributions.
  Active kit stays FOREGROUND ORDERING, never a filter (unchanged law).
- `seedBuiltinPlugins` → `seedBuiltinKits`; textbook's 5 member plugins re-declare as 5
  capability groups of ONE Textbook Kit; subject kits (english/math/history-geo) merge INTO
  Textbook Kit as per-subject groups (they were separate kits only because of the old model).
  Review plugin: removed (core, §1).
- Marketplace: `CatalogListing.kind` collapses to `"kit"` in practice (enum kept for wire
  compat; local CatalogSource lists kits only). Manager UI = ONE screen: installed kits,
  expand → capability-group toggles; 市场 tab unchanged otherwise.

## 3. SHELL-PRIM — 壳的三个原始工具(非插件,但走同一注册表)

"Not a plugin" means: registered by CORE at seed time, not uninstallable, not in the market —
NOT a bypass of the registries (adaptive-note contract stays mandatory, no second render path).
- 写文字 = built-in markdown note ✅ exists.
- 问AI存note = selection toolbar AI operations → generation preview → save ✅ exists.
- **链接文件 = NEW core built-in `file-link` note type** ✅ (SHELL-PRIM-001): `{ path, title?, note? }`,
  card renders title (fallback: path basename) + dimmed path + 打开 action (shell.openPath via a
  new `shell:openPath` IPC on the electron bridge; web mode = 复制路径 clipboard copy). Visible in
  the slash palette (`/链接` + zh/en aliases) and the composer declared form (path + 选择文件… via
  the existing dialog:openFile IPC + title + note).
- 复习队列 + 画像 = core per §1. 备份/导出 (TRUST) + 安装包 (X1) complete the shell.

## 4. Textbook Kit V1 composition (after flatten)

Capability groups: 学科类型 (per-subject: english/math/history-geo + base textbook types) ·
AI 操作 (讲解/出题/批改) · **语音 (SPEECH group)**: **拼音标注 ✅ shipped (SPEECH-3-001,
2026-07-04)** (pinyin-pro, pure JS — shipped as a CORE text capability like 朗读:
`src/client/speech/pinyin.ts` engine + centered `PinyinPopover` ruby dialog + 拼 button on the
GlobalSpeakSelection chip and the reader SelectionFloatingToolbar, CJK-gated; FLAT can later
group its VISIBILITY under this kit's speech group without moving code) + **TTS 朗读
✅ shipped (SPEECH-1-001, 2026-07-04)** (edge-tts lane via `msedge-tts`, keyless, server-side —
`src/server/services/speech.ts` + `POST /api/speech/tts` / `GET /api/speech/status`, shared
`SpeakButton` on the selection toolbar / Anchor bar / note-list rows — roundtable tts.py
reference) + **语音输入 STT ✅ shipped (SPEECH-2-001, 2026-07-04)** (LOCAL lane: the
faster-whisper sidecar `scripts/stt-sidecar/` — roundtable stt.py adapted, 127.0.0.1:8765,
zero-cost offline recognition — behind the same lane-seamed `SpeechService`
(`transcribe()` + real cached /health probe in `GET /api/speech/status`) +
`POST /api/speech/stt`; client `useVoiceInput` + `VoiceInputButton` (transcript-CONFIRM
popover before insert) on the chat/slash composer; 点亮 when detected, in-place 3-step
setup guide panel when not; sherpa-onnx embedded Node engine = V1.1) ·
导入导出入口 (svpack, already core — the kit only surfaces entry points).

## 5. Phasing (V1 minimal set order)

F3 D1-adapter (in flight) → **REV-CORE** (§1) → **FLAT-1** (§2 model+migration+manager UI) →
**SHELL-PRIM** (§3 file-link) → **SPEECH batch** (§4 拼音/TTS/STT-lane) → X1 packaging +
TRUST-1/2 → alpha. REV-CORE before FLAT so the flatten never has to model the review plugin.
None of these touch reader files (no F3 collision). roadmap.md re-sort rides the first commit
after F3 lands (F3's agent owns roadmap edits right now).

## 6. Tests

Registry: reviewable/mistake capability declaration + alias resolution (textbook.mistake →
mistake spec). Queue: eligibility from registry (a fixture kit type declaring reviewable
enters rule 2 with zero queue-code changes); rule-1 keys on capability. ReviewPanel: existing
suite green with imports moved; 错题 save writes `mistake`. Flatten: installState migration
(old member-plugin records → kit + disabledGroups), effective-installed parity before/after,
group toggle excludes contributions, manager UI screen. file-link: spec/render/open action.
Speech: pinyin pure-fn; TTS lane behind provider seam (mock in tests); STT lane detection
(fixture sidecar). Full suite + tsc + build green per batch.
