# Subject Kits — content-type catalog · 5 subject kits · Subject Auto-Switch engine

Status: design v1 (2026-07-02). DESIGN ONLY — no code in this pass, no core-schema change.

This doc **fills in** the D8 sketch in `docs/design/note-presentation-unified.md` §8 (the 11-type
table + subject-kit list) and treats each type/kit as a marketplace **CatalogEntry**
(`docs/design/plugin-viewer-model.md` §8). It cross-references but does **not** edit either. The
one genuinely new mechanism is **PART 3 — Subject Auto-Switch**, the document-level analog of the
note-level `ComposerTypePicker` "detected · change" chip (`src/client/workspace/ComposerTypePicker.tsx`).

Vocabulary: 公式卡 formula · 推导 derivation · 定理 theorem · 生词 vocab · 语法 grammar · 摘抄赏析
excerpt · 论证 argument · 时间线 timeline · 人物 figure · 因果链 cause-effect · 实验记录 experiment.

---

## 0. Substrate this builds on (read the code, not this summary)

- **A note type = two halves.** React-free `NoteContentSpec<T>` (`contentType` + zod `schema` +
  `createDefault()` + `toSearchText()`) in `src/core/notes/contentTypes.ts`, registered like
  `builtinNoteContentSpecs`; plus the React `NoteTypePlugin` (`render({mode})` + `edit({content,onChange})`
  + `label?`/`hidden?`/`focusable?`/`priority?`/`pluginId?`) in `src/client/notes/noteTypeRegistry.tsx`.
  The API validates content with `parseNoteContent` before storage. **Iron law:** a plugin never
  redefines the schema — it reaches it via `spec(contentType)`.
- **Card vs full = one render path.** `render({mode:"card"|"full"})` — card is the light PreviewCard
  body (`ArtifactCard.tsx`), full is the interactive Center View (`FocusOverlay.tsx`). The
  `FlashcardRender`/`QuizRender`/`DiagramCard` switch in `src/client/notes/builtinNoteTypes.tsx` is
  the exact D7 pattern every subject type below copies. No side-channel UI (guarded by
  `src/client/notes/contract.guard.test.ts`).
- **A kit = a `ProductKit`** (`src/kits/types.ts`) whose `install(ctx)` registers note types (spec +
  plugin), language (`KitLanguage`), commands, surfaces (`KitSurfaceItem`), prompts (`KitPrompt` =
  `build()` + `mockContent()` + `params`), via `createKitInstallContext` / `installClientKits`
  (`src/kits/clientContext.tsx`). The Textbook kit (`src/kits/textbook-learning/*`) is the worked example.
- **Marketplace.** Each type = `CatalogEntry(kind:"plugin")` with `provides:[contentType]`; each kit =
  `CatalogEntry(kind:"kit")` with `members:[pluginId…]`. Install state is per-vault
  `plugin-prefs.json.catalogState`; kit refcount is **derived from the members-union** (§8.5.2), nothing
  persisted. `providerOf(contentType)` powers import prompts (§8.7).
- **Icons.** `src/client/notes/noteTypeIcon.tsx` `ICONS` maps `contentType → LucideIcon`; add subject rows.
- **Card meta.** `src/client/notes/noteCardMeta.ts` derives a card title from `["title","label","name"]`
  + per-type fallbacks — see the honest note in §6 (vocab/grammar/excerpt/argument expose no `title`).

---

## PART 1 — the 11 subject content types

Every type below is: one `NoteContentSpec` (React-free, registered server+client) + one `NoteTypePlugin`
(render card/full + edit) + optionally one `KitPrompt`. `pluginId` is **required** for cataloged
registrations (§8.2). Card render obeys §10.3 (1–3 lines, no interaction). Required fields are marked
`(req)`; everything else optional. LaTeX types render through the shared `<Latex>` seam (PART 4).

### 1. 公式卡 `subject.formula` — plugin `subject-formula`  · icon `Sigma`
```ts
{ latex: string(req); name?: string;
  variables: { symbol: string(req); meaning: string(req); unit?: string }[](req, may be []);
  derivationRef?: string;   // note id of a subject.derivation
  usage?: string }
```
- **Purpose:** a named formula with its symbol legend, linkable to its derivation.
- **Card:** `<Latex inline>` of `latex` (1 line) + `name`; no legend.
- **Full:** `<Latex block>` · variable table (symbol · meaning · unit) · `usage` prose · `→ 打开推导`
  when `derivationRef` resolves to a note (opens its Center View). `focusable:true`.
- **Edit:** `latex` textarea with a live `<Latex>` preview · `name` · repeatable variable rows
  (symbol/meaning/unit) · `usage`.
- **AI prompt** (`outputType:"subject.formula"`): "Extract the passage's formula as LaTeX; list each
  variable with meaning + SI unit; one-line usage." `mockContent` = a schema-valid sample. `params`:
  `grade`, `subject`.
- **Kits:** 数学, 理化生 (shared — §8.5.2 refcount).

```
 card (mode:"card")                    full (mode:"full", FocusOverlay)
 ┌ Σ 公式卡 ─────────── ⋯ ┐          ┌ Σ 动能定理 ───────────────── ⤢ ✕ ┐
 │ 动能定理                │          │        E_k = ½ m v²   ← <Latex block>  │
 │  E_k = ½ m v²  ← <Latex>│          │ ── 变量 ──────────────────────────── │
 └────────────────────────┘          │  E_k  动能        J                    │
   title from `name`,                 │  m    质量        kg                   │
   1-line typeset LaTeX               │  v    速度        m·s⁻¹                 │
                                      │ 用法: 由功计算速度变化   → 打开推导     │
                                      └────────────────────────────────────────┘
```

### 2. 推导步骤 `subject.derivation` — plugin `subject-derivation`  · icon `ListOrdered`
```ts
{ title: string(req); goal?: string;
  steps: { expr: string(req) /*latex*/; rationale?: string }[](req);
  result?: string /*latex*/ }
```
- **Card:** `title` + goal + step count (`extra` via `noteCardMeta`).
- **Full:** numbered steps, each `<Latex>` line with a collapsible "why" (`rationale`); step-through
  (prev/next reveals one step at a time, component-local state); `result` boxed.
- **Edit:** `title` · `goal` · ordered step rows (expr textarea + rationale) · `result`.
- **AI prompt:** "Produce the step-by-step derivation reaching the goal; each step = one LaTeX expr +
  a short rationale."
- **Kits:** 数学.

### 3. 定理卡 `subject.theorem` — plugin `subject-theorem`  · icon `ScrollText`
```ts
{ name: string(req); statement: string(req); conditions?: string[];
  proof?: string; usage?: string; examples?: string[] }
```
- **Card:** `name` + first line of `statement`.
- **Full:** `statement` (LaTeX-aware) · `conditions` list · `proof` (collapsed by default) · `usage` ·
  `examples`. Mirrors the section stack of `MistakeRender`.
- **Edit:** name · statement · conditions (one-per-line) · proof textarea · usage · examples.
- **AI prompt:** "State the theorem, its preconditions, an optional proof sketch, and 1–2 worked uses."
- **Kits:** 数学.

### 4. 生词卡 `subject.vocab` — plugin `subject-vocab`  · icon `SpellCheck`
```ts
{ word: string(req); phonetic?: string; pos?: string;
  senses: { definition: string(req); example?: string }[](req);
  synonyms?: string[]; antonyms?: string[]; tags?: string[];
  srs?: { ease?: number; intervalDays?: number; due?: string /*ISO*/; reps?: number } }
```
- **Purpose:** a flashcard-shaped vocabulary card. **Front = `word` (+ phonetic/pos), Back = `senses`**
  — deliberately isomorphic to the built-in `flashcard` so D7's flashcard **flip + deck nav**
  (`FlashcardRender` full mode) is reused, not reinvented.
- **Card:** `word` + first `senses[0].definition` + the `点击翻开查看背面` hint (copy the flashcard card body).
- **Full:** flip card (front word ↔ back senses/examples), deck nav across sibling vocab notes on the
  same source (via the render `ctx` siblings seam D7 adds); `synonyms`/`antonyms` chips; `→ 转为 flashcard`.
- **Edit:** word · phonetic · pos · repeatable sense rows (definition + example) · synonyms/antonyms/tags.
- **`srs` box** is **reserved** — vocab cards can feed `textbook.review-pack.flashcards[]` and a future
  SRS scheduler; the scheduler itself is deferred (managed-ai / review-pack track). Field carried now so
  no migration later.
- **AI prompt:** "For the selected word give phonetic, POS, 1–3 senses each with an example sentence,
  plus synonyms/antonyms." `params`: `language` (target-language gloss).
- **Kits:** 英语 (shared conceptually with `flashcard`, which stays a separate built-in plugin).

### 5. 语法点 `subject.grammar` — plugin `subject-grammar`  · icon `Languages`
```ts
{ pattern: string(req); meaning: string(req); structure?: string;
  examples: { sentence: string(req); note?: string }[](req); pitfalls?: string[] }
```
- **Card:** `pattern` line.
- **Full:** pattern + meaning + `structure` (formula-like) + example rows (sentence + note) + `pitfalls`
  in warn styling (reuse the `tb-warn` treatment from `noteTypes.tsx`).
- **Edit:** pattern · meaning · structure · example rows · pitfalls.
- **AI prompt:** "Describe the grammar pattern: its meaning, structural template, 2–3 examples with
  notes, and common mistakes."
- **Kits:** 英语.

### 6. 摘抄赏析 `subject.excerpt` — plugin `subject-excerpt`  · icon `Quote`
```ts
{ quote: string(req); author?: string; work?: string;
  comment: string(req); devices?: string[] /*修辞手法*/; theme?: string }
```
- **Card:** `quote` (2 lines, blockquote styling).
- **Full:** quote block + attribution (`author`/`work`) + `comment` prose + `devices` chips (修辞手法) +
  `theme`. Manual-first type (trivial schema) — a good D5 floating-editor exemplar.
- **Edit:** quote textarea · author · work · comment · devices · theme.
- **AI prompt:** "Given the excerpt, identify rhetorical devices (修辞手法), theme, and write a short
  appreciation." `params`: `language`.
- **Kits:** 语文, 英语 (shared).

### 7. 论证结构 `subject.argument` — plugin `subject-argument`  · icon `Scale`
```ts
{ claim: string(req); grounds: string[](req); warrant?: string;
  evidence?: string[]; counter?: string[]; conclusion?: string }
```
- **Card:** `claim` line.
- **Full:** Toulmin-style indent tree — claim → grounds → warrant → evidence, then a `counter` block and
  `conclusion`.
- **Edit:** claim · grounds (one-per-line) · warrant · evidence · counter · conclusion.
- **AI prompt:** "Extract the argument: main claim, supporting grounds, the warrant linking them,
  evidence, counter-arguments, conclusion."
- **Kits:** 语文.

### 8. 时间线 `subject.timeline` — plugin `subject-timeline`  · icon `History`
```ts
{ title: string(req); events: { date: string(req); title: string(req);
  detail?: string; significance?: string }[](req) }
```
- **Purpose:** self-contained, visually distinct — a strong first exemplar (no new dep).
- **Card:** `title` + event count.
- **Full:** **vertical timeline** (ASCII sketch in PART 3-adjacent below); each node expandable to
  `detail` + `significance`. `focusable:true`.
- **Edit:** title · ordered event rows (date + title + detail + significance).
- **AI prompt:** "List the chronological events in the passage as {date, title, detail, significance}."
- **Kits:** 史地.

```
   ┌ 时间线 · 战国到统一 ─────────────────────────────┐
   │  ● 前356  商鞅变法        ▸ detail / significance │
   │  │                                               │
   │  ● 前256  周室亡          ▸ …                     │
   │  │                                               │
   │  ● 前221  秦统一六国      ▾ 结束分裂，中央集权确立 │
   │            (expanded: detail + significance)      │
   └──────────────────────────────────────────────────┘
```

### 9. 人物卡 `subject.figure` — plugin `subject-figure`  · icon `UserRound`
```ts
{ name: string(req); era?: string; role?: string; facts: string[](req);
  works?: string[]; significance?: string; relations?: { name: string; relation: string }[] }
```
- **Card:** `name` + `role`.
- **Full:** fact sheet — era/role header, `facts` list, `works`, `significance`, `relations` rows.
- **Edit:** name · era · role · facts · works · significance · relation rows.
- **AI prompt:** "Summarize the figure: era, role, key facts, works, significance, notable relations."
- **Kits:** 语文, 史地 (shared).

### 10. 因果链 `subject.cause-effect` — plugin `subject-cause-effect`  · icon `Waypoints`
```ts
{ title: string(req); event: string(req);
  causes: { factor: string(req); category?: string }[](req);
  effects: { outcome: string(req); term?: "短期" | "长期" }[](req) }
```
- **Card:** `event` + cause/effect counts.
- **Full:** **cause → event → effect** layout: causes column (grouped by `category`) → the pivot `event`
  → effects column (tagged 短期/长期).
- **Edit:** title · event · cause rows (factor + category) · effect rows (outcome + term).
- **AI prompt:** "For the central event, list contributing causes (with category) and resulting effects
  (short vs long term)."
- **Kits:** 史地.

### 11. 实验记录 `subject.experiment` — plugin `subject-experiment`  · icon `FlaskConical`
```ts
{ title: string(req); purpose: string(req); materials?: string[];
  procedure: string[](req); observations?: string[]; conclusion?: string; safety?: string[] }
```
- **Card:** `conclusion` or `purpose` line.
- **Full:** four sections (purpose · materials · numbered procedure · observations · conclusion) + a
  `safety` callout in warn styling — mirrors the mistake-card section pattern.
- **Edit:** title · purpose · materials · procedure (one-per-line) · observations · conclusion · safety.
- **AI prompt:** "Structure the experiment: purpose, materials, numbered procedure, expected
  observations, conclusion, safety notes."
- **Kits:** 理化生.

---

## PART 2 — the 5 subject kits (marketplace `CatalogEntry(kind:"kit")`)

> **Status: M-A ✅ · M-B ✅ · M-C ✅ (2026-07-05, M-C-001).** All 11 PART-1 types shipped;
> the 5 kits complete (语文/理化生 added as opt-in Textbook-Kit capability groups, `defaultEnabled:false`).
> §8.7 import prompts resolve every `subject.*` via the catalog `provides` index. FLAT-1: the market lists
> ONE Textbook Kit (no new sellable kit); a shared subject plugin belongs to exactly ONE (home) capability
> group so enabling a group never over-activates a sibling subject. Market *selling* of subject kits = M3.

Each kit `members` an array of plugin ids (the 11 above + existing built-ins). Existing types are
**referenced, not re-created**: `flashcard`/`quiz` (built-in plugins per §8.1), `textbook.mistake`
(the `mistake` plugin), and concept-map = the existing core **`markmap`** contentType (the `diagrams`
plugin — `DiagramNote`; no new plugin). `layout`/`language` are the kit's own config
(`ProductKit.install` — `ctx.language.register` / `ctx.layouts.register`).

| kit id (`CatalogEntry.id`) | name | `members` (pluginId) | language / layout |
|---|---|---|---|
| `subject-math` | 数学 Kit | `subject-formula`, `subject-derivation`, `subject-theorem`, `mistake`, `quiz` | source→"教材", LaTeX-first layout |
| `subject-english` | 英语 Kit | `subject-vocab`, `subject-grammar`, `subject-excerpt`, `flashcard` | anchor→"Word/Point", vocab-drill layout |
| `subject-chinese` | 语文 Kit | `subject-excerpt`, `subject-argument`, `subject-figure` | note→"赏析/结构" |
| `subject-history-geo` | 史地 Kit | `subject-timeline`, `subject-figure`, `subject-cause-effect` | timeline-forward layout |
| `subject-science` | 理化生 Kit | `subject-experiment`, `subject-formula`, `quiz`, `diagrams`(=concept-map/`markmap`) | LaTeX + diagram layout |

**Deliberate overlap → validates the shared-plugin refcount (§8.5.2).**
`subject-formula` ∈ {数学, 理化生}; `subject-excerpt` ∈ {语文, 英语}; `subject-figure` ∈ {语文, 史地};
`quiz` ∈ {数学, 理化生}; `flashcard` ↔ `subject-vocab` synergy. Because effective-installed is derived
from the **members-union** (`effectiveInstalled(p) ⇔ p ∈ directPluginIds ∨ ∃k∈installedKits: p∈members(k)`),
uninstalling 数学 while 理化生 stays installed leaves `subject-formula` installed — the uninstall
confirmation prints `公式卡 — kept (also in «理化生 Kit»)` (§8.5.2). No counter is stored; the union is
the refcount.

Each subject kit also carries a **`SubjectProfile`** (PART 3) — colocated with the kit definition so an
installed kit contributes both its plugins and its detection matchers.

---

## PART 3 — Subject Auto-Switch engine (the novel piece)

A **pure, per-source** resolver that reads a document's title/type/content and **foregrounds** the
relevant subject kit. It is the document-level analog of `classifyContent`
(`src/core/notes/classifyContent.ts` — pure, ordered, most-specific-first, never throws) and of the
note-level `ComposerTypePicker` "detected · change" chip. New module (not editing `classifyContent`):
`src/core/subject/detectSubject.ts` (React-free) + a thin client foreground publisher.

### 3.1 `SubjectProfile` shape (returned in the summary)
```ts
export type SubjectId = "math" | "english" | "chinese" | "history-geo" | "science";

export type SubjectMatchers = {
  titleKeywords: string[];          // case-insensitive substring, bilingual
  titlePatterns: RegExp[];          // word-boundary / anchored patterns
  sourceTypes?: SourceType[];       // from src/core/schema/source.ts sourceTypeSchema
  contentSignals?: {
    latexDensity?: number;          // min $…$ / \( hits per 1k chars to count
    langHint?: "en" | "zh" | "mixed";
    keywordDensity?: string[];      // body markers (element symbols, 之乎者也…)
  };
};

export type SubjectProfile = {
  subjectId: SubjectId;
  kitId: string;                    // the CatalogEntry(kind:"kit") id this subject maps to
  matchers: SubjectMatchers;
  weight: number;                   // score scaler + deterministic tie-break
};

export type SubjectResolution = {
  subjectId: SubjectId | null;
  source: "pin" | "detected" | "none";
  candidates: { subjectId: SubjectId; score: number }[];
};
```

### 3.2 Resolution + precedence
```
resolveSubject(source, catalogProfiles, isInstalled): SubjectResolution
  1. pin = source.metadata.subject
     if pin is a known SubjectId → { subjectId: pin, source: "pin", candidates: [] }   // user pin wins
  2. candidates = catalogProfiles
       .map(p => ({ subjectId: p.subjectId, kitId: p.kitId, score: scoreProfile(p, source) }))
       .filter(c => c.score > 0)
       .sort(by score DESC, then weight DESC, then kitId ASC)     // deterministic tie-break
  3. top = candidates[0]
     if top && top.score >= THRESHOLD → { subjectId: top.subjectId, source: "detected", candidates }
     else                             → { subjectId: null, source: "none", candidates }
```
**Precedence chain** (intentionally mirrors `plugin-viewer-model.md` §4 and `noteTypeRegistry` priority):
`user pin (per-source)  >  highest score ≥ THRESHOLD  >  none/general`. Score/weight/kitId is a total
order → no flapping. `scoreProfile` is small and explainable:

- title keyword or pattern hit → **+0.6** (strong; a title match alone clears THRESHOLD `0.35`).
- `sourceType` hint hit → **+0.1** (weak).
- `contentSignals`: `latexDensity` cleared → **+0.3**; `langHint` matched → **+0.3**;
  `keywordDensity` hit → **+0.2**. Clamp to `[0,1]`, then `× (weight normalized)` for tie-break nudge.

Scored over the **catalog** (bundled) profiles so an **uninstalled** kit can still win → suggestion
(3.5); only **installed** kits get foregrounded (3.4).

### 3.3 Detection signals (bilingual, simple, overridable)

| subject | titleKeywords (substr) | titlePatterns | sourceType hint | contentSignals |
|---|---|---|---|---|
| 数学 math | 数学, 代数, 几何, 微积分, 函数, 三角, Math, Algebra, Geometry, Calculus | `/\b(math|algebra|calculus|geometry)\b/i`, `/数学|代数|几何|微积分/` | pdf, markdown | `latexDensity≥3/1k` |
| 理化生 science | 物理, 化学, 生物, 实验, Physics, Chemistry, Biology | `/\b(physics|chemistry|biology)\b/i`, `/物理|化学|生物/` | pdf | `latexDensity≥2/1k`, `keywordDensity:[H₂O, NaCl, mol, 细胞…]` |
| 英语 english | 英语, 单词, 语法, 阅读, English, Vocabulary, Grammar, Reading | `/\benglish\b/i` | webpage, transcript, pdf | `langHint:"en"` (high English-word ratio) |
| 语文 chinese | 语文, 古文, 文言文, 诗词, 作文, 阅读, Chinese | `/语文|文言|诗词/` | pdf | `keywordDensity:[之, 乎, 者, 也, 兮, 曰]` (classical markers) |
| 史地 history-geo | 历史, 地理, 朝代, 年表, History, Geography | `/\b(history|geography)\b/i`, `/历史|地理/` | pdf, webpage | date density (`年`/`公元`/`BC`/`AD`) |

Note math and science **both** fire on `latexDensity` — the tie-break (title keywords → weight → kitId)
decides, exactly the kind of ambiguity the deterministic chain is for. Heuristics are intentionally
shallow: a keyword table + one regex list + three cheap content probes, all overridable by the pin.

### 3.4 Effect = **foreground, not filter**

The resolved kit's note types sort to the **top** of the composer type-picker and its toolbar actions
surface first; **every other installed type stays available**. Mechanically:

- **Composer picker:** reorder the `options: {contentType,label}[]` array handed to `ComposerTypePicker`
  (`src/client/workspace/ComposerTypePicker.tsx`) so the resolved kit's `contentTypes` lead. (This is
  ordering, not membership — nothing is removed.)
- **Toolbar / Action Registry:** `kitSurfaceItems(slot, kitIds?)` (`src/kits/clientContext.tsx`)
  already sorts by `priority` desc; add a **subject boost** as a *primary* sort key so the resolved
  kit's items lead within their band, read from a tiny publisher module (the `recentCategories.ts`
  pattern — a module-scope `getForegroundedKit()` the pure sort can read without threading ctx). The
  per-surface `operation-prefs` `order` (`operationViews.tsx`) still wins for user-pinned order.
- **Reader topbar chip:** `识别为 数学 · 更改` (3.6).

### 3.5 Uninstalled winner → soft suggestion (never auto-install)

If the top candidate's `kitId` is **not** effective-installed, foreground nothing; instead show a
one-tap install suggestion reusing the marketplace prompt machinery (`plugin-viewer-model.md` §8.7
import-prompt dialog / §8.5.5 install surfacing): *"这份文档看起来是 **数学** — 安装 数学 Kit？"* with
Install / 忽略. **Never auto-install** (locked, §8.9 "NO remote code download"; here it's just honesty
about install state). Declining costs nothing — the chip drops to `识别为 数学（未安装）` and types are
unaffected.

### 3.6 The topbar chip + dropdown (ASCII)
```
 reader topbar ─────────────────────────────────────────────
 │ 《战国史纲》.pdf            [识别为 史地 · 更改 ▾]   ⚙  │
 └──────────────────────────────────────────────────────────┘
                                         │ click 更改 ▾
                                         ▼
                     ┌─────────────────────────────┐
                     │ 识别为: 史地  (score 0.72)   │   ← detected, source:"detected"
                     │ ─────────────────────────── │
                     │ ○ 数学    ○ 英语             │   ← pin a different subject
                     │ ○ 语文    ● 史地  ○ 理化生   │
                     │ ─────────────────────────── │
                     │ ✓ 清除识别 (回到通用)        │   ← clear pin → source:"none"/redetect
                     └─────────────────────────────┘
```
Picking a subject writes the **pin**; `清除` removes it and falls back to redetection. This is the same
mental model as `ComposerTypePicker`'s `detected · change`, one level up (document, not note).

### 3.7 Storage decision (per-source pin)

**Decision: pin on `source.metadata.subject` (a `SubjectId` string, or absent).** It is merge-patched
via the existing generic endpoint:

- client: `entityClient.updateSourceMetadata(sourceId, { subject })`
  (`src/client/data/entityClient.ts` L332 → `PATCH /api/sources/:sourceId`).
- server: `app.patch("/api/sources/:sourceId")` (`src/server/app.ts` L382–400), which does
  `metadata: { ...existing.metadata, ...input.metadata }` and re-validates with `sourceSchema`.

**Justification (chosen over a workspace `sourceId→subjectId` map):**
1. **Precedent — identical seam.** Per-source Product Kit activation already stores
   `metadata.activeKitIds` here and is written the same way (`src/kits/activation.ts`
   `activeKitIdsForSource`; the PATCH handler comment literally says *"Used by per-source Product Kit
   activation"*). The subject pin is the automated sibling of manual kit activation — same home.
2. **Sanctioned escape hatch, zero core-schema change.** `recordEnvelopeSchema.metadata` is
   `z.record(z.string(), z.unknown()).default({})` with the comment *"Plugin escape hatch: every entity
   carries free-form metadata so future plugins extend via metadata instead of forcing core schema
   changes"* (`src/core/schema/common.ts`). No new endpoint, no `source.ts` edit (which this task must
   not touch anyway).
3. **Colocation + lifecycle.** The pin lives and dies with the source record; deleting the source drops
   it — a separate workspace map would need its own GC when sources are removed.

**Detection is recomputed cheaply on open; only the pin persists.** Hook: the `activeSourceId` effect
that already runs `loadSourceWorkspace(activeSourceId)` (`WorkspaceContext.tsx` L903–907) — resolve
`activeSource` (L562) → `resolveSubject(...)` → publish the foreground + chip. No detection is stored.

> **[M-A update, post-F4]** The dedicated `metadata.subject` key is **superseded** — see §7. Once F4
> demoted per-source activation from filter to foreground, the manual kit pick and the subject pin
> became the *same decision*, so the pin landed as the existing `metadata.activeKitIds` array itself
> (same endpoint, same merge-patch, justification 1 above taken to its conclusion). `null` clears the
> pin (non-array = "inherit" → redetect). No second per-source key, no competing precedence.

### 3.8 Integration + reuse map

| Hook | File / symbol |
|---|---|
| source open → detect | `WorkspaceContext.tsx` `activeSource` (L562), `loadSourceWorkspace` effect (L903–907) |
| pin write | `entityClient.updateSourceMetadata` (L332) → `app.patch("/api/sources/:sourceId")` (L382) |
| composer ordering | `ComposerTypePicker.tsx` `options` array |
| toolbar ordering | `kitSurfaceItems` (`clientContext.tsx` L79) + a `recentCategories.ts`-style foreground publisher |
| Action Registry user order still wins | `operationViews.tsx` `operation-prefs.surfaces[].order` |
| AI-generation bias (D6) | note-presentation-unified §D6 — a detected subject biases which type an anchor-context AI command defaults to |
| install suggestion | plugin-viewer-model §8.7 / §8.5.5 prompt machinery |
| shared-pack subject hint | plugin-viewer-model §8.7 — the `.svpack`/`.studypack` inspect step already computes a contentType set; a pack dominated by `subject.formula`/`subject.experiment` can pre-seed the detected subject |
| chip parallels | `ComposerTypePicker` `detected · change` chip (note-level → document-level) |

### 3.9 Honesty

Detection is **advisory and reversible.** A false positive costs nothing: every installed type stays in
the picker, the chip is one click to re-pin or clear, and the pin always overrides the guess. Mixed-
language and classical-Chinese detection are the weakest signals (3.10 risks) — so they are the lowest-
weighted and the easiest to override. The engine never hides a type and never installs anything.

---

## PART 4 — cross-cutting decisions

### 4.1 LaTeX rendering — the one new dependency
**Recommend KaTeX** (bundled, offline, synchronous, standard) for `subject.formula` / `subject.derivation`
/ `subject.theorem`. Render seam = **one shared `<Latex value inline?>` component** (e.g.
`src/client/notes/Latex.tsx`) that all three renderers call — the same "one shared implementation behind a
contract" discipline the diagram types use with `DiagramNote`.

- **Dependency cost, flagged plainly:** KaTeX is a **new UI dependency** (~fonts + JS). `package.json`
  today has NO `katex`; it DOES have `mermaid`, `markmap-lib`, `markmap-view` — heavy UI deps already
  accepted for diagrams, so KaTeX is consistent precedent, **not** a new kind of decision. This is a UI
  dep and is explicitly OUTSIDE the crypto **zero-dependency** rule (which governs `src/core/crypto`,
  untouched here).
- **Fallback if KaTeX is rejected:** render raw `$…$` in an inert `<code>` with a copy button (the
  `sv-code-copy` affordance already exists in `CodeRender`). Types still validate and display; only the
  typeset math is lost. This keeps the LaTeX types shippable even if the dep is deferred.

### 4.2 Contract compliance (reaffirmed)
All display flows through `getNoteType(contentType).render({mode})`; all editing through the registry
`edit()` seam; **content is data** (the schemas above), never bespoke DOM. No type gets a side-channel
view — `contract.guard.test.ts` keeps host code free of `contentType ===` branches. Card vs full is the
one `mode` switch, per `builtinNoteTypes.tsx`.

### 4.3 Reuse ledger
| Type(s) | Leans on |
|---|---|
| all | PreviewCard/`ArtifactCard` + `FocusOverlay` (§10), `noteCardMeta`, `noteTypeIcon.ICONS`, the D5 floating editor, the D6 AI generate→materialize loop |
| formula/derivation/theorem | shared `<Latex>` (KaTeX) |
| vocab | built-in `flashcard` flip + deck nav (D7); `review-pack.flashcards[]` |
| concept-map (理化生) | existing core `markmap` / `DiagramNote` (`diagrams` plugin) — no new code |
| grammar/experiment | `tb-warn` section styling from `noteTypes.tsx` |
| cause-effect | optional future markmap projection (chain → outline) — not required for v1 |

---

## PART 5 — phasing / build order

**Exemplars first (2–3), justified:**
1. **`subject.vocab`** (英语) — exercises the flashcard/SRS synergy for free (D7 flip + deck; feeds
   `review-pack.flashcards[]`); small schema; the generate prompt is the classic selection→structured case.
2. **`subject.formula`** (数学/理化生) — exercises the new `<Latex>` seam AND the D4a PDF region-anchor
   flow (capture a formula box → structured formula card); the Textbook kit already hints `anchor.formula`.
   Carries the KaTeX dep decision.
3. **(stretch) `subject.timeline`** (史地) — self-contained, visually distinct (vertical timeline), no new
   dependency; good manual-first + AI-fill demo.

**Milestones (each independently shippable, tied to marketplace M1–M3 and note-presentation N4):**

- **M-A — Auto-Switch engine, standalone.** `src/core/subject/detectSubject.ts` (`SubjectProfile`,
  `scoreProfile`, `resolveSubject`) + the foreground publisher + the `识别为 · 更改` chip + pin
  read/write via `updateSourceMetadata`. Lands **without any new types** (profiles can score toward the
  existing textbook kit as a stand-in). Tests: **unit** — scoring + tie-break determinism + precedence
  (pin > detected > none) beside `classifyContent.test.ts` style; **e2e** — open a `数学`-titled source →
  chip reads `识别为 数学`, pin `英语` → chip + `source.metadata.subject` persist across reload.
- **M-B — exemplar types + their kits as CatalogEntries.** `subject.vocab` + `subject.formula`
  (+`<Latex>`/KaTeX) + `subject.timeline`, each a plugin CatalogEntry; the three owning kits
  (英语/数学/史地) as kit CatalogEntries. Lands with **marketplace M1** (catalog + install state) so
  installing 英语 Kit lights up vocab in the composer/type registry. Tests: per-type **schema unit**
  (`parseNoteContent` round-trip) + **render unit** (card vs full) in the `noteTypeRegistry.test.tsx`
  style; **e2e** — a vocab note renders + flips; the detection chip foregrounds vocab in the picker.
- **M-C — the remaining 8 types + 语文/理化生 kits + import prompts (marketplace M3).** `providerOf`
  resolves `subject.*` on `.studypack`/`.svpack` import; the shared-pack subject hint (3.8). Ties to
  **note-presentation N4** (D7 interactive fulls land alongside).

**Risks (called out):**
- **KaTeX dep size** — mitigated: precedent (mermaid/markmap), lazy-load the LaTeX types, raw+copy
  fallback (4.1).
- **Detection false positives** — mitigated by "foreground not filter" + one-click re-pin; low weights on
  the shaky signals.
- **Classical-Chinese / mixed-language weakness** — the 语文/英语 content probes are the least reliable;
  keep them low-weight, lean on title keywords, always overridable.
- **Overlap-type catalog ownership** — a shared plugin (`subject-formula`, `subject-excerpt`, `quiz`) has
  ONE detail page (`plugin-viewer-model` §8.4.2) and appears under multiple kits' member lists; the kit
  pages link to the same plugin page (refcount, §8.5.2). Decide the plugin's "home" author = `growte`, not
  a specific kit.

---

## 6. Code reality that touches locked decisions (stated plainly)

1. **"Foreground, not filter" collides with the EXISTING per-source gate.** `src/kits/activation.ts`
   already gates *creation entry-points* by `metadata.activeKitIds`, and when unset it falls back to a
   **single** kit (`getDefaultKitId()` → `FALLBACK_DEFAULT_KIT = "textbook-learning"`). So today a source
   shows only ONE kit's create affordances (rendering stays global). For subject types to "stay available"
   and merely be reordered, the composer/toolbar must source their type list from the **marketplace
   effective-installed** set (§8.5.1), not from `activeKitIds`. **Recommendation:** the Auto-Switch engine
   does **not** write `activeKitIds` and does **not** gate — it only reorders the effective-installed set;
   as subject kits ship, the per-source hard gate should relax to "all installed" (or be superseded by
   marketplace install state). Until that relaxation, the foreground can only reorder what activation
   already admits. Flagged, not bent.
2. **`ComposerTypePicker` is not yet mounted in a live composer.** It exists with a unit test
   (`composerTypePicker.test.tsx`) but no view renders it, and there is no single site today that builds
   the composer's note-type `options` list. The "reorder the picker options" hook (3.4) therefore lands
   wherever that live composer is finally wired — it's a design target, not an existing call site.
3. **KaTeX is not a dependency.** `package.json` has `mermaid`/`markmap-*` but no `katex`; adding it is a
   real (if precedented) new UI dep — the single new-dependency decision in this doc.
4. **`noteCardMeta` won't auto-title 4 of the 11 types.** It derives a card title from
   `["title","label","name"]` + per-type fallbacks (`src/client/notes/noteCardMeta.ts`). `subject.formula`
   /`theorem`/`figure` expose `name`, and timeline/derivation/theorem/cause-effect/experiment expose
   `title`, so those are covered — but `subject.vocab` (`word`), `subject.grammar` (`pattern`),
   `subject.excerpt` (`quote`), `subject.argument` (`claim`) expose **no** title-ish key. Fix: add those
   keys to `noteCardMeta`'s fallback map (a small additive edit) OR have those card renderers supply their
   own heading. Minor, but real.
5. **`metadata` travels with the source; the subject pin is per-vault by intent.** The `.svpack`/`.studypack`
   share path summarizes contentTypes (§8.7) and MAY hint a subject, but the pin itself is not part of the
   shared layer payload — detection re-runs in the recipient vault. Consistent with "advisory + reversible."

---

## 7. M-A implementation note (landed 2026-07-02, post-F4 / post-M1)

M-A shipped **after** marketplace M1, so it builds on the F4 model directly: availability =
effective-installed (`src/kits/installState.ts`), per-source activation = **foreground ordering only**.
Auto-switch is therefore *literally* the activation resolver growing a detection layer — no new state
model, no publisher module needed (§3.4's `recentCategories.ts`-style publisher became unnecessary:
`kitSurfaceItems(slot, activeKitIds)` already takes the foreground set, and `activeKitIdsForSource` is
the one function that computes it for every caller).

**What adapted from the design above:**

| Design (§3.1–§3.7, pre-M1) | Landed (post-F4) |
|---|---|
| `SubjectProfile{subjectId, kitId, matchers, weight}` | `KitDetectionTable{kitId, titleKeywords, titlePatterns, sourceTypes?, contentSignals?, weight?}` — the kit id IS the subject handle; `subjectId` dropped (kit-centric since F4) |
| profiles bundled in core | **tables registered PER KIT** (the F7 lesson): React-free `ProductKit.detection` field, registered by `installServerKits` + `installClientKits` — the KitLayerPolicy precedent. Core owns only the scorer. |
| pin = `metadata.subject` (SubjectId) | pin = the existing `metadata.activeKitIds` array (see the §3.7 update note); clear = `activeKitIds: null` via the same merge-patch |
| `resolveSubject` beside the scorer | split: **engine** `src/core/subject/detectSubject.ts` (pure `scoreKitDetection`/`detectKit`, threshold 0.35, order = score↓ weight↓ kitId↑, explainable `{kitId, confidence, signals[]}`) + **resolver** `resolveForegroundKits` in `src/kits/activation.ts` (pin > detected∧installed > workspace default) |
| §3.2 "× weight normalized" | weight is a **pure tie-breaker**, never multiplied into the score — keeps `signals[].points` summing to `confidence` (explainability wins) |
| chip mounted in the reader topbar | component + host delivered (`src/client/workspace/KitForegroundChip.tsx`, jsdom-tested); **mount reader-gated**, below |

Seeded table: only `textbook-learning` (`src/kits/textbook-learning/detection.ts`), per PART 5 — M-B
adds the five subject kits' tables (§3.3) the same way (one `detection` field per kit). An uninstalled
winner still foregrounds nothing (§3.5's suggestion UI stays future; the engine's `candidates` carry
what it needs). Server + client register identical tables, so the stage-axis seeding
(`services/layers.ts` → `activeKitIdsForSource`) and the client foreground agree.

**The gated one-line mount (SC-1 pattern — `views.tsx` is reader-session-contended).** When the reader
batch opens, drop this into `SourceViewerView`'s `.reader-toolbar` (beside `<BookmarkIndex/>`), adding
`loadSources` to the existing ctx destructure:

```tsx
<KitForegroundChipHost ctx={{ activeSource, installedKits, setActiveKit, loadSources }} />
```

`KitForegroundChipHost` binds the chip to the existing seams: manual pick → `setActiveKit` (the same
`metadata.activeKitIds` write the Product Kit `<select>` uses — that select can then be retired from
the ⋯ menu), 自动 → `activeKitIds: null` PATCH + `loadSources()`. Styles are already in
`styles.css` (`.kit-foreground-chip`). Until the mount lands, the auto-switch itself is **already
live** everywhere `activeKitIdsForSource` is consumed (toolbar foregrounding, stage seeding) — the
chip only adds the visibility + pin affordance.

**Files:** `src/core/subject/detectSubject.ts`(+test) · `src/kits/textbook-learning/detection.ts`(+test)
· `src/kits/activation.ts`(+tests) · `src/kits/types.ts`/`index.ts`/`server.ts`/`clientContext.tsx`
(registration seam) · `src/client/workspace/KitForegroundChip.tsx`(+jsdom test) ·
`src/server/subjectAutoSwitch.test.ts` (pin persistence roundtrip over the real API) · `styles.css`.

---

## 8. M-B implementation note (landed 2026-07-02) — §KaTeX decision + the exemplar slice

### 8.1 KaTeX decision — ADOPTED (the ⚠️ research hole, resolved empirically)

Verified against the live registry + this repo's toolchain on 2026-07-02, not from memory:

| Check | Result |
|---|---|
| Installable now | `katex@0.17.0`, MIT, unpacked 4.02 MB / 213 files (fonts 1.2 MB · katex.min.js 268 KB · katex.min.css 24 KB); ships own TS types (`types/katex.d.ts`), ESM+CJS; sole runtime dep `commander` (CLI only, tree-shaken out of browser bundles) |
| jsdom (the render-contract gate) | `renderToString` AND `katex.render(el)` both work under the repo's vitest jsdom env — `.katex`/`.katex-display` queryable; `import "katex/dist/katex.min.css"` is inert under vitest. `getNoteType().render` stays fully testable (subject/noteTypes.test.tsx asserts `.katex` in the real render path) |
| Vite bundling | scratch `vite build` importing katex + katex.min.css: relative `url(fonts/…)` resolved, fonts emitted as hashed assets, CSS bundled — **77.6 KB gzip JS + 7.9 KB gzip CSS**; fonts fetched on demand by the browser |
| SSR / no-window | `renderToString` is a pure string renderer — runs in plain Node with `typeof window === "undefined"` |
| Failure posture | `throwOnError:false` → bad TeX degrades to an inert `.katex-error` span (never throws); `trust:false` → `\href{javascript:…}` emits no live URL; CJK passes through `\text{…}` |

**Landed:** the dep + the PART 4.1 seam — `src/client/notes/Latex.tsx` (`renderMath` helper +
`<Latex value inline?>`; hard-wired `trust:false, throwOnError:false`, escaped-`<code>`
fallback for non-parse throws). Used ONLY by the math types' render/edit; no other module
imports katex. The PART 4.1 raw+copy fallback stays documented but was NOT needed.

### 8.2 What shipped in the M-B slice

- **Types (PART 5 exemplars, schemas verbatim):** `subject.vocab` · `subject.formula` ·
  `subject.timeline` — core specs `src/kits/subject/contentTypes.ts`, plugins
  `src/kits/subject/noteTypes.tsx` (card/full through the one render path; 中文 title+aliases+icon;
  formula/timeline `focusable:true` — the flag now threads through `KitNoteTypePlugin`).
- **Kits (PART 2 rows, M-B slice):** `subject-english` {subject-vocab, flashcard} ·
  `subject-math` {subject-formula, mistake, quiz} · `subject-history-geo` {subject-timeline} —
  post-F5 members (existing plugins referenced in catalog `members[]`, never re-installed),
  kit-level language config only, one §3.3 detection table each, per-type KitPrompts
  (`subject.generate-vocab/-formula/-timeline`) + selection-toolbar commands. M-C appends the
  remaining 8 types + 语文/理化生.
- **First install-to-activate market goods:** all six CatalogEntries ship `defaultInstalled:false`
  — listed in the 市场 tab via `CatalogSource("local")` automatically; installing 英语 Kit lights
  生词卡 up in the slash palette (PART 5's M-B acceptance, jsdom-asserted). Consequence for M-A:
  a 数学教材-titled source now ties textbook↔subject-math at 0.6 and the kitId-ASC leg names
  `subject-math` — uninstalled ⇒ §3.5 foregrounds nothing (default holds; the engine's
  `candidates` keep the winner for the future suggestion UI). Covered in
  `subjectAutoSwitch.test.ts`.
- **§6.4 debt cleared:** `noteCardMeta` title fallbacks for vocab(`word`) / grammar(`pattern`) /
  excerpt(`quote`) / argument(`claim`) (the M-C types' fallbacks are pre-landed for imported
  notes) + the §1.8 event-count `extra` for timeline.
- **Deferred to the reader-gated batch:** `noteTypeIcon.ICONS` subject rows — the parity test
  pairs ICONS with `annotationLayer.ts`'s `MARKER_GLYPHS`, a reader-session-contended file.
  Until then subject types show the plugin `icon` string in palettes and the generic glyph in
  the linked-notes row/markers.
