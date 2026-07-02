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
| `multi-platform.md` | macOS/Android/iOS + 打包发布流水线 (Capacitor 共享核心) | X0 · X1 · X2 · X3 · X4 |
| `learner-memory.md` | 分级记忆(短/中长/长期+画像): 机制=core, taxonomy=kit 注册 | MEM-1 · MEM-2 · MEM-3 |
| `slash-composer.md` | `/类型` 通用生成入口(chat+toolbar, AI/手敲双模, 类型注册表驱动) | SC-0 · SC-1 · SC-2 · SC-3 |
| `source-authoring.md` | Library "+"新建(md/html/…)+ 源编辑 + 纯编辑模式 + 补丁 apply 引擎 | SRC-1 · SRC-2 · SRC-3 · SRC-4 |
| `review-loop.md` | **最小复习环**(环闭合头号任务)= 第一个上层 AI-native 插件;掌握度=memory 动词,零新实体 | REV-1 · REV-2 · REV-3 |
| `marketplace-hosted.md` | 托管市场(web 门面+客户端安装):笔记市场=svpack 服务器层、插件市场=**纯数据插件**;`CatalogSource` 接口约定 | MH-0 ✅(骑 M1)· MH-1 · MH-2 · MH-3(P3) |
| `app-shell-ux.md` | 左下角用户菜单 + Settings Hub(registerSettingsSection,A3b/G-A3b 的落点)+ 新手引导(V1 清单式,聚光灯=阅读器批) | SHELL-1 · SHELL-2 · SHELL-3(gated) |
| `website.md` | 官网:Astro+MDX(website/,复用 --sv-* tokens)· 首页/教育版/下载/文档+插件教程/定价 | WEB-1 · WEB-2 · WEB-3(P3,下载链接 gate on X1) |
| `architecture-review.md` | Foundation assessment | F1–F7 (refactors, below) |
| (this) `roadmap.md` | Sequencing | — |

## Foundation refactors (from `architecture-review.md`) — do these *with* the feature that needs them, not after
The extension seams (registries / content-as-data / entity stores / render contract) are clean; the coupled spots below block deep features and cause cross-session merge contention. Each is pulled to sit **immediately before or fused with** its first dependent feature:
| # | Foundation refactor | Blocks until fixed | Fuse with |
|---|---|---|---|
| **F1** | Decompose the `WorkspaceContext` god object (1753 lines / ~79 fields / single `activeSourceId`) into per-domain stores + selectors | multi-doc, cross-doc paint, re-render/contention on every feature | **P-A1** (it *is* the multi-doc enabler) |
| **F2** | Extract `app.ts` (1737 lines / 59 inline routes) into `registerXRoutes` modules (svpack already shows the pattern) | nothing hard-blocked; friction + contention grow | incremental, any server work |
| **F3** | Land the D1 `ReaderAnnotationAdapter` — kill per-reader paint duplication + the divergent webview guest | reader-consistency, mobile, N1/P-A2 | **before N1** (it's the N1/P-A2 keystone) |
| **F4** | Replace the single-active-kit gate (`activation.ts` `FALLBACK_DEFAULT_KIT`) with marketplace **effective-installed** | market, subject kits "foreground not filter" | **Market M1** |
| **F5** | Split `plugin==kit` 1:1 + fix `seedCorePlugin` over-claim (real `pluginId` per type) | marketplace `members[]` resolution | **Market M1** |
| **F6** | Additive rect on `html_selection`/`web_text_quote` anchors | unified region selection over HTML (D4) | **D4b** |
| **F7** | Preset stage layers (预习/学习/复习/拓展) are hardcoded in core + imposed on every vault → make them **kit-contributed + user-editable** | forces one kit's taxonomy on all users; not customizable | **F7a ✅ shipped** (core+kit decouple, `a462207`); **F7b** (Lens edit UI) rides Market M1 / N6 |

## Two keystones everything leans on
Most work funnels through two load-bearing pieces. Build order is mostly "who unblocks whom":

1. **D1 — the ReaderAnnotationAdapter** (`note-presentation-unified.md`). One paint/marker/card contract per reader. Unblocks **D2 markers (N1)** AND **per-pane paint (P-A2)**. It lives in the reader/marker files a **concurrent session currently owns** → coordinate before touching.
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

**✅ Shipped this cycle (for the record):** svpack A–D (`c287d87`…`1a1bf27`) · AI provider server side A1–A4a (`4b9c950`,`5b35272`,`df2337e`,`3014f07`) · managed code side G-A1–A3a (`358c126`,`bf7dcb2`,`b8a974d`) · MEM-1 (`44acb3f`) · X0a services (`b0913c4`) · F7a (`a462207`).

**P0 — 闭合学习环 — ✅ COMPLETE (all three shipped same-day):**
1. **REV-1 ✅ `aa7c55b`** — the review loop, deterministic (复习 rail view + explainable queue + 3 operations + `note.review` events; zero new entities).
2. **MEM-2 ✅ `828ae25`** — day-grain digests (idempotent consolidation, raw 14d/digests 12mo) + profile facts (弱项/活跃/常用) + overrides + 画像页 + transport parity + export-guard extended.
3. **REV-2 ✅** — weak buckets into queue (group 3 `弱项:{bucket}` + in-group boost; thresholds imported from profile.ts, never duplicated) + **profileContext into review.explain via the server-side gate in generateKitContent (managed kind = hard strip; the MEM-3 seam)**. The measurably-AI-native moment shipped: the same button explains differently per student.

**P1 — in flight / next slots:**
- **SC-0** (slash engine+palette) + **X0b** (transport seam + direct adapter) — agents running.
- Then per slot: **SRC-1 create half** · **N6 board (+F7b)** · **W1** (chat sessions ≡ first F1 slice) · **Subject M-A ✅** (auto-switch engine + chip landed post-F4 — subject-kits.md §7; per-kit `detection` tables, pin = `activeKitIds`; only the chip's topbar mount rides the reader-gated batch).

**P2 — surfaces & market (behind P0, beside it when parallel-safe):**
- **Market M1 (+F4+F5)** — unblocks subjects; **carries MH-0**: the manager lists through the `CatalogSource` interface (local now, remote later — marketplace-hosted.md §5, the one hosted-market hook V1 pays for). Then **M-B** (KaTeX decision first — the flagged hole).
- **N3 (D6)** auto-materialize.
- **Reader-gated batch** (when the concurrent reader session settles, as ONE coordinated window): **F3 (D1 adapter) → N1 (D2+D5 — fixes "AI note 丢右栏") → N5 (D10+D11 note 钉住+导出) → N2 (D4+D3, F6 rides D4b)** · SC-1/SC-2 · **M-A chip mount** (`KitForegroundChipHost` one-liner in the reader toolbar — subject-kits.md §7) · A3b/A4b · G-A3b · SRC-2 · MEM 的 source-open capture.

**P3 — platform & business (necessary; never ahead of the loop):**
- **X1** desktop packaging (needs the user's Apple Developer account) → **X2** mobile shell → **X3** distribution (软著/ICP ride the license track) → **X4** release train.
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
