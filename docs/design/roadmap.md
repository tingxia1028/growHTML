# Implementation Roadmap — synthesis of the design docs

One dependency-ordered plan over the six design docs written this cycle. Purpose: decide what to build next, see what is independently shippable, and avoid the concurrency landmines. Each design doc is authoritative for its own detail; this file only sequences them.

## The design docs (all committed)
| Doc | Scope | Impl phases |
|---|---|---|
| `studypack-sharing.md` | Offline `.svpack` protected sharing v2 | **A✅ B✅ C✅ D✅ — shipped.** Follow-ups: renew UI (needs a publisher pack-LIST endpoint), e2e identity-dir override (shared server pins into real `~/.growte`), publish-ledger delete API, sealed-layer DOM marker |
| `plugin-viewer-model.md` §8 | Plugin/Kit **marketplace** | M1 · M2 · M3 |
| `note-presentation-unified.md` | In-reader note surface D1–D12 | N1 · N2 · N3 · N4 · N5 · N6 |
| `subject-kits.md` | 11 subject types × 5 kits + auto-switch | M-A · M-B · M-C |
| `multidoc-and-concepts.md` | Multi-pane docs + cross-doc notes + concept graph | P-A1 · P-A2 · P-B · P-C1 · P-C2 |
| `ai-workspace.md` | AI chat sessions + file/note attachments + doc synthesis | W1 · W2 · W3 |
| `multi-provider-ai-agent.md` (+§9) | BYOK 多厂商 + `cli-agent` kind (claude/codex 官方 SDK) + agent loop | A1 · A2 · A3 · A4 |
| `managed-ai-credits.md` (+§10) | 托管网关 + 积分 + 月费/AI Group 档位 | G-A · G-B · G-C (external-gated) |
| `multi-platform.md` | macOS/Android/iOS + 打包发布流水线 (Capacitor 共享核心) | X0 · X1 ✅(Win) · X2 · X3 · X4 |
| `learner-memory.md` | 分级记忆(短/中长/长期+画像): 机制=core, taxonomy=kit 注册 | MEM-1 · MEM-2 · MEM-3 |
| `slash-composer.md` | `/类型` 通用生成入口(chat+toolbar, AI/手敲双模, 类型注册表驱动) | SC-0 · SC-1 · SC-2 · SC-3 |
| `source-authoring.md` | Library "+"新建(md/html/…)+ 源编辑 + 纯编辑模式 + 补丁 apply 引擎 | SRC-1 · SRC-2 · SRC-3 · SRC-4 |
| `review-loop.md` | **最小复习环**(环闭合头号任务);掌握度=memory 动词,零新实体。**REV-CORE 后复习环是 CORE**(不再是插件,kit-flatten-and-core-review.md §1) | REV-1 · REV-2 · REV-3 · REV-CORE ✅ |
| `marketplace-hosted.md` | 托管市场(web 门面+客户端安装):笔记市场=svpack 服务器层、插件市场=**纯数据插件**;`CatalogSource` 接口约定 | MH-0 ✅(骑 M1)· MH-1 · MH-2 · MH-3(P3) |
| `app-shell-ux.md` | 左下角用户菜单 + Settings Hub(registerSettingsSection,A3b/G-A3b 的落点)+ 新手引导(V1 清单式,聚光灯=阅读器批) | SHELL-1 · SHELL-2 · SHELL-3(gated) |
| `website.md` | 官网:Astro+MDX(website/,复用 --sv-* tokens)· 首页/教育版/下载/文档+插件教程/定价 | WEB-1 · WEB-2 · WEB-3(P3,下载链接 gate on X1) |
| `global-search.md` | **全局搜索/Cmd+K**(验证过的空白)— 笔记/文档/命令三族,复用 SC-0 面板,V1 无索引线扫 | **SEARCH-1 ✅**(SEARCH-1-001)· SEARCH-2 |
| `data-trust.md` | 备份轮转 · 全库导出导入 · 回收站(软删除)+ 同步问题记录(V0=同步盘+锁文件) | **TRUST-1 ✅ · TRUST-2 ✅**(TRUST-12-001)· TRUST-3 |
| `study-report-delivery.md` | 学习报告(digests→可编辑报告→长图/PDF)· 导出族(Anki/Markdown/错题集)· **配对推送→老师收件箱(基于现有客户端,不做第二套系统)**· 家长=导出物→P3 web 页 | REPORT-1 · REPORT-2 · DELIVER-1 · DELIVER-2 · DELIVER-3(P3) |
| `vision-input.md` | 多模态输入(A5 内容分片+vision 能力位,**预留 audio 分片**)+ **拍错题 kit**(吸收 AIHomework:规则优先/阈值路由/本地 PaddleOCR 三车道成本) | V-1(A5) · V-2 · V-3(X2) |
| `speech-and-young-learners.md` | 低龄适配:朗读 TTS(V1=speechSynthesis 免费内建)· 语音输入 STT(**三车道**:BYOK 音频模型/managed/本地 whisper;Web Speech 在国内/Electron 不可用——诚实记录)· 注音 ruby · 小学 kit young 默认;**低龄复习环**=听题→语音作答→朗读讲解 | SPEECH-1 · SPEECH-2 · SPEECH-3 |
| `proactive-learning.md` | **主动学习引擎**(kernel AI-native 第四级):触发器(定时/事件 hook)推动 AI 主动学习;克制约束一等公民;**教回/口语 kit**(AI 装不懂=费曼)· 主动复习推动 | PRO-1 · PRO-2 · PRO-3 |
| `library-redesign.md` | Library 统一加号 + 容器分区(最近/文档/文件夹 + kit sections=views over sources)· `LibrarySection`/`LibraryAddAction` registries(core 自种)· 类型筛选 chips · I18N seed | **LIB-2 ✅** |
| `architecture-review.md` | Foundation assessment | F1–F7 (refactors, below) |
| (this) `roadmap.md` | Sequencing | — |

## Foundation refactors (from `architecture-review.md`) — do these *with* the feature that needs them, not after
The extension seams (registries / content-as-data / entity stores / render contract) are clean; the coupled spots below block deep features and cause cross-session merge contention. Each is pulled to sit **immediately before or fused with** its first dependent feature:
| # | Foundation refactor | Blocks until fixed | Fuse with |
|---|---|---|---|
| **F1** | Decompose the `WorkspaceContext` god object (1753 lines / ~79 fields / single `activeSourceId`) into per-domain stores + selectors | multi-doc, cross-doc paint, re-render/contention on every feature | **P-A1** (it *is* the multi-doc enabler) |
| **F2** | Extract `app.ts` (1737 lines / 59 inline routes) into `registerXRoutes` modules (svpack already shows the pattern) | nothing hard-blocked; friction + contention grow | incremental, any server work |
| **F3** | ✅ **shipped** (F3-D1-001, 2026-07-04) — the D1 `ReaderAnnotationAdapter` landed: `src/client/surfaces/readerAnnotationAdapter.ts` (contract + `collectAnchorRects` first/last/all + shared DOM-realm factory), `MarkerOverlay` measures through `rectsFor` (chip at `.first`), every reader (DomReader iframe / PDF / image / webview guest) hosts an adapter, and the guest's divergent inline chip is now a real body-mounted `MarkerOverlay` bridging `sv:marker-action` | ~~reader-consistency, mobile, N1/P-A2~~ unblocked | **N1** builds directly on it (D2 two slots = `rectsFor.first/.last`) |
| **F4** | Replace the single-active-kit gate (`activation.ts` `FALLBACK_DEFAULT_KIT`) with marketplace **effective-installed** | market, subject kits "foreground not filter" | **Market M1** |
| **F5** | Split `plugin==kit` 1:1 + fix `seedCorePlugin` over-claim (real `pluginId` per type) | marketplace `members[]` resolution | **Market M1** |
| **F6** | Additive rect on `html_selection`/`web_text_quote` anchors | unified region selection over HTML (D4) | **D4b** |
| **F7** | Preset stage layers (预习/学习/复习/拓展) are hardcoded in core + imposed on every vault → make them **kit-contributed + user-editable** | forces one kit's taxonomy on all users; not customizable | **F7a ✅ shipped** (core+kit decouple, `a462207`); **F7b** (Lens edit UI) rides Market M1 / N6 |

## Two keystones everything leans on
Most work funnels through two load-bearing pieces. Build order is mostly "who unblocks whom":

1. **D1 — the ReaderAnnotationAdapter** (`note-presentation-unified.md`). One paint/marker/card contract per reader. ✅ **shipped as F3** (F3-D1-001): `src/client/surfaces/readerAnnotationAdapter.ts`. Unblocks **D2 markers (N1)** AND **per-pane paint (P-A2)** — both still pending, now sitting on the landed adapter.
2. **Market M1 — effective-installed selector** (`plugin-viewer-model.md` §8.3/§8.5). The composer/toolbar must source its type list from marketplace *effective-installed*, not the single-active-kit gate in `src/kits/activation.ts`. Unblocks **subject-kit "foreground not filter" (M-B)** and **N4 types-as-catalog**.

## Dependency graph
```
D1 adapter ─┬─────────────> N1 (D2 markers + D5 floating editor)
            └─────────────> P-A2 (per-pane paint)
                              ▲
P-A1 (single→multi activeSource, + tabs DockNode) ──┴──> P-B (cross-doc note authoring)

Market M1 (effective-installed) ─┬──> Subject M-B (exemplar types + kits, foreground)
                                 └──> N4 (subject types as catalog entries)
Subject M-A (auto-switch engine, PURE) ── independent, can land anytime

svpack  A✅ ──> B🔧(tests) ──> C (import/export UI + zwsp watermark) ──> D (full e2e)
        └─ independent track: only sharing UI, no reader/context coupling

Concept P-C1 (aggregation page, additive to existing API) ──> P-C2 (graph view)
```

## Independent tracks (can run in parallel, low collision)
- **svpack C/D** — sharing UI + watermark + e2e. Touches only sharing surfaces; server done. Does not need D1 or M1.
- **Market M1** — new market UI + `plugin-prefs` state + the effective-installed selector. Mostly new files; folds in the "debts to clear" below.
- **Subject M-A** — the pure `detectSubject.ts` scorer + the topbar chip. No dep on types or M1 (foregrounding just reorders once M1 lands; the engine + chip stand alone).
- **Concept P-C1** — extends the passage-blind `GET /api/concepts/:id` + `ConceptInspector`. Additive.

## Debts to clear (each doc surfaced these; fold into the phase that touches them)
- ~~**e2e harness leak** — the suite ran on the dev ports against a repo-side vault (historically `reuseExistingServer` seeded the REAL `data/vault`).~~ **✅ REPAID 2026-07-04 (E2E-DEBT-001)**: dedicated ports 14177/15173 + per-run OS-temp vault (`e2e/harness.ts` + global setup/teardown), `reuseExistingServer:false` kept; full web suite reconciled to today's UI and GREEN (29 passed / 24 pre-existing skips / 0 failed). Remaining: `e2e-electron` still targets the pre-R1 shell (red, separate pass); the 24 `test.skip`s await their product decisions.
- **`activation.ts` single-active-kit gate** defaults to one kit (`textbook-learning`) and gates *creation* → "other types stay available" is false until the composer sources from effective-installed. **→ M1.**
- **plugin==kit 1:1** — `clientContext.tsx` registers one PluginRecord per kit; split textbook into real plugins so kit `members[]` resolve. **→ M1.**
- **`seedCorePlugin()` over-claims** — flashcard/quiz/bookmark/diagrams filed under synthetic `"core"`; each needs its own `pluginId`. **→ M1.**
- **bookmark reclassification** out of `builtinNoteContentSpecs` (metadata-first, re-export the constant). **→ M1 (metadata) / gradual.**
- **`ComposerTypePicker` not mounted** in any live composer; no single site builds the type-options list. **→ M1/N-work.**
- **`noteCardMeta` no title fallback** for vocab/grammar/excerpt/argument. **→ M-B.**
- **KaTeX not in `package.json`** — the one new UI dep, for formula/derivation/theorem. **→ M-B decision gate.**
- **Dock has no `tabs` node** (`DockNode = split|leaf`); reader tab is hardcoded chrome. Split already works. **→ P-A1.**
- **per-note (not per-anchor) layer visibility** — a cross-doc note paints in a pane iff its `layerIds` intersect that pane's enabled set; per-pane Layer Lens is new. **→ P-A2.**
- **cross-doc notes are a follow-up, not greenfield** — `note.link-anchor` shipped multi-anchor paint and deferred exactly "cross-source"; P-B finishes it. Blocked only by single active source (P-A1).

## Concurrency coordination (a live session owns reader/marker)
`annotationLayer.ts`, `markerOverlay.ts`, `*Reader.tsx`, `webview-preload.ts`, `DomReader.tsx` have in-flight edits from another session. **N1 (D2), P-A2, and all of P-A/B touch this area.** Rule: land the sharing + market + engine tracks (which avoid it) first; sequence the reader-surface work (N1, multidoc paint) after that session's changes settle, or explicitly co-design D1 with it. Everything committed so far by this line of work has stayed out of those files.

## Recommended sequence — 环闭合优先 (re-sorted per `product-kernel.md`, 2026-07)

**✅ Shipped this cycle (for the record):** svpack A–D (`c287d87`…`1a1bf27`) · AI provider server side A1–A4a (`4b9c950`,`5b35272`,`df2337e`,`3014f07`) · managed code side G-A1–A3a (`358c126`,`bf7dcb2`,`b8a974d`) · MEM-1 (`44acb3f`) · X0a services (`b0913c4`) · F7a (`a462207`) · **REV-CORE ✅** (kit-flatten-and-core-review.md §1 — review 通用化+沉核心: `review.reviewable`/`mistake` capabilities on the content-type registry + a generic contentType alias (`textbook.mistake`→core `mistake`, zero migration); the review PLUGIN dissolved into core — prompts/grade type/panel register at core seed, no market entry) · **SHELL-PRIM ✅** (kit-flatten-and-core-review.md §3 — 链接文件: core `file-link` note type `{path,title?,note?}` at core seed, visible in the slash palette/`/链接`; 打开 = new `shell:openPath` bridge IPC → shell.openPath on desktop, 复制路径 clipboard fallback on web; composer form reuses the existing dialog:openFile picker) · **SPEECH-1 ✅** (speech-and-young-learners.md §1 — 朗读 TTS: server-side edge lane (`msedge-tts`, keyless-but-online) behind a lane-seamed `SpeechService` in `src/server/services/speech.ts` + `POST /api/speech/tts`/`GET /api/speech/status`; client `useSpeakText` hook + shared `SpeakButton` (朗读↔停止, status-gated) on the floating selection toolbar / Anchor Action Bar / note-list rows; real synthesis verified; runner 听题 + settings voice picker + offline fallback lane remain for the SPEECH batch) · **SPEECH-2 ✅** (speech-and-young-learners.md §2 — 语音输入 STT, LOCAL lane: faster-whisper sidecar `scripts/stt-sidecar/` (roundtable stt.py adapted, stdlib http, GPU→CPU-int8 fallback, zh 3-step README) + `SpeechService.transcribe()`/per-lane stt status (REAL cached /health probe, injectable probe/proxy seams) + `POST /api/speech/stt` (≤15MB raw audio → `{text,language,durationMs}`; down → 502 `stt_unavailable` with the setup pointer) + client `useVoiceInput`/`VoiceInputButton` (MediaRecorder, transcript-CONFIRM popover before insert, in-place setup guide when undetected, shared status cache with useSpeakText) mounted on the chat/slash composer; real check: edge-TTS mp3 → large-v3 GPU → verbatim transcript in 1.1s; BYOK/managed lanes + runner 语音作答 + sherpa-onnx (V1.1) remain) · **LIB-2 ✅** (library-redesign.md — Library pane rebuilt, LIB-2-001: ONE registry-backed `+` (导入 文件…/网页…/挂载文件夹… + 新建 文档… wired over the EXISTING `POST /api/sources/html` seam; `.xmind` folded into the ONE 文件… picker by extension routing in `openFileDialog`) + container sections 最近 / 文档 (the NEW full sources list + type filter chips derived from present sourceTypes) / 文件夹, all rendered from a core-seeded `LibrarySection`/`LibraryAddAction` registry pair kits can append to (sections = views over sources, never containers); header search filters section items (SEARCH-1 mounts there); collapsible+persisted sections with counts + empty-state guidance; minimal typed I18N seed `src/client/i18n` (zh default, full en) — markdown blank-create + 纯编辑模式 remain SRC-1/2).

**P0 — 闭合学习环 — ✅ COMPLETE (all three shipped same-day):**
1. **REV-1 ✅ `aa7c55b`** — the review loop, deterministic (复习 rail view + explainable queue + 3 operations + `note.review` events; zero new entities).
2. **MEM-2 ✅ `828ae25`** — day-grain digests (idempotent consolidation, raw 14d/digests 12mo) + profile facts (弱项/活跃/常用) + overrides + 画像页 + transport parity + export-guard extended.
3. **REV-2 ✅** — weak buckets into queue (group 3 `弱项:{bucket}` + in-group boost; thresholds imported from profile.ts, never duplicated) + **profileContext into review.explain via the server-side gate in generateKitContent (managed kind = hard strip; the MEM-3 seam)**. The measurably-AI-native moment shipped: the same button explains differently per student.

**P1 — in flight / next slots:**
- **SC-0** (slash engine+palette) + **X0b** (transport seam + direct adapter) — agents running.
- Then per slot: **SRC-1 create half** · **N6 board (+F7b)** · **W1 ✅** (chat sessions ≡ first F1 slice — shipped 2026-07-04, W1-001: `chatSession` entity + `registerChatRoutes` CRUD/append (F2 slice) + client session domain `src/client/chat/` (chat state left the god object; +1 context field) + in-panel switcher (新对话/resume/delete) + restart-resume; `<ChatPanel>` extraction rides W3) · **Subject M-A ✅** (auto-switch engine + chip landed post-F4 — subject-kits.md §7; per-kit `detection` tables, pin = `activeKitIds`; only the chip's topbar mount rides the reader-gated batch).

**P1.5 — product table stakes (user-endorsed 2026-07-02, unplanned-gap audit):**
- **SEARCH-1 ✅ 全局搜索/Cmd+K** (global-search.md; shipped 2026-07-04, SEARCH-1-001 — `GET /api/search` services endpoint + direct-transport parity; shared pure rank core `src/core/search/rank.ts` (exact>prefix>word-boundary>substring, recency tiebreak, snippets, cap 20/family); Cmd/Ctrl+K palette `src/client/search/` mounted once in WorkspaceShell chrome (SC-0 list/keyboard idioms widened with 笔记/文档/命令 group headers); notes searchable via every spec's `toSearchText` + anchor quotes (bare anchor hit → its quote); commands V1 = navigateShell navigation (打开复习/画像/设置…); Library input stays the local section filter; SEARCH-2 pinyin/fuzzy/filters/recents remain) · **TRUST-1 ✅ 备份轮转 + TRUST-2 ✅ 全库导出/导入** (TRUST-12-001 — rotating sibling-`backups/` zips: 7d+4w+24h-protection, MEM-2-idiom scheduler, pre-destructive-op backups, restore route; streamed `.growte-vault.zip` export + confirm-phrase REPLACE import with pre-import backup + staging swap; UserMenu 数据 entries — hub 数据 section deferred, SettingsHub contended) · **TRUST-3** 回收站 remains (data-trust.md).
- **REPORT-1/2** 学习报告 + 导出族 → **DELIVER-1/2** 配对推送 + 老师收件箱 (study-report-delivery.md; parent web = DELIVER-3, P3).
- **A5/V-1** vision content-parts seam → **V-2** 拍错题 kit (vision-input.md; V-3 camera rides X2).
- **SPEECH-1 ✅ 朗读** (edge-tts lane shipped, SPEECH-1-001) → **SPEECH-1b ✅ 朗读通用化** (host-level GlobalSpeakSelection chip + chat-reply/note-shell affordances, SPEECH-1B-001 — 读=所有文本的可读能力) → **SPEECH-2 ✅ 语音输入** (LOCAL faster-whisper sidecar lane shipped, SPEECH-2-001; BYOK/managed lanes + runner 语音作答 later) → **SPEECH-3 ✅ 注音** (pinyin-pro engine + centered ruby PinyinPopover + 拼 button on the SAME two universal selection surfaces, CJK-gated, SPEECH-3-001; reader-body inline ruby = future N-batch) (speech-and-young-learners.md; 低龄复习环 = the payoff).
- **PRO-1** trigger engine + review-push → **PRO-2** 教回/口语 kit text-first (proactive-learning.md; the kernel's 4th AI-native rung — voice rides SPEECH).
- **CONCEPT-UX-1 ✅ 概念交互轻量化** (2026-07-04, CONCEPT-UX-1-001 — cheap wins on TODAY's surfaces, no graph/no new engine: 选中即建概念 selection action (normalized-name dedupe, marker-note link via `note.conceptIds`, 撤销 toast) · FocusOverlay concept chips + ＋ autocomplete · ConceptInspector 关联到… one-pick `related` relation + linked-note reveal-in-reader jump · concept list count-sort/filter/empty-guidance. The BIG redesign — capture engine ([[wiki-links]] + AI auto-tagging in the generation contract) + co-occurrence **graph kit** — is **V1.1, design doc to come**.)
- **ACTION-2a ✅ 自动上下文引擎** (action-v2-auto-context.md §1/§2, ACTION-2A-001 — composeAutoContext envelope (selection/doc/learner, 1.5k cap, selection-first truncation) composed server-side for EVERY operation; REV-2 profileContext gate generalized to all prompts (MEM-3 item absorbed), hidden-facts/managed/byte-compat guarantees pinned; Operation `mode:"simple"`+`instruction` (V1 records untouched), run-time compile = preamble+指令+form directive, unpinned output rides the adaptive-note form router → registered contentType; `/api/kits/generate` contentType now optional, response names the routed type. UI = ACTION-2b, post-contention.)

**P2 — surfaces & market (behind P0, beside it when parallel-safe):**
- **Market M1 (+F4+F5)** — unblocks subjects; **carries MH-0**: the manager lists through the `CatalogSource` interface (local now, remote later — marketplace-hosted.md §5, the one hosted-market hook V1 pays for). Then **M-B** (KaTeX decision first — the flagged hole).
- **N3 (D6)** auto-materialize.
- **Reader-gated batch** (when the concurrent reader session settles, as ONE coordinated window): **F3 (D1 adapter) ✅ shipped (F3-D1-001) → N1 (D2+D5 — fixes "AI note 丢右栏"; still pending, now sits directly on the landed adapter's `rectsFor.first/.last`) → N5 (D10+D11 note 钉住+导出) → N2 (D4+D3, F6 rides D4b)** · SC-1/SC-2 · **M-A chip mount** (`KitForegroundChipHost` one-liner in the reader toolbar — subject-kits.md §7) · A3b/A4b · G-A3b · SRC-2 · MEM 的 source-open capture.

**P3 — platform & business (necessary; never ahead of the loop):**
- **X1 ✅ (Win)** desktop packaging shipped 2026-07-04 (X1-001 — NSIS x64 installer via electron-builder; server fully esbuild-bundled into main.cjs, shipped node_modules = node-pty + claude-agent-sdk only; packaged vault at `userData/vault`; electron-updater GitHub-Releases feed + electron-log file log + UserMenu 反馈问题; see docs/design/packaging.md. **macOS deferred** pending the Apple Developer account) → **X2** mobile shell → **X3** distribution (软著/ICP ride the license track) → **X4** release train.
- **G real adapters** (WeChat Native/aliyun SMS/moderation/备案 — the 个体工商户 chain).
- **W2/W3** · **M3** · **F1≡P-A1 → P-A2 → P-B** · **P-C1** · **MCP** (server = thin exporter over the A4a tool registry, privacy-gated; client = external tools — interop/reach, NOT a generation improver).
- **MH-1 → MH-3 hosted marketplace** (marketplace-hosted.md): web storefront + catalog API + entitlements over the G-gateway; 笔记市场 = the deferred svpack server tier; 插件市场 = data-only plugins (no code sandbox). Client side needs only M1's `CatalogSource` seam (MH-0 ✅ shipped `cfcc48c`).
- **WEB-1 → WEB-3 官网** (website.md): Astro+MDX in `website/`; landing+教育版+下载 (links live at X1) → 插件开发教程 → 定价 (rides G launch; MH-1 storefront mounts at /market later).
- **EXT — plugin extension-point debts** (from the "插件能加 viewer/面板/布局吗" audit, 2026-07-02): (a) **source READER registry** — note/content viewers are fully pluggable (registry+conflicts+manager ✅) but document readers are a hardcoded `readerForSource` switch (contended file; X2 mobile also wants kind-gating here); (b) **view/rail contribution in the plugin contract** — panels today = registerView + MANUAL core mounts (WorkspaceShell import/presets node/IconRail entry — the REV/MEM idiom proves it 3×); make both registration contributions when their files free up. Kit-level layout config exists (F5) — arbitrary plugin re-layout stays out by design.

**Deferred (blessed, per kernel §3):** terminal panel hidden from study builds (dev flag) · GrapesJS (SRC-4) · M2 user-kit builder (until M1 proves demand) · P-C2 · MEM LLM narrative profile · A4b write-tools beyond createNote-through-preview.

**Rationale:** the loop IS the mission (kernel §0); the biggest gap was a missing edge, not a missing feature. Foundation still fuses with its first dependent feature (F1≡P-A1, F3→N1, F4/F5→M1 — unchanged); platform tracks distribute a closed loop rather than substitute for one; the reader-gated batch is consolidated into one coordinated window instead of five collisions.

## Per-task grounding index (每个任务的方案状态)
Rule: a task is buildable only when its spec (a) lives in a design doc, (b) is **code-grounded** (cites the real files/lines it touches), and (c) has **external research** where the approach depends on outside facts (SDKs, vendors, pricing, compliance). ⚠️ marks the known un-researched holes — resolve them *inside* that task before building.

| Task | Spec | Code-grounded | External research |
|---|---|---|---|
| svpack **C**(dialogs)/**D**(e2e) | studypack-sharing.md §5–§7 | ✅ server+watermark shipped (`9e38428`,`81992ea`,`1a8d036`) | n/a (crypto = node built-ins, decided) |
| Market **M1**(+F4/F5)/**M2**/**M3** | plugin-viewer-model.md §8 | ✅ (activation gate, `seedCorePlugin`, registries cited) | n/a |
| Subject **M-A**/**M-B**/**M-C** | subject-kits.md | ✅ (composer/type-registry paths) | ⚠️ **M-B: KaTeX 选型未调研**(唯一新 UI 依赖 — bundle/SSR/CJK,做 M-B 前先查) |
| **N1**(D2+D5)/**N2**(D4+D3)/**N3**(D6)/**N4** | note-presentation-unified.md §1–§9 | ✅ (e.g. `GenerationPreview`@views.tsx:492, CardGeom) | n/a |
| **N5**(D10+D11)/**N6**(D12 board) | note-presentation-unified.md §10 | ✅ (localStorage geom, TopBar 3-way, F7 axis) | n/a |
| **P-A1**(≡F1)/**P-A2**/**P-B**/**P-C1**/**P-C2** | multidoc-and-concepts.md | ✅ (DockNode shape, 46 activeSource refs) | n/a |
| **F1–F7** | architecture-review.md | ✅ measured (line/field counts); **F7a shipped** `a462207` | n/a |
| **W1**/**W2**/**W3** (AI workspace) | ai-workspace.md | ✅ (chat state :516/:772, `ingestSource`:64-91, folders/recent) | n/a |
| **A1** registry | multi-provider §5 Phase 0 | ✅ (`index.ts:25-34` if-ladder) | n/a — pure refactor |
| **A2** cli-agent | multi-provider §9 | ✅ (claude providers; **agent-sdk already a dep, unwired**; zod ^4.4.3 ✓) | ✅ 2026-07: official **Claude Agent SDK** + **Codex SDK** verified; ai-sdk-provider-claude-code as reference |
| **A3** BYOK HTTP | multi-provider §3–§5 | ✅ (config/secrets patterns, in-process server → safeStorage) | ✅ in-doc: AI SDK 6 / openai-compatible / safeStorage caveats |
| **A4** agent loop | multi-provider §4.3 | ✅ (SSE precedent `/api/chat/stream`) | ✅ in-doc: ToolLoopAgent / fullStream events |
| **G-A/B/C** managed | managed-ai-credits.md (+§10) | ✅ G-A1 shipped `358c126`; G-A2 in flight | ✅ in-doc(dated, re-verify flags): DeepSeek/千帆定价·微信Native/支付宝·合规;✅ 2026-07: one-api/new-api (§10.4);⚠️ **周期扣款(自动续费)个体工商户资质未验** — V2 前必须验 |
| **X0–X4** multi-platform | multi-platform.md | ✅ (no packager confirmed; StorageAdapter seam; node-dep audit table; entityClient seam) | ✅ approach research'd (Capacitor vs nodejs-mobile vs thin-client); ⚠️ 商店合规细节(软著/ICP流程)到 X3 再展开;Apple Developer 账号 = user to-do |
| **MEM-1/2/3** learner memory | learner-memory.md | ✅ MEM-1 shipped `44acb3f` (capture+guard); runCommand choke point; export-safety structural | n/a — fully local; V1 deterministic (no LLM); privacy invariants specified |
| **SC-0/1/2/3** slash composer | slash-composer.md | ✅ ("Type / for commands" placeholder exists UNIMPLEMENTED views.tsx:505; createDefault() = manual seed; declared-form generation + preview loop shipped; SC-1 gated on contended views.tsx) | n/a — pure composition of shipped substrate; pinyin lib decision at SC-3 |
| **SRC-1/2/3/4** source authoring | source-authoring.md | ✅ (create paths + ingestSource(markdown) exist; patch schema FULLY DESIGNED core/schema/patch.ts but apply engine never built — grep-verified; grapesjs a zero-usage dep; matched/fuzzy/unmatched projection exists; X0a services landed `b0913c4` — update-source builds on them) | n/a — conflicts identified in-doc (anchors re-project by quote/context, contentHash→svpack warning via publish ledger); GrapesJS bundle decision at SRC-4 |
| **REV-1/2/3** review loop | review-loop.md | ✅ (all parts exist: mistake/quiz/flashcard/review-pack types, declared-form gen+preview, note.review verb in MEM-1's enum, view registry; NEW = 1 view + 3 operations + queue policy fn — zero entities/schema changes) | n/a — pure composition; SRS = later policy swap; REV-2 depends on MEM-2 digests |
| **MH-0/1/2/3** hosted marketplace | marketplace-hosted.md | ✅ substrate inventory (svpack trust chain shipped `1a1bf27`; G-gateway auth/ledger/payments shipped `bf7dcb2`; contentTypes summary in packs; Kit&Plugin manager = M1 territory); `CatalogSource` contract pinned in-doc §5 — **MH-0 ✅ `cfcc48c`** | ⚠️ Apple IAP policy detail + ICP/UGC obligations to re-verify at MH-1 time (P3 — user defers V1); WeChat Pay real adapter rides the G license chain |
| **SHELL-1/2/3** shell UX | app-shell-ux.md | ✅ (IconRail mount clean — 复习/画像 entries prove it; svpack identity supplies display name; onboarding done-detection = pure fns over existing vault/prefs/memory-events data — every step's signal already recorded; sample doc = the self-verify fixture) | n/a — in-app only; SHELL-3 spotlight rides the reader-gated batch |
| **WEB-1/2/3** 官网 | website.md | ✅ (Astro+MDX decision in-doc; tokens importable from styles.css; Releases API for download feed; plugin-dev tutorial content = the shipped contracts: operations/kit registration/CatalogSource) | ⚠️ domain + hosting choice (ICP if in-country — rides the license chain); Lighthouse/a11y gates pinned in-doc; real links gate on X1 |
| **SEARCH-1/2** 全局搜索 | global-search.md | ✅ **SEARCH-1 ✅ shipped (SEARCH-1-001)** — `GET /api/search` (services + direct-transport parity) + shared pure rank core (`src/core/search/rank.ts`) + Cmd/Ctrl+K palette (`src/client/search/`, shell-chrome mount, SC-0 idioms, 笔记/文档/命令 three families, navigation commands via navigateShell); SEARCH-2 (pinyin/fuzzy/filters/recents) pending | n/a V1 (CJK substring, no tokenizer dep); pinyin lib decision rides SC-3 |
| **TRUST-1/2/3** 数据信任 | data-trust.md | ✅ **TRUST-1 ✅ + TRUST-2 ✅ shipped (TRUST-12-001)** — backup rotation + export/import live (`src/server/dataTrust.ts`, fflate streaming zips, UserMenu 数据 entries; hub 数据 section deferred on contended SettingsHub); TRUST-3 pending (envelope schema additive deletedAt; export-guard test extends to soft-deleted) | n/a — local-only; sync deliberately RECORDED-not-scheduled (own design round with X2) |
| **REPORT/DELIVER** 报告+推送 | study-report-delivery.md | ✅ (digests/profile APIs shipped 828ae25; svpack identity + import + HTTP server exist for pairing/inbox; long-image = WeChat-native artifact) | ⚠️ Anki .apkg generation (lib vs sqlite hand-roll) verify at REPORT-2; relay/parent-web rides G/WEB/ICP (P3) |
| **V-1/2/3** 视觉输入+拍错题 | vision-input.md | ✅ (AI SDK v7 content-parts + claude-agent-sdk image blocks known; gateway pricing already models modality×vendor; AIHomework absorbed as kit logic — local PaddleOCR service exists at C:\CG\AIHomework services/ai-ocr-service) | ⚠️ per-preset vision model ids (deepseek/GLM naming) verify at V-1 build; asset-store refs not base64 (guard) |
| **PRO-1/2/3** 主动学习 | proactive-learning.md | ✅ (trigger = schedule/event over the MEM-2 idle-scheduler pattern + memory-event stream; actionRef = operations-as-data; nudge surface clean files; desktop Notification API in Electron; teach-back steers via MEM-3 profileContext; note.review mode:"teach" = payload not new verb) | n/a — pure composition; voice modes gate on SPEECH; calendar-based preview deferred (PRO-3) |
| **SPEECH-1/2/3** 低龄语音 | speech-and-young-learners.md | ✅ (+roundtable absorbed: **edge-tts** = free/keyless neural zh TTS, JS ports research-verified (edge-tts-universal/msedge-tts), MUST run server-side (custom ws header — browsers can't) = our Express ✓; **faster-whisper** desktop lane proven in roundtable stt.py (large-v3 GPU, webm/PyAV, infer lock); **sherpa-onnx** research-verified for mobile: active v1.13.3 2026-06, official Android/iOS on-device, Paraformer zh, NNAPI/CoreML/QNN, RN/Flutter bindings; mobile TTS = native OS via Capacitor plugin — edge-tts ruled out on-device (no Node); toSpokenText/MediaRecorder/runner/kit-config grounding unchanged) | ⚠️ remaining: sherpa-onnx as ONE cross-platform local engine (it does TTS+ASR+Node) vs faster-whisper desktop — evaluate at SPEECH-2 · pinyin-pro bundle/polyphone · aliyun/讯飞 managed pricing · speechSynthesis zh fallback on real build; Web Speech SpeechRecognition ruled OUT (Google-proxied) |
