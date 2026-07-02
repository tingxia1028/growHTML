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

## Recommended sequence (foundation refactors F1–F7 fused in, **bold**)
**Now (parallel, no reader-file collision):**
1. **svpack B✅ → C → D** — server done; C = export/import dialogs + roster + zwsp watermark; D = the two-vault e2e. A whole user-facing capability on its own; touches no contended files. *(Carries **F2** opportunistically — new sharing routes already live in their own `svpack.ts` module.)*
2. **Market M1 + F4 + F5** — two-tab market + install state, **F4** (effective-installed replaces the single-active-kit gate) and **F5** (split plugin==kit, fix `seedCorePlugin`) are *part of* M1, not follow-ups. Unblocks all subject/kit work.
3. **Subject M-A** — auto-switch engine + chip (pure, standalone).

**AI Workspace track (parallel — an F1/F2 down-payment, outside the contended reader-paint files):**
- **W1** — `chatSession` vault entity + `registerChatRoutes` CRUD + extract `<ChatPanel>` / `useChatSession` (**the first F1 slice** — chat leaves the god object) + session-list UI. Delivers "one chat template + session maintenance" for BOTH the main chat and the new sidebar page; **no AI change**. Can start anytime.
- **W2** — `/api/sources/:id/bundle` + drag/Ctrl+V file→attachment (notes ride along) + library multi-select/Ctrl+C + widen `ChatContext` to `sources[]` (token budget).
- **W3** — synthesis command → new **markdown** source via `ingestSource` (headings = TOC) + the left-sidebar workspace page + default-directory landing. (See `ai-workspace.md`; locked: session=vault entity, TOC=markdown headings.)

**AI provider track (sequential, `src/ai` + server only — no reader files; runs beside the other tracks):**
- **A1 — provider registry (Phase 0, zero behavior change).** `createModelProvider` env if-ladder → registry (`registerProvider`/`listProviders`/`createProvider`); `ProviderCapabilities` += `{structured, tools, kind: mock|cli-agent|http|managed}`; existing ids (`mock`/`claude-cli`/`claude-pty`) unchanged; suite stays green.
- **A2 — `cli-agent` kind.** Wire the two OFFICIAL SDKs behind thin `CliAgentSpec` adapters — claude via `@anthropic-ai/claude-agent-sdk` (**already a dep, unwired**), codex via `@openai/codex-sdk` (new dep); detection probes; **key-strip + safe-mode invariants unit-tested**; legacy claude-cli/pty stay as fallback entries. (multi-provider §9, researched.)
- **A3 — BYOK HTTP MVP.** Add `ai` + `@ai-sdk/openai-compatible` (+ DeepSeek preset); `AiSdkProvider` (complete/stream/completeStructured); `ai-providers.json` config + safeStorage keys (env fallback); AI-Providers settings view + test-connection + active picker. (multi-provider §3-§5.)
- **A4 — tools + agent loop.** `ToolDefinition` registry → `runAgent` typed events → `POST /api/agent/stream`; read-mostly tool set + `createNote` gated by the preview loop; client tool-call cards. (multi-provider §4.3.)
- **G (managed).** User green-lit the code side (license paperwork in progress on the user's side): **G-A1 ✅ shipped `358c126`** (ledger hold/settle/refund + phone auth + pricing, mocks for SMS/pay); **G-A2 in flight** (HTTP service: SSE agent stream with hold→run→settle, mock top-up webhook, signup bonus); then **G-A3** (client: ManagedProvider kind:"managed" + login/balance/top-up UI). Real adapters (WeChat Native, aliyun SMS, moderation, 备案) slot in when the 个体工商户 chain lands.

**Multi-platform track (X, `multi-platform.md` — decisions locked: Capacitor both-platforms simultaneously · mobile V1 = 阅读+批注+AI聊天 · desktop = GitHub Releases + auto-update):**
- **X0 — shared-core enabler (⊃ F2 in full):** app.ts route bodies → transport-agnostic services (desktop wraps in Express unchanged; mobile calls directly); entityClient backend-adapter seam; Capacitor-FS storage adapter; node-dep audit. Desktop zero behavior change — parallel-safe now.
- **X1 — desktop packaging:** electron-builder (Win NSIS + macOS universal, notarized — needs the user's Apple Developer account) + electron-updater on GitHub Releases + CI release job.
- **X2 — mobile shell (Android+iOS together):** Capacitor project, direct-core backend, V1 scope; node-pty/webview/cli-agent/svpack explicitly excluded (kind- and flag-gated).
- **X3 — mobile distribution:** direct APK + TestFlight now; domestic stores (软著) + App Store China (ICP) ride the license track.
- **X4 — release train:** e2e gates, channels, changelog, crash/log story.

**Learner-memory track (MEM, `learner-memory.md` — mechanism in core, taxonomy kit-registered per the F7 lesson):**
- **MEM-1 — capture + store + export-guard:** `memoryEvent` entity + compacting jsonl; the one `runCommand` hook (registry.ts:626 — all commands flow through it) + server emits; capture on/off switch; guard test that memory entities can never ride `.svpack`. Parallel-safe now.
- **MEM-2 — tiers + 画像页:** deterministic consolidation (events→digests→profile facts) on start/idle; the editable profile/manager view; retention defaults.
- **MEM-3 — taxonomy + AI hookup:** `registerBehaviorTaxonomy` (textbook first); profileContext into ChatContext/operations — **on by default for local kinds, OFF for managed until explicit consent**; M-A auto-switch prior.

**Next (after M1):**
4. **Subject M-B** — vocab + formula + timeline exemplars (KaTeX decision); **Market M2** (previews + user kits).
5. **N3 (D6)** — AI anchor-context results auto-materialize as draft notes (undo toast).
6. **N6 (D12) — Anchor Focus board** — the two-mode anchor/note board (by document order · by stage layer). **Consumes F7 (shipped `a462207`)** for its by-stage columns — data-driven from the source's *live* stage layers, never hardcoded — and reuses the §10 PreviewCard. A mostly-independent NEW surface *outside* the contended reader-paint files, so it builds in parallel once the §10 PreviewCard substrate (R3) lands. Ship **F7b** (the Lens edit-axis UI) alongside — the board is where editing stage layers becomes visible.

**The presentation + multi-doc lift — foundation-first, coordinate with the reader session:**
7. **F3 (D1 ReaderAnnotationAdapter) → N1 (D2 markers + D5 editor) → N5 (D10+D11) → N2 (D4 selection + D3 styles).** F3 is the keystone N1/P-A2 both stand on. **N5 rides N1**: it promotes D5's localStorage card geometry to a vault-persisted, `.svpack`-exported `note.display`, adds the per-document hide-all toggle, and collapses the TopBar 3-way to two (Document + Anchor Focus). This is the user's "AI note 别丢右栏 + note 钉住并导出" fix — the *trigger* toolbar is already in-document; the fix is the *result* surface (D5) + persistence (D10). (**F6** — anchor rect — rides D4b inside N2.)
8. **F1 (decompose WorkspaceContext) ≡ P-A1 → P-A2 (per-pane paint) → P-B (cross-doc authoring).** F1 and P-A1 are the SAME work: the single→multi `activeSourceId` split *is* the god-object decomposition. Do them as one. Smallest demo = open two docs split, a shared note paints in both.
9. **Concept P-C1 → P-C2**, then **M-C / N4** (remaining subject types + import prompts M3), consuming the `.svpack` `contentTypes` summary the sharing server already emits.

**Rationale:** the foundation refactors are not a detour — F1 *is* multi-doc's enabler, F3 *is* the presentation keystone, F4/F5 *are* what makes the marketplace real. Each is fused with its first dependent feature so you pay the refactor exactly when the feature needs it, never speculatively. The independent tracks (sharing, market, auto-switch engine) go first because they're safely buildable now and de-risk the contracts the deeper work leans on; F2 is incremental and rides along.

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
