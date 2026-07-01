# Managed AI + Credits — research + design proposal

**Status: proposal (research + design only; no code).** This is the second AI
path that sits beside the BYOK proposal in `docs/design/multi-provider-ai-agent.md`.
It introduces a hosted **gateway** (a new backend you operate), **accounts**, and
**credits/payments** — the app's first deliberate step from purely local-first
toward a backend product. Targets are the desktop **Electron** build and the
**mobile/pad WebView** build; there is **no browser web release**.

Research dated **mid-2026**. Figures sourced from secondary aggregators or
community posts are flagged inline; re-verify each against the live vendor console
before locking a number into product pricing.

---

## 1. Vision — two AI paths behind one provider seam

The app keeps **one** `ModelProvider` abstraction (`src/ai/provider.ts`). Two
fundamentally different paths live behind it:

| Path | Who holds keys / pays | How it runs | Status |
| --- | --- | --- | --- |
| **BYOK** (incl. free Claude-CLI subscription) | the **user** | app calls vendors directly (`kind:"cli"` subprocess, `kind:"http"` API key) | proposed in `multi-provider-ai-agent.md` — **not this doc** |
| **MANAGED + CREDITS** | **you** (the operator) | the client calls **your gateway**; the gateway holds vendor keys, runs the agent loop, meters **credits** | **this doc** |

The free Claude-CLI subscription path (`kind:"cli"`, `buildSubprocessEnv` strips
the metered key — `src/ai/claudeCliProvider.ts:20-30`) stays first-class. Managed
is purely additive: a user who never connects a key and never tops up still has
the mock + (if they have it) the Claude CLI.

### The managed value proposition

The user connects **no API key**. They just chat. A single LLM orchestrator
(**DeepSeek**) decides — via function/tool calling — to answer text directly *or*
to call a tool such as `generate_image` (later `generate_video`). Each tool's
implementation is a per-modality **vendor adapter** (text = DeepSeek, image = a
domestic image vendor). Swapping a vendor = swapping one adapter; the LLM and the
client never change. The agent/tool loop runs **server-side in the gateway**,
which holds the keys and meters credits. You eat the vendor cost and charge a
margin in credits.

### The local-first → backend shift (call it out)

Today the app is **local-first**: a local JSONL vault, **no accounts, no secret
store, no server you operate** (the Node API server runs in-process inside
Electron main — `src/server/start.ts:23`). The managed path is the first feature
that **requires** a backend you run: user accounts (phone login), a credits
ledger, payment webhooks, and vendor keys held centrally. This is a product and
operational commitment (uptime, liability, China compliance), not just code.
Everything local keeps working unchanged when managed is off.

---

## 2. Grounded current state (file refs)

### 2.1 The provider seam — reused, extended
- `src/ai/provider.ts:55-80` — `ModelProvider` = `{ id, capabilities {chat,
  agentic, streaming}, complete, completeStructured?, stream? }`. `ChatRequest =
  { messages, context }` (`:32-36`). The BYOK doc proposes extending
  `capabilities` with `kind:"cli"|"http"|"mock"` + a `runAgent` event stream;
  **managed adds `kind:"managed"`** on the same axis.
- `src/ai/index.ts:25-34` — `createModelProvider(env)` env if-ladder
  (`mock`/`claude-cli`/`claude-pty`). The slot for a `managed` branch.
- `src/ai/mockProvider.ts` — deterministic default; the managed provider must
  degrade to / coexist with it so offline + e2e stay deterministic.

### 2.2 The transport precedent — copy it exactly
- `POST /api/chat/stream` (`src/server/app.ts:1290-1321`) — SSE: validate body
  **before any byte**, emit `event: chunk {delta}` per token, end with
  `event: done {message, provider}`, post-header failures become `event: error`.
- Client reader `entityClient.chatStream(input, onDelta)`
  (`src/client/data/entityClient.ts:474-528`) — parses `event:`/`data:` blocks,
  degrades to non-streaming `chat()` on a non-OK/no-body response, throws on a
  400. The managed agent stream is a **superset** of this event set.

### 2.3 The artifact → note pipeline — what tools produce
- `src/core/notes/resolveForm.ts` — the single choke point: a **declared**
  `{contentType, content}` is TRUSTED (`confidence:"high"`, no re-classify);
  otherwise free text is classified.
- `src/core/notes/classifyContent.ts` — pure heuristic text→form
  (markdown/markmap/mermaid/code-snippet/video-embed/html).
- `src/core/notes/contentTypes.ts` — registered `NoteContentSpec`s. The
  load-bearing ones for managed: `markdown`/`markmap`/`mermaid` (text artifacts)
  and **`image` = `{ assetId, caption? }`** (`:204-208`).
- `src/client/notes/builtinNoteTypes.tsx:345-390` — `MediaRender` points an
  `<img>` at `entityClient.assetUrl(assetId)` → `/api/assets/:id`.
- **Consequence:** a tool must return a **typed artifact** `{contentType, content}`
  that `resolveForm` trusts. Text tools → `{contentType:"markdown", content}`.
  Image tools → bytes imported as an asset → `{contentType:"image", content:{assetId}}`.

### 2.4 Asset ingestion — the one gap
- `src/core/store/assets.ts` — `importLocalAsset(vault, absPath, {mimeType})`
  reads bytes, copies to `assets/<id><ext>`, dedups by sha256, writes an
  `AssetRecord`. Served by `GET /api/assets/:id` with Range (`app.ts:936-947`).
- **Gap:** the only import path takes a **local file path**
  (`POST /api/assets/local-file`, `app.ts:907-911`). A generated image arrives as
  **bytes/URL**, not a local file. The managed path needs a small
  `importAssetBytes(vault, buffer, {mimeType, fileName})` sibling (same hash/dedup/
  record logic, skipping the `readBytes(absPath)` step) — a pure, low-risk addition.

### 2.5 Config / secrets today
- Per-vault JSON via `vault.storage.readText`/`writeTextAtomic`
  (`operation-prefs.json`, `workspace.json` — `app.ts:1075-1113`), zod-validated.
- **No secret store, no accounts.** The BYOK doc proposes Electron `safeStorage`
  for local API keys. Managed differs: **vendor keys never touch the client** —
  they live only in the gateway. The client stores just a **session token** (phone
  login), which is a low-sensitivity bearer credential (`safeStorage` on desktop,
  the platform secure store on mobile).

---

## 3. Research + recommendations

### 3.1 Orchestrator: DeepSeek (confirmed)
- **Tool calling:** DeepSeek supports OpenAI-style `tools`/`tool_calls`; it is
  OpenAI-API-compatible at `https://api.deepseek.com`. (api-docs.deepseek.com)
- **Model IDs (2026):** the live models are **`deepseek-v4-flash`** and
  `deepseek-v4-pro`; the old `deepseek-chat`/`deepseek-reasoner` aliases are
  **scheduled for removal 2026-07-24**. **Target `deepseek-v4-flash`** for the
  orchestrator (cheap, 1M context, tool calls, more stable than the thinking path).
- **Pricing (USD / 1M tokens, V4 Flash):** input cache-hit **$0.0028**, cache-miss
  **$0.14**, output **$0.28** (api-docs.deepseek.com/quick_start/pricing). Context
  caching on by default; off-peak discounts historically existed — re-verify the
  window/RMB on the live zh-CN page.
- **Caveats to design around (well-documented):** the **reasoner/thinking path
  cannot force `tool_choice`** and **breaks on multi-turn tool history** (400
  "Missing reasoning_content"); chat-mode tool calling has been called "unstable"
  (looped/empty calls). → use **non-thinking V4 Flash** for the loop, **don't rely
  on forced `tool_choice`**, add **empty-response / looped-call retry guards**.

### 3.2 Agent/tool loop: Vercel AI SDK, server-side (confirmed)
- DeepSeek runs via **`@ai-sdk/deepseek`** (or `@ai-sdk/openai-compatible` against
  the DeepSeek base URL); both support tool calling + tool streaming.
- `tool({ description, inputSchema /* zod */, execute })` — `execute` is the
  **server-side function the SDK runs automatically** on a tool call. The loop is
  `generateText`/`streamText` with **`stopWhen: stepCountIs(n)`** (or the `Agent`/
  `ToolLoopAgent` wrapper). "LLM decides → calls `generate_image`" runs fully
  server-side. (ai-sdk.dev/docs/foundations/agents)
- `streamText(...).fullStream` emits **`tool-call` / `tool-result`** (plus
  text-delta, step boundaries) → exactly the events the gateway re-emits as SSE.
- **Node/Express:** runs in plain Node (custom `fetch` supported); the only
  plumbing is piping the Web `ReadableStream` to the Node response and disabling
  proxy buffering for SSE. The SDK choice is **identical** to the BYOK doc's — we
  reuse it, just **server-side in the gateway** instead of in-process.

### 3.3 Image vendor (China-friendly) — **primary: Baidu Qianfan; fallback: Alibaba DashScope**

DeepSeek has no image model, so the `generate_image` tool needs a separate vendor.

| Vendor | API shape | Job model | Price/img (flagged) | Notes |
| --- | --- | --- | --- | --- |
| **百度 千帆 Qianfan (ERNIE/FLUX/Qwen-Image)** ★primary | OpenAI-style REST | **synchronous** (URL in response) | FLUX-schnell 0.005元 (promo 0.002), ERNIE-Turbo 0.11元, Qwen-Image 0.25元 | one call = one billable image; widest price ladder for margin tiers; real-name account only |
| **阿里 通义万相 / DashScope** ★fallback | 1st-party SDK + HTTP | mostly **async** submit+poll (`task_id`); wan2.6 has a sync mode | wanx ~0.14–0.20元 [secondary] | most operationally proven; **only one with an intl (Singapore) endpoint** → overseas failover |
| 字节 Doubao-Seedream (火山方舟) | OpenAI-compatible | **synchronous**, ~3s @1K (official) | seedream-3.0 ~0.26元 [3rd-party] | technically best sync API, but **individual-dev access reportedly enterprise-gated** [unverified] — revisit if you clear enterprise verification |
| 腾讯 混元生图 | SDKs | async + **1h URL expiry**, **default concurrency 1** | 0.5元 base | most operationally heavy/expensive of the set |
| MiniMax image-01 / 智谱 CogView | sync | sync | 0.025元 / CogView-3-Flash **free** | cheap supplementary models; smaller ecosystems |
| SiliconFlow (硅基流动, aggregator) | OpenAI-compatible, one key | synchronous, 1h URL expiry | Kolors **free**, Z-Image 0.10元, Qwen-Image 0.30元 | best **bootstrap / model-breadth** layer; not the billing system of record |
| OpenAI gpt-image-1 / Stability (intl) | sync | sync | $0.02–0.19 / $0.03–0.08 | **OpenAI geo-blocked in mainland China**; baselines only |

**Recommendation:** **Baidu Qianfan** as primary — synchronous OpenAI-style REST
means *one HTTP call = one metered image* (no poll/job state machine), and its
price ladder lets you tier margins. **Alibaba DashScope** as fallback for
redundancy + the overseas endpoint. Note **SiliconFlow** as a one-key
breadth/bootstrap layer behind the same internal adapter interface (Kolors is
free). The user's stated preference is **one vendor per modality**, which favors
**direct adapters** (Baidu primary) over an aggregator-as-default — see §8.

**Caveats:** no domestic vendor publishes a per-image latency SLA (only
ByteDance's ~3s is official) — benchmark on your own traffic. Several price pages
are JS-rendered; re-verify in console. **Real-name (实名) is universal** across
domestic platforms.

---

## 4. Design

### 4.1 `kind:"managed"` provider on the unified seam

The client gets a thin provider that **only talks to your gateway**. It never sees
a vendor, a key, or a tool. It carries the user's **session token** and streams
the gateway's agent events.

```ts
// src/ai/providers/managed.ts (NEW, sketch) — slots beside cli/http/mock
export class ManagedProvider implements ModelProvider {
  readonly id = "managed";
  // kind:"managed" added to ProviderCapabilities (same axis as cli/http/mock).
  readonly capabilities = {
    chat: true, streaming: true, structured: true,
    tools: true, agentic: true, kind: "managed"
  } as const;

  constructor(private deps: {
    gatewayBaseUrl: string;            // your hosted gateway
    getSessionToken: () => string | null;  // phone-login bearer
  }) {}

  async complete(req: ChatRequest): Promise<ChatResponse> {
    // POST {gateway}/gateway/agent  (non-streaming twin)
    // Authorization: Bearer <session token>
  }

  async *stream(req: ChatRequest): AsyncIterable<string> {
    // POST {gateway}/gateway/agent/stream — read SSE, yield only text deltas
    // (so existing chat UI works unchanged); richer events via runAgent.
  }

  // The full agent surface (text-delta + tool-call/tool-result + credits events).
  // Mirrors the BYOK doc's runAgent; here every event originates in the gateway.
  async *runAgent(req: AgentRequest): AsyncIterable<AgentStepEvent> { /* SSE → events */ }
}
```

**Selection.** `createModelProvider` gains a `managed` branch; but unlike
cli/mock it needs runtime deps (gateway URL + a live session token), so managed is
selected through stored app config + the auth state, not a bare env var. When the
user is **logged out or has zero balance**, the picker shows managed as
unavailable with a clear reason (sign in / top up).

**Why this shape:** the existing `/api/chat/stream` route + `entityClient.chatStream`
work **unchanged** for plain text — the managed provider's `stream()` yields the
same text deltas. The local in-process server simply **proxies** the chat/agent
call to the remote gateway when the active provider is `managed` (adding the
`Authorization` header server-side so the renderer never handles vendor traffic).
Tool-call/credits cards are an additive `runAgent` surface, capability-gated.

### 4.2 Gateway architecture (the new backend)

```
client (Electron / mobile WebView)
   │  POST /gateway/agent/stream   Authorization: Bearer <session>
   ▼
GATEWAY (Node service you host)
   ├─ auth: verify session token → userId
   ├─ credits: pre-authorize a HOLD (reject if insufficient)
   ├─ moderation: screen the INPUT prompt  ← compliance §6
   ├─ agent loop (Vercel AI SDK, server-side):
   │     model = deepseek-v4-flash
   │     tools = [ generate_image, (later) generate_video ]
   │     stopWhen: stepCountIs(N)
   │     ── on each LLM turn: meter orchestrator tokens
   │     ── on tool-call → modality adapter (routing table):
   │           text   → DeepSeek (streaming)
   │           image  → Baidu Qianfan  (prompt → bytes/URL)   [fallback: Alibaba]
   │           video  → (later; async job + credits-hold)
   │     ── normalize tool result → typed artifact {contentType, content}
   │     ── moderation: screen OUTPUT (text + generated image)  ← compliance §6
   │     ── label AI output (explicit + implicit)               ← compliance §6
   ├─ assets: image bytes → store → emit assetId (client fetches via gateway)
   ├─ credits: SETTLE actual cost (orchestrator tokens + each paid tool); REFUND the hold on failure
   └─ SSE out: text-delta | tool-call | tool-result | artifact | credits | done | error
```

**Per-modality vendor adapter interface** (the swap seam):

```ts
// gateway/adapters/modality.ts (NEW backend, sketch)
export type ModalityAdapter = {
  modality: "text" | "image" | "video";
  vendor: string;            // "deepseek" | "baidu-qianfan" | "alibaba-dashscope"
  model: string;
  // image: prompt → asset; text: streaming handled inline by the AI SDK model.
  run(input: unknown, ctx: AdapterCtx): Promise<{
    artifact: { contentType: string; content: unknown };  // resolveForm-trusted
    usage: { unit: "image" | "1k_tokens" | "second"; quantity: number };  // for metering
  }>;
};
```

**Routing table** (swappable config + fallback):

```ts
const ROUTING = {
  text:  { vendor: "deepseek",          model: "deepseek-v4-flash" },
  image: { vendor: "baidu-qianfan",     model: "ernie-image-turbo",
           fallback: { vendor: "alibaba-dashscope", model: "wan2.6-t2i" } },
  // video: { vendor: "...", model: "...", async: true }   // §5 Phase 3
};
```

**Result normalization → the adaptive-note pipeline.** Every adapter returns a
`{contentType, content}` the existing `resolveForm` **trusts** as-is:
- text → `{ contentType: "markdown", content: "<reply>" }` (the classifier can
  still upgrade markmap/mermaid/code on the client).
- image → bytes imported via the new `importAssetBytes` → `{ contentType:
  "image", content: { assetId, caption } }`, fetched through `/api/assets/:id`.

So a managed result renders through the **exact same** `getNoteType().render` path
as a hand-made note — zero new render code.

**Asset handling across the boundary.** The image lives in the **gateway's**
store, not the user's vault, until the user saves the note. Two options:
(a) the gateway proxies bytes at `{gateway}/assets/:id` (auth'd by session); the
local server imports them into the vault via `importAssetBytes` when the user
saves; or (b) the gateway returns a short-lived signed URL the local server
fetches. **Recommend (a)** — keeps every byte behind your auth + lets you enforce
the AI-content **implicit label** (metadata) at the gateway before the client ever
sees it.

**Stack (minimal, NOT the local JSONL vault).** The gateway is a real
multi-user backend: a small Node service (Express/Fastify) + **Postgres** (users,
ledger, payments — needs transactions + uniqueness for idempotency) + **Redis**
(sessions, rate limits, credit-hold TTLs) + object storage for generated assets.
Do **not** reuse the append-only JSONL vault for the ledger — concurrent
multi-user money needs ACID. (The ledger is logically append-only; physically a
Postgres table — §4.3.)

### 4.3 Credits ledger + metering

**Append-only ledger** (one Postgres table, never updated in place):

```ts
// ledger entry (conceptual)
{
  id, userId, ts,
  kind: "signup_bonus" | "topup" | "hold" | "settle" | "refund" | "adjust",
  amount,                 // credits, signed (+grant/refund, −spend)
  balanceAfter,           // denormalized running balance for fast reads
  ref: { holdId?, paymentId?, agentRunId?, toolCallId? },
  meta: { modality?, vendor?, model?, usage? },
  idempotencyKey         // UNIQUE — dedups retries (payment webhooks, client retries)
}
```

Balance = sum of amounts (or read `balanceAfter` of the latest row). **Hold /
settle / refund** flow per agent run:

1. **Pre-authorize (HOLD).** Estimate the run's max cost (orchestrator tokens +
   a per-tool ceiling) → write a `hold` (negative, with a Redis TTL). If balance −
   outstanding holds < 0 → **reject before any vendor call** (`insufficient_balance`).
2. **Run + meter.** Meter the **orchestrator LLM turn** (DeepSeek token usage from
   the AI SDK) **and each paid tool call** (one image = the image vendor's per-image
   price). Accumulate actual cost.
3. **Settle / refund.** On success: `settle` the actual cost, release the hold
   remainder. On any failure (vendor error, moderation block, timeout): **`refund`
   the hold in full** — the user is never charged for a failed generation
   (matches vendors: Baidu/Tencent don't bill failed images).

**Idempotency everywhere.** Every mutating op carries an `idempotencyKey`
(agentRunId+step for metering; the WeChat/Alipay transaction id for top-ups). The
UNIQUE constraint makes duplicate webhook deliveries and client retries safe — a
hard requirement since both WeChat and Alipay **retry notifications** (§4.5).

**Pricing map** (keyed `modality × vendor × model`; credits = vendor cost × margin,
rounded up). Sketch (illustrative; 1 credit ≈ ¥0.01, tune later):

| Item | Vendor cost | Credits charged (margin) |
| --- | --- | --- |
| orchestrator text, deepseek-v4-flash | ~$0.14/1M in, $0.28/1M out | per-1k-token credits, rounded up per turn |
| image, baidu ernie-image-turbo | ~0.11元 | e.g. 20–30 credits/image |
| image, baidu flux-schnell (cheap tier) | ~0.005元 | e.g. 2–5 credits/image |
| video (later) | per-second job | held + settled on job completion |

Store the pricing map as **server config** (versioned), not code, so a vendor
price change is a config edit. Record the `priceVersion` on each `settle` row.

**Free tier / signup bonus.** A `signup_bonus` ledger entry on first phone login
(e.g. enough for a handful of images) — drives activation; capped and one-time
(idempotency on userId).

**Guardrails.**
- **Confirm-before-spend** for expensive tools: the gateway streams a `tool-call`
  event with an **estimated credit cost**; the client shows "Generate image (~N
  credits)?" and only proceeds on confirm (especially image/video). Cheap text
  turns run without a prompt.
- **Per-day / per-run caps** per user (Redis counters) → reject over-cap with a
  clear message.
- **Insufficient-balance** rejection happens at the HOLD step, before any vendor
  call — never a silent overspend.

### 4.4 Accounts / auth

- **Phone + SMS code login** (the China norm; also satisfies real-name — carriers
  real-name-bind numbers). Flow: request code → store a **hash** of the code →
  expiry ~5–10 min → rate-limit (~1/30–60s/number) + CAPTCHA → single-use verify
  with an attempt cap → issue a **session token** (short-lived access JWT +
  revocable refresh token; Redis for session/blacklist/rotation).
- **SMS provider:** 阿里云短信 or 腾讯云短信 (~¥0.045/verification SMS); both need a
  pre-approved 签名 + 模板. **Indie reality:** a *pure individual* effectively
  **cannot** get a sendable signature in 2025–2026 — but a **个体工商户 license
  counts as enterprise-level** and unblocks it.
- **Real-name:** for a standard AI/content app, a back-end-verified **phone number
  is sufficient** 实名认证 (《互联网用户账号信息管理规定》Art. 9; Deep Synthesis
  Provisions Art. 9). Step up to 身份证-level only for high-risk features.
- The **client** stores only the session token (desktop `safeStorage`; mobile
  secure store). Vendor keys stay in the gateway.

### 4.5 Payment (微信支付 / 支付宝)

**Desktop (Electron, no browser) → scan-QR ("Native"/"当面付").** The realistic path:
- **WeChat Native支付:** server calls Native下单 → `code_url` (valid 2h) → render
  as QR → user scans in WeChat. (JSAPI/H5 are **not** applicable to a native
  desktop client.)
- **Alipay 当面付 扫码支付** (`alipay.trade.precreate`) → `qr_code` string → QR.
  (`alipay.trade.page.pay` is browser-redirect-based — not for native Electron.)

**Mobile native app → APP支付.** WeChat APP支付 (register a 移动应用 APPID, bind to
the 商户号) + Alipay `alipay.trade.app.pay` via SDK.

**Crediting (both platforms):** credit the user **in the async notify webhook**,
never on the client.
- WeChat: WeChat POSTs `notify_url` on success; respond 200/204 within 5s; verify
  signature, decrypt `resource` (AEAD_AES_256_GCM, APIv3 key), check amount,
  **credit idempotently** (WeChat retries up to ~15×).
- Alipay: success when `trade_status` ∈ {`TRADE_SUCCESS`,`TRADE_FINISHED`}; 验签;
  respond with the literal string `success`; idempotent credit (Alipay retries
  ~8× over 24h).

**Merchant account (商户号) — the gating constraint.** A pure individual
(自然人) **cannot** get a real programmatic 商户号 for Native/APP. The cheapest legal
path: **register a 个体工商户** (free, online, often same-day) → open a normal
WeChat Pay 普通商户 + Alipay merchant with that 营业执照. (小微商户 is a dead end —
no APP支付, onboarding APIs discontinued 2023; 免签/personal-QR setups violate TOS
and are unlicensed-clearing-adjacent — avoid.)

> **Recommend for the MVP:** desktop **WeChat Native QR** top-up (simplest, covers
> the desktop-first audience) + Alipay 当面付 QR as the second button; add mobile
> APP支付 when the mobile build ships. One fixed top-up SKU set (e.g. ¥10/¥30/¥100
> credit packs) keeps the first integration trivial.

---

## 5. Phased plan (each phase independently shippable)

**The linchpin prerequisite (do first):** register a **个体工商户**. A single one
unlocks (a) the WeChat/Alipay 商户号, (b) the Aliyun/Tencent SMS signature, and (c)
the legal entity for 算法备案 + 大模型登记. Nothing user-facing in managed can
legally launch to Chinese users without it (§6).

### Phase A — MVP: text-only managed (no image yet)
- **Gateway (new backend):** Node service + Postgres + Redis; phone+SMS login +
  session tokens; the credits ledger (hold/settle/refund + idempotency); the
  DeepSeek-only agent loop (no tools yet) streaming text via SSE; **one** top-up
  path (WeChat Native QR) + webhook crediting; signup bonus.
- **Client:** `ManagedProvider` (`kind:"managed"`) selectable when logged in +
  balance > 0; login UI; balance display; top-up (show QR); reuse the existing
  chat stream UI unchanged.
- **Compliance:** input+output text moderation; AI-content labeling; 算法备案 +
  登记 filed; phone real-name.
- **Outcome:** a user with no key chats with DeepSeek and pays by credits.

### Phase B — add the `generate_image` tool
- **Gateway:** register the `generate_image` tool in the AI SDK loop; the **image
  modality adapter** (Baidu Qianfan primary, Alibaba fallback); per-image metering
  + the confirm-before-spend guardrail; image bytes → asset store with the
  implicit AI label; output image moderation.
- **Client:** `importAssetBytes` on the local server (the §2.4 gap) to pull a saved
  image into the vault as an `image` note; tool-call/result cards via `runAgent`;
  the "Generate image (~N credits)?" confirm.
- **Outcome:** "draw me X" → DeepSeek calls `generate_image` → an `image` note,
  metered per image.

### Phase C (later) — video + breadth
- `generate_video` tool. **Design the seam now, defer the vendor deep-dive.** Video
  is an **async job** (submit → poll) → the credits flow must support a **long-lived
  hold** that settles on job completion and refunds on failure/timeout (the ledger
  already models holds; video just holds longer). The artifact normalizes to the
  existing `video` contentType (`asset` member). Add a fallback/aggregator
  (SiliconFlow) behind the modality adapter for model breadth; Alipay/mobile APP支付.

**Gateway vs client split per phase:** essentially **everything new is
gateway/backend** (auth, ledger, agent loop, adapters, moderation, payment
webhooks, asset store). The client only gains: the `ManagedProvider`, login +
balance + top-up UI, the confirm-before-spend prompt, `importAssetBytes`, and the
tool-call cards. The local in-process server gains a thin **proxy** to the gateway.

---

## 6. China compliance (do not skip — it shapes the MVP)

You are a **提供者/provider** under the Interim Measures for Generative AI Services
(《生成式人工智能服务管理暂行办法》, effective 2023-08-15). Holding the vendor keys
and outputting content makes you the **content producer** bearing liability.

**Legally required before serving Chinese users:**
1. **算法备案 + 大模型登记** (the *reseller* regime). If you only call an
   already-备案'd model via API (DeepSeek, 通义) **without fine-tuning**, you need
   algorithm filing + provincial large-model **登记** — but are **exempt from the
   full national 大模型备案**. **The upstream provider's filing does NOT flow to
   you** — you have your own obligation because you serve the public. (Full
   national 双备案 is only triggered if you fine-tune/train your own — **defer**.)
2. **Real-name authentication** — a back-end-verified **phone number** satisfies it
   (Deep Synthesis Provisions Art. 9). Already in Phase A.
3. **Input + output content moderation** — integrate **阿里云内容安全** or
   **腾讯云天御**; screen both user prompts and model outputs (text *and* generated
   images). You hold producer liability — integrate a vendor product, don't roll
   your own.
4. **AI-content labeling — MANDATORY now** (《人工智能生成合成内容标识办法》,
   effective 2025-09-01; standard GB 45438-2025; **active enforcement** since late
   2025). Both are required:
   - **显式标识 (explicit):** a user-visible "AI 生成/合成" label on text + images;
     must survive export/download. → render it on managed-produced notes and bake it
     into generated images.
   - **隐式标识 (implicit):** metadata in the file (generation attribute, provider
     name/code, content id). → stamp at the gateway before bytes reach the client
     (a reason to proxy assets — §4.2).

**Deferrable:** full national 大模型备案/双备案 (only if you later fine-tune); the
forthcoming comprehensive 人工智能法 (not enacted as of mid-2026).

**Penalties:** warnings → 责令改正 → **责令暂停服务** (Interim Measures Art. 21–22);
serious data violations escalate to PIPL (up to RMB 50M / 5% of turnover). The
observed pattern is rectification + suspension/delisting.

**MVP implication:** moderation (both directions) and labeling (both kinds) are
**not optional polish — they are launch-blocking** for managed. Budget gateway
work for them in Phase A (text) and Phase B (image), not "later."

---

## 7. Build-vs-buy

- **Orchestrator + agent loop:** **buy/reuse** the Vercel AI SDK (same as BYOK);
  don't hand-roll a tool loop. **Direct** DeepSeek adapter.
- **Image vendor:** the user wants **one vendor per modality** → lean **direct
  adapter** (Baidu primary, Alibaba fallback). Tradeoff: a direct integration per
  vendor vs an aggregator (SiliconFlow/OpenRouter) that gives one key + many
  models + one prepaid balance but inherits *their* shared rate limits, carries
  model-deprecation risk (you can't pin a model they retire), and adds a middleman
  to your compliance/data path. **Reasonable hybrid:** direct Baidu/Alibaba for
  core metered traffic; SiliconFlow behind the same `ModalityAdapter` interface for
  long-tail/experimental models only.
- **Moderation:** **buy** (阿里云内容安全 / 腾讯云天御) — liability + accuracy.
- **SMS:** **buy** (阿里云/腾讯云短信).
- **Payment:** **direct** WeChat/Alipay merchant (avoid 聚合支付 二清 risk for
  durable money flow); a reputable merchant-of-record aggregator is acceptable only
  as a bridge.
- **Ledger / accounts:** **build** (it's your core money logic) on Postgres+Redis.

---

## 8. Open decisions

1. **One vendor per modality vs aggregator default.** Recommended: direct Baidu
   (image) + DeepSeek (text), SiliconFlow only behind the adapter for breadth.
   Confirm you don't want SiliconFlow as the default to ship faster.
2. **Image model tier(s) exposed.** One quality model (ERNIE-Image-Turbo ~0.11元)
   only, or a cheap tier too (FLUX-schnell ~0.005元) selectable by the user/credits?
3. **Credit unit + margin + top-up SKUs.** Pin "1 credit = ¥?" and the per-image
   credit price; the fixed top-up packs.
4. **Asset boundary.** Proxy bytes through the gateway (recommended — enforces the
   implicit label + auth) vs signed-URL direct fetch.
5. **Confirm-before-spend threshold.** Always confirm image/video; never confirm
   text — agree the exact rule (and per-day cap defaults).
6. **Legal entity timing.** Register the 个体工商户 now (it gates payment + SMS +
   filing). Confirm who is the registered 主体.
7. **Phase A scope.** Text-only managed first (no image) — confirm that's the MVP,
   not "image from day one."
8. **Reuse the BYOK provider extensions.** This design assumes the BYOK doc's
   `kind`/`runAgent` capability extensions land first (or jointly). Confirm
   sequencing with `multi-provider-ai-agent.md`.

---

## 9. Appendix — cited symbols / paths

- `src/ai/provider.ts:32-80` — `ModelProvider`, `ChatRequest`, `ProviderCapabilities`.
- `src/ai/index.ts:25-34` — `createModelProvider` (the `managed` branch slot).
- `src/ai/claudeCliProvider.ts:20-30` — `buildSubprocessEnv` key-strip (CLI stays free).
- `src/ai/mockProvider.ts` — deterministic default (managed must coexist).
- `src/server/app.ts:1290-1321` — `/api/chat/stream` SSE (the transport precedent).
- `src/client/data/entityClient.ts:474-528` — `chatStream` SSE reader; `:461-464` `assetUrl`.
- `src/core/notes/resolveForm.ts` — declared-form-trusted choke point (tool artifacts flow here).
- `src/core/notes/classifyContent.ts` — pure text→form heuristic.
- `src/core/notes/contentTypes.ts:204-208` — `image` = `{ assetId, caption? }`.
- `src/client/notes/builtinNoteTypes.tsx:345-390` — `MediaRender` → `/api/assets/:id`.
- `src/core/store/assets.ts:29-71` — `importLocalAsset` (needs an `importAssetBytes` sibling).
- `src/server/app.ts:907-947` — asset import + Range serving.
- `src/server/start.ts:23` — server runs in-process in Electron main (local-first today).
- `docs/design/multi-provider-ai-agent.md` — BYOK / unified provider (reused; `kind`/`runAgent`).

### External references
- DeepSeek API + pricing + tool calling: https://api-docs.deepseek.com/ ·
  https://api-docs.deepseek.com/guides/function_calling ·
  https://api-docs.deepseek.com/quick_start/pricing · https://www.cloudzero.com/blog/deepseek-pricing/
- DeepSeek tool-calling caveats: https://github.com/continuedev/continue/issues/9245 ·
  https://github.com/deepseek-ai/DeepSeek-R1/issues/314
- Vercel AI SDK (agents, deepseek provider, multi-step tools): https://ai-sdk.dev/docs/foundations/agents ·
  https://ai-sdk.dev/providers/ai-sdk-providers/deepseek · https://ai-sdk.dev/cookbook/node/call-tools-multiple-steps
- Image vendors: https://cloud.baidu.com/doc/qianfan-api · https://help.aliyun.com/zh/model-studio ·
  https://www.volcengine.com/docs/82379 · https://cloud.tencent.com/document/product/1729 ·
  https://docs.bigmodel.cn · https://docs.siliconflow.cn
- Payment: https://pay.weixin.qq.com/doc/v3/merchant/4012791874 (Native) ·
  https://pay.weixin.qq.com/doc/v3/merchant/4012791861 (notify) ·
  https://opendocs.alipay.com/support/01rfux (当面付) · https://opendocs.alipay.com/support/01raw4 (notify)
- Merchant eligibility: https://pay.weixin.qq.com/static/help_guide/business_registration.shtml
- SMS: https://help.aliyun.com/zh/sms/user-guide/qualification-application-description ·
  https://cloud.tencent.com/announce/detail/2127
- Compliance: https://www.cac.gov.cn/2023-07/13/c_1690898327029107.htm (Interim Measures) ·
  https://www.cac.gov.cn/2022-12/11/c_1672221949354811.htm (Deep Synthesis) ·
  https://www.cac.gov.cn/2025-03/14/c_1743654684782215.htm (labeling) ·
  https://www.allbrightlaw.com/CN/10475/9d795e4543aa51ea.aspx (reseller filing analysis)

---

## 10. Addendum (2026-07) — 月费订阅 + AI Group 档位 + 网关先例

### 10.1 AI Group = a sellable plan (SKU); routing moves per-group
```ts
aiGroup = {
  id, name,                                   // "基础" / "专业" …
  orchestrator: { vendor, model },            // e.g. deepseek-v4-flash
  routing: { text, image, video? },           // §4.2's ROUTING table becomes ONE group's routing
  pricing: { monthlyFeeYuan, monthlyGrantCredits, creditRateDiscount }
}
```
Multiple groups sell side by side; a user subscribes to one. Each `settle` ledger row records
`groupId` + `priceVersion` (auditable rate history). "封一个固定的 AI group" = author one row here.

### 10.2 Subscription = a monthly credit GRANT — never "unlimited"
Usage is metered vendor cost; "不限量" is uncapped liability — don't sell it. A subscription buys:
1. a monthly **`subscription_grant`** credits deposit (new ledger kind; idempotency = userId+period), and
2. the group's **discounted credit rates** while active.
User gains `groupId` + `subscriptionValidUntil`. MVP: granted credits **roll over** (simplest
ledger semantics); expiring grants are a V2 policy switch. Lapse semantics: benefits stop (rate
reverts to standard, no further grants); the remaining balance stays usable. Pay-as-you-go top-ups
(§4) coexist unchanged — 积分包 and 月费 are the same ledger.

### 10.3 Renewal
- **MVP = manual renewal:** a subscription SKU through the exact §4.5 QR top-up flow — the webhook
  sets `subscriptionValidUntil += 1 month` + writes the grant. **Zero new payment integration.**
- **V2 = auto-renew** (微信/支付宝 周期扣款/委托代扣 — signed agreement + scheduled deduction).
  **UNVERIFIED for 个体工商户 eligibility** — both platforms gate entrusted-deduction products;
  verify with the registered entity before promising auto-renew in the UI.

### 10.4 Prior art (researched 2026-07) — one-api / new-api: adopt-or-copy
`songquanpeng/one-api` (Go, single binary/Docker) and its db-compatible fork `new-api` are mature
open-source LLM gateways: unified multi-vendor channels, weighted load-balancing + failover,
**tokens + quotas + recharge codes** (new-api adds online recharge, per-call billing, rate
configs, user groups). Two adoption modes for our gateway:
- **(a) Fastest:** deploy **new-api as the internal vendor-pool + quota-accounting layer**; our
  thin gateway (auth · agent loop · compliance · payment) calls it as its **single
  OpenAI-compatible upstream**. We still own everything it lacks: phone login, official WeChat
  Native pay (its 易支付-style recharge is TOS-risky — §4.5 stance unchanged), moderation +
  AI-content labeling, the **agent tool loop**, artifact normalization into notes.
- **(b) Cleanest:** copy its token/quota schema into our own Postgres ledger — ours already
  specifies **hold/settle/refund** (§4.3), which one-api lacks; keep ours.
Recommendation: start (b) for the ledger (it's the money core — own it), consider (a) later purely
as the multi-vendor channel pool if channel ops become a burden.
