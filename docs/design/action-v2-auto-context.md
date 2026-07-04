# Action V2 — 自动上下文 + 一句话新增 (redesign of AI-Operation-as-Data V1)

> **Status: §1 + §2 (ACTION-2a engine) ✅ shipped 2026-07-04 (ACTION-2A-001)** — composeAutoContext
> + generalized profileContext gate + simple mode + form-router auto output live server-side;
> §3 UI (ACTION-2b) pending, rides FLAT-1/SHELL-4/I18N post-contention.

User decision (2026-07-04): "本质上可以通过文档的基本信息和用户的基本画像,得到已有的 kit 里
tool 的上下文,自己填充;可以新增 action,但设计的 UI 交互要简单,现在很复杂。"

**Verdict on V1** (`ai-operation-as-data.md`, shipped): the data model (Operation entity,
template engine, preview loop, ordering prefs) is RIGHT and stays. What's wrong is the
AUTHORING surface: variables-as-content-blocks, outputType picker, declared-variables
advanced section — the user is made to hand-wire context the SYSTEM already knows.

## 1. The auto-context envelope (ACTION-2a, engine — the real change)

Every operation execution gets a **standard context envelope composed automatically,
server-side** — the user never declares or wires these:

```
autoContext = {
  selection:  quote + anchor locator (what the user selected / focused)
  doc:        title · sourceType · detected subject + foreground kit (detectSubject
              signals already exist) · folder/collection name
  learner:    the generalized profileContext — grade band, weak buckets, active hours,
              hidden-facts honored, MEM-2 digests → same server-side gate as review ops
              (managed kind hard-strips; this GENERALIZES the REV-2 gate = absorbs MEM-3's
              "generalized profileContext into all kit prompts" roadmap item)
}
```

- Composition lives beside `generateStructuredContent` (`src/kits/structured.ts` seam →
  server services/ai.ts): one `composeAutoContext(input)` used by BOTH built-in kit prompts
  (they can drop hand-threaded params over time) and data operations. Token-capped (~1.5k
  chars), sections omitted when empty. profileContext reuses the REV-2 gating path verbatim.
- Templates may still reference pieces explicitly (`{{doc.title}}`, `{{selection}}`) — the
  alias namespace maps into the envelope. If a template references nothing, the envelope is
  PREPENDED as a context preamble; the model sees context either way.

## 2. 一句话新增 (simple mode on the same entity)

`Operation` gains `mode: "simple" | "template"` (V1 records = "template", untouched):
- **simple**: stores `{ name, instruction }` — e.g. 名字 "苏格拉底提问", 指令
  "用苏格拉底式追问考我选中的内容,一次只问一个问题". The engine compiles at run time:
  autoContext preamble + instruction + output-form directive.
- **Output type is AUTO by default**: the adaptive-note contract's `resolveForm` →
  contentType already decides how generated content materializes — simple actions rely on
  it (no picker). 高级 disclosure lets you pin an explicit outputType / edit as a full
  template (converts mode to "template", one-way with confirm).
- 试一下 keeps riding the existing generation-preview loop unchanged.

## 3. UI simplification (ACTION-2b — rides the FLAT-1 manager rebuild in the modal shell)

- Manager list: one row per action = 图标 · 名字 · 启停 toggle · drag order · 编辑. No
  builder chrome on the list screen.
- 新增 = ONE small form: 名字 + 一句话指令 (+ 高级 folded away). Two fields for the
  90% case.
- Built-in kit tools show the SAME row UI; 编辑 on a built-in = the existing
  复制为我的插件 fork path, presented as "自定义此动作".
- This screen is rebuilt inside ModalViewHost, bilingual from day one (SHELL-4/I18N),
  and lands AFTER the parallel session releases `operationViews.tsx` (contended today).

## 4. Phasing
- **ACTION-2a** (engine, clean files): composeAutoContext + gate generalization + simple
  mode compile + schema/entity field + server tests. No UI beyond making 试一下 work for a
  hand-seeded simple action.
- **ACTION-2b** (UI): the simple manager/builder — sequenced with FLAT-1 + SHELL-4 modal +
  I18N-1 (one rebuild, not two), post-contention.

## 5. Tests
composeAutoContext: doc/learner/selection sections present-or-omitted, token cap, hidden
facts stripped, managed-kind strip parity with REV-2 gate tests. Simple-mode compile:
instruction + preamble + form directive → schema-valid generation via mock provider;
template-mode byte-compat for V1 records. resolveForm auto-output roundtrip. UI (2b):
two-field create → run from toolbar → preview → save; built-in fork path; toggle/order
persist (existing prefs route).
