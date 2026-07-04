# Multi-Provider AI Agent — research + design proposal

**Status: proposal (research + design only; no code).** This is the natural next
slice of the AI orchestration engine (`docs/design/ai-orchestration.md`) and the
concrete realization of the deferred "tool-calling / agentic loops" and the
"GrowHTML MCP server" backlog items. It does NOT contradict the iron rule: the
new mechanism still lives in `src/ai` and never imports a kit.

---

## 1. Problem statement

Today the app's AI is **Claude-only, chat-only**. The provider is chosen by one
env var (`STUDY_VAULT_AI_PROVIDER`) and is either a deterministic mock or one of
two integrations that **spawn the `claude` CLI binary as a subprocess** under the
user's subscription login. We want to evolve this into a real, pluggable
**multi-vendor AI agent module**:

1. **Many vendors, user-selectable.** DeepSeek, OpenAI, Google Gemini, OpenRouter,
   local/self-hosted (Ollama/LM Studio), and others — configured in-app, not by
   env.
2. **Agent, not just chat.** Tool/function calling, multi-step agentic loops,
   streaming of intermediate steps — so the AI can *do* things (vault ops) rather
   than only reply.
3. **Embed a mature SDK, don't hand-roll.** Survey the OSS landscape and adopt the
   best fit for a TypeScript/Node + Electron app.

### The central design tension

There are **two fundamentally different integration models** behind today's single
`ModelProvider` interface, and the new design must keep BOTH first-class:

| Model | How it talks to the LLM | Auth / billing | Examples today / future |
| --- | --- | --- | --- |
| **CLI / subscription** | spawns the `claude` binary (subprocess or PTY), pipes a prompt, parses stdout | user's CLI OAuth login; **no metered API billing**; API key deliberately *stripped* | `claude-cli`, `claude-pty` |
| **HTTP / API-key** | HTTPS request to a vendor endpoint | a per-vendor API key the user supplies; metered billing | DeepSeek, OpenAI, Gemini, OpenRouter, Ollama (no key) |

The CLI model is valuable precisely because it is **free under the user's existing
Claude subscription** (`buildSubprocessEnv` strips `ANTHROPIC_API_KEY` /
`ANTHROPIC_AUTH_TOKEN` so the metered API is never silently billed —
`src/ai/claudeCliProvider.ts:20-30`). We must not lose it. The unification job is
to put HTTP/API-key providers behind the *same* `ModelProvider` seam without
forcing the CLI providers to pretend to be HTTP clients, and without leaking API
keys into CLI subprocesses.

---

## 2. The current AI stack (grounded)

### 2.1 The provider boundary — `src/ai/provider.ts`

A capability-tagged interface. Everything above it is provider-agnostic.

```ts
// src/ai/provider.ts:55-80 (verbatim shape)
export type ProviderCapabilities = {
  chat: boolean;
  agentic: boolean;     // can run agentic tools
  streaming: boolean;   // implements stream()
};

export interface ModelProvider {
  readonly id: string;
  readonly capabilities: ProviderCapabilities;
  complete(request: ChatRequest): Promise<ChatResponse>;
  completeStructured?(request: StructuredRequest): Promise<{ json: string }>;
  stream?(request: ChatRequest): AsyncIterable<string>;
}
```

- `ChatRequest` = `{ messages: ChatMessage[]; context?: ChatContext }` where
  `ChatContext` carries study metadata (sourceTitle, quote, contextBefore/After,
  location) the providers weave into the prompt (`provider.ts:19-36`).
- `completeStructured` returns **raw JSON text**, validated above the boundary.
- `stream` yields **plain text chunks** (no tool events) — there is no tool/agent
  concept in the interface yet. `capabilities.agentic` exists but is purely
  descriptive today; nothing consumes it for a tool loop.

### 2.2 The three concrete providers

| File | id | chat | agentic | streaming | Integration model |
| --- | --- | --- | --- | --- | --- |
| `src/ai/mockProvider.ts` | `mock` | ✓ | ✗ | ✓ | none (deterministic, offline; the default + test backbone) |
| `src/ai/claudeCliProvider.ts` | `claude-cli` | ✓ | ✓ | ✗ | spawns `claude --print [--session-id\|--resume]`, prompt on stdin, parses stdout |
| `src/ai/claudePtyProvider.ts` | `claude-pty` | ✓ | ✓ | ✗ | one persistent PTY `claude` session, idle-detection to delimit a turn |

- **`mock`** shares one private `answer()` between `complete` and `stream` so the
  streamed concatenation is byte-identical to the one-shot reply
  (`mockProvider.ts:42-51`); `completeStructured` echoes the host-supplied
  `sample` (the basis of deterministic offline tests).
- **`claude-cli`** is *cold per turn* (`claude -p`), keeping context server-side
  via an explicit `--session-id`/`--resume` (`claudeCliProvider.ts:98-141`). On
  Windows it must spawn through the shell (`.cmd` shim). `streaming:false` →
  the server wraps `complete()` as a single SSE chunk.
- **`claude-pty`** keeps the session warm (cheaper multi-turn under subscription;
  `claudePtyProvider.ts:13-52`), delimiting a turn with an idle timer.
- **Safety invariant (must survive the refactor):** in subscription mode the
  metered key is stripped from the subprocess env (`buildSubprocessEnv`,
  `claudeCliProvider.ts:20-30`); this is unit-tested.

### 2.3 The factory + selection — `src/ai/index.ts`

```ts
// src/ai/index.ts:25-34
export function createModelProvider(env = process.env): ModelProvider {
  const choice = (env.STUDY_VAULT_AI_PROVIDER ?? "mock").toLowerCase();
  if (choice === "claude-pty") return new ClaudePtyProvider({ ... });
  if (choice === "claude-cli") return new ClaudeCliProvider({ baseEnv: env, subscriptionMode: true });
  return new MockModelProvider();
}
```

A hardcoded `if`-ladder keyed by one env var. There is **no registry, no
per-provider config, no API-key handling** — exactly what we are about to add.

### 2.4 Structured generation + templates (the engine, reuse as-is)

- `src/ai/structured.ts` — `generateStructured(provider, { messages, schema,
  sample?, contentType? })`: prepends a JSON-only system message, calls
  `completeStructured` (or `complete` + `extractJson`), `schema.parse`es, and
  re-prompts on mismatch up to `maxAttempts`. Provider-agnostic.
- `src/ai/template.ts` — pure `{{var}}` engine (`extractVariables`,
  `renderTemplate`); imports nothing from kits/core (the iron rule).
- The `Operation` entity ("operation-as-data") resolves a stored prompt template
  through `resolvePrompt` (`src/kits/resolvePrompt.ts`) into the *same*
  `generateStructured` path — see `docs/design/ai-operation-as-data.md`. **All of
  this is provider-agnostic and is reused verbatim** once HTTP providers implement
  `complete`/`completeStructured`.

### 2.5 Streaming chat end-to-end (the transport, reuse as-is)

- **Server:** `POST /api/chat/stream` (`src/server/app.ts:1213-1244`) — SSE
  (`text/event-stream`). Validates the body (same `chatRequestSchema`) *before*
  any byte; if `provider.stream` exists it iterates it emitting `event: chunk
  {delta}`, else falls back to one chunk from `complete()`; ends with
  `event: done {message, provider}`; post-header errors become `event: error`.
- `POST /api/chat` (`:1199-1207`) — non-streaming twin.
- **Provider injection:** `createApp({ vault, modelProvider, clientDir })` —
  `const provider = modelProvider ?? createModelProvider()` (`app.ts:241-243`).
  The provider is a **singleton per app instance**, constructed once at boot. This
  is the seam where multi-provider selection has to become dynamic (per request /
  per user config) rather than a boot-time constant.
- **Client:** `entityClient.chatStream(input, onDelta)` reads the SSE stream and
  degrades to non-streaming `chat()` on failure; the `anchor.ask-ai` command
  feature-detects streaming. (`docs/design/ai-orchestration.md` §Streaming.)

### 2.6 Config & secrets storage (the pattern to extend)

- **Per-vault JSON via `vault.storage`.** `operation-prefs.json` and
  `workspace.json` live under `vault.paths.studyDir` and are read/written with
  `vault.storage.readText(path)` / `vault.storage.writeTextAtomic(path, json)`
  (`app.ts:1075-1113`), validated by a zod schema on read. This is the canonical
  pattern for "structured config in the vault."
- **`plugin-settings.json`** follows the same `vault.storage` shape for kit/plugin
  prefs.
- **Secrets:** there is **no secret storage today** — the only sensitive value is
  the Anthropic key, and the CLI providers *avoid* it. No `safeStorage`, no
  keychain, no `keytar` anywhere in the repo. Adding HTTP providers introduces the
  first real secret-at-rest problem.

### 2.7 Electron (where secure storage becomes possible)

- `electron/main.ts` — `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: false`. **Critically, the Node API server runs *in-process* inside the
  Electron main process** via `startServer(...)` (`main.ts:16`, `start.ts:23-28`),
  not as a separate child. → the server code can call Electron's `safeStorage`
  directly when running under Electron (and fall back when running as the plain
  Node CLI / web build).
- `electron/preload.ts` — a locked-down `contextBridge` surface
  (`window.studyVault`): desktop flag, dir/file pickers, a PTY channel. The
  renderer has **no Node access** and talks to the backend over HTTP. New
  privileged operations (decrypt a key) would either run server-side in main, or
  be added as `ipcMain.handle` channels mirroring `dialog:pickDirectory`.

---

## 3. OSS / ecosystem survey

This is a TypeScript/Node + Electron app, so the JS/TS ecosystem is strongly
favored (a Python proxy like LiteLLM is an out-of-process dependency we'd rather
avoid). Evaluated options:

### 3.1 Vercel AI SDK (`ai` + `@ai-sdk/*`) — **RECOMMENDED**

A free OSS, TypeScript-first toolkit (~14M weekly downloads as of mid-2026 vs
~2.4M for `langchain`). It gives a **unified interface over 15–20+ providers**
(OpenAI, Anthropic, Google, DeepSeek, Mistral, xAI, Cohere, Groq, Bedrock, etc.)
plus an `@ai-sdk/openai-compatible` adapter (`createOpenAICompatible({ baseURL,
name, headers })`) that covers *any* OpenAI-shaped endpoint — OpenRouter, Ollama,
LM Studio, DeepSeek, vLLM, Together, Fireworks — with just a baseURL + key swap.

Core surface maps almost 1:1 onto our needs:
- `generateText` / `streamText` → our `complete` / `stream`.
- `generateObject` / `streamObject` (zod schema → validated object) → our
  `completeStructured` (and could *replace* the JSON-extraction retry loop with
  provider-native structured output where supported).
- **Tools**: `tool({ description, inputSchema: z.object({...}), execute })` —
  define a tool once, expose to *any* provider; the SDK normalizes
  provider-specific tool-call formats.
- **Agent loop**: `ToolLoopAgent` (AI SDK 6, shipped Dec 2025) runs the full
  call→tool→result→repeat loop (default `stopWhen: stepCountIs(20)`), with
  `onStepFinish` callbacks and a `.stream()` that exposes a `fullStream` of typed
  events (`text-delta`, `tool-call`, `tool-result`, step boundaries) — exactly the
  "stream intermediate steps" requirement. AI SDK 6 also added **stable MCP
  support** and human-in-the-loop tool approval.

**Why it wins for us:** minimal abstraction (we keep our own `ModelProvider` seam
and just delegate to it), lightweight bundle, first-class streaming + tools +
structured output across all target vendors, zod-native (we already use zod for
every schema), and it's an in-process library (no extra service to run). The CLI
providers stay as-is *beside* it — the SDK only powers the HTTP/API-key branch.

**Verified caveat:** model ids drift (e.g. `gpt-5.5`, `deepseek-v4-flash`,
`claude-sonnet-4`); the config model below stores the model id as free text +
sensible defaults rather than hardcoding an enum.

### 3.2 LangChain.js — not recommended as the base

Heavier orchestration framework (chains, agents, memory, retrievers, 200+
loaders, LangGraph, LangSmith). LangChain.js 1.0 GA'd Oct 2025 with `createAgent`.
Tradeoffs: ~101 kB gzipped + a large dependency tree, more abstractions to learn,
and it overlaps things we already own (our structured/template/operation engine,
our preview loop). Its real moat is RAG/retrieval + eval tooling — neither is in
this slice's MVP. Reassess **only if** we later want a vector-store/retrieval
ecosystem; it composes fine alongside the AI SDK if so.

### 3.3 Gateways — OpenRouter (recommended add-on) / LiteLLM (no)

- **OpenRouter**: a single OpenAI-compatible endpoint
  (`https://openrouter.ai/api/v1`) + one key that fans out to hundreds of models
  (`provider/model` slugs). With the AI SDK this is *just another*
  `createOpenAICompatible` provider — zero special code. Great "instant access to
  many models with one key" option to expose as a built-in provider preset.
- **LiteLLM**: a capable proxy but it's **Python** and out-of-process — a poor fit
  for an embedded desktop app. Skip; OpenRouter covers the gateway use-case
  in-process.

### 3.4 The OpenAI-compatibility shortcut

DeepSeek, Ollama, LM Studio, vLLM, Together, Fireworks, OpenRouter, and many
others are **OpenAI-API-compatible** (just baseURL + key). This collapses "add any
provider" into "let the user enter a baseURL + key + model id" backed by one
`createOpenAICompatible` adapter. So our concrete provider implementations reduce
to a tiny set: native adapters for the few that have richer features
(Anthropic/OpenAI/Google), plus **one generic OpenAI-compatible provider** that
covers the long tail. (DeepSeek even offers an Anthropic-format endpoint at
`/anthropic`, but the OpenAI-compatible path is simplest.)

### 3.5 Reference patterns (landscape, not embedded)

Mastra (TS agent framework on top of the AI SDK), OpenAI Agents SDK, and the MCP
ecosystem are worth watching for agent/tool patterns and for the future MCP slice
— but for *this* app the right move is to embed the AI SDK directly and keep our
own thin seam, not to adopt a second framework.

> **Recommendation:** Adopt the **Vercel AI SDK** as the HTTP/API-key engine
> behind our existing `ModelProvider` seam; expose providers as a registry of
> presets (Anthropic-API, OpenAI, Google, DeepSeek, OpenRouter, Ollama,
> "OpenAI-compatible (custom)") plus the existing CLI/PTY Claude providers; use
> `ToolLoopAgent` + `tool()` for the agent loop in the later slice.

---

## 4. Design

### 4.1 Unified provider model (extends, doesn't break, `ModelProvider`)

Keep the existing `ModelProvider` interface as the **lowest common denominator**
(`id`, `capabilities`, `complete`, optional `completeStructured`/`stream`) so all
current callers and tests are untouched. Add:

1. **Richer capabilities** (declare so UI/agent degrade gracefully):

```ts
// src/ai/provider.ts (EXTEND)
export type ProviderCapabilities = {
  chat: boolean;
  streaming: boolean;
  structured: boolean;   // native generateObject/JSON-mode (else: prompt + extract)
  tools: boolean;        // function/tool calling — gates the agent loop
  agentic: boolean;      // can run a multi-step tool loop (tools && a loop driver)
  /** "cli" (subscription subprocess) | "http" (api-key) | "mock". Drives config UI + key handling. */
  kind: "cli" | "http" | "mock";
};
```

2. **An optional agent method** (only HTTP/tool-capable providers implement it):

```ts
export type AgentStepEvent =
  | { type: "text-delta"; delta: string }
  | { type: "tool-call"; toolName: string; args: unknown; id: string }
  | { type: "tool-result"; id: string; result: unknown }
  | { type: "step"; index: number }
  | { type: "done"; message: ChatMessage };

export interface ModelProvider {
  // ...existing members unchanged...
  /** Multi-step tool loop, streamed as typed events. Present iff capabilities.agentic. */
  runAgent?(request: AgentRequest): AsyncIterable<AgentStepEvent>;
}

export type AgentRequest = ChatRequest & { tools?: ToolDefinition[]; maxSteps?: number };
```

This keeps the surface backward-compatible: chat/structured/stream are unchanged;
`runAgent` is purely additive and feature-detected (mirroring how the SSE route
already feature-detects `stream`).

3. **`createModelProvider` becomes a registry/factory keyed by provider id**
   (respecting the repo's "one capability behind a shared contract, resolved
   through a registry" philosophy — same shape as the NoteType / kit-prompt /
   theme registries):

```ts
// src/ai/registry.ts (NEW)
export type ProviderFactory = (config: ProviderConfig, deps: ProviderDeps) => ModelProvider;

const registry = new Map<string, ProviderFactory>();
export function registerProvider(id: string, make: ProviderFactory): void;
export function listProviders(): ProviderDescriptor[];   // for the settings UI
export function createProvider(config: ProviderConfig, deps: ProviderDeps): ModelProvider;
```

Built-in registrations (each in its own file under `src/ai/providers/`):
- `mock` → `MockModelProvider` (kind: "mock")
- `claude-cli`, `claude-pty` → existing providers (kind: "cli") — **unchanged**
- `anthropic-api`, `openai`, `google`, `deepseek`, `openrouter`, `ollama`,
  `openai-compatible` → **one thin `AiSdkProvider`** parameterized by an
  `@ai-sdk/*` model factory (kind: "http").

`STUDY_VAULT_AI_PROVIDER` (env) is preserved as a **fallback/override** for tests
and headless CLI use, but the *primary* selection moves to stored config (§4.2).
`createModelProvider(env)` keeps working (back-compat) by delegating to the
registry with the env-chosen id.

4. **One AI-SDK-backed provider** wraps the SDK behind our seam:

```ts
// src/ai/providers/aiSdk.ts (NEW, sketch)
export class AiSdkProvider implements ModelProvider {
  readonly id: string;
  readonly capabilities: ProviderCapabilities; // {chat, streaming, structured, tools, agentic, kind:"http"}
  constructor(private model: LanguageModelV2, id: string, caps: ...) {}

  async complete(req: ChatRequest) {
    const { text } = await generateText({ model: this.model, messages: toCoreMessages(req) });
    return { message: { role: "assistant", content: text } };
  }
  async *stream(req: ChatRequest) {
    const { textStream } = await streamText({ model: this.model, messages: toCoreMessages(req) });
    for await (const delta of textStream) yield delta;
  }
  async completeStructured(req: StructuredRequest) {
    // Prefer native structured output; our generateStructured still validates above.
    const { object } = await generateObject({ model: this.model, messages: ..., schema: z.any() });
    return { json: JSON.stringify(object) };
  }
  async *runAgent(req: AgentRequest) {
    const agent = new ToolLoopAgent({ model: this.model, tools: toSdkTools(req.tools),
      stopWhen: stepCountIs(req.maxSteps ?? 20) });
    for await (const part of agent.stream({ messages: ... }).fullStream) yield mapEvent(part);
  }
}
```

`toCoreMessages` maps our `ChatMessage[]` + `ChatContext` into AI-SDK messages
(the existing CLI providers' `sourceBlock`/`passageBlock` prompt-shaping logic can
be lifted into a shared `src/ai/buildPrompt.ts` so every provider weaves study
context identically).

**Capability matrix after this slice:**

| Provider | kind | chat | stream | structured | tools | agentic |
| --- | --- | --- | --- | --- | --- | --- |
| mock | mock | ✓ | ✓ | ✓ (echo sample) | ✗ | ✗ |
| claude-cli / claude-pty | cli | ✓ | ✗ | via complete | ✓\* | ✓\* (CLI-internal) |
| anthropic-api / openai / google / deepseek / openrouter / openai-compatible | http | ✓ | ✓ | ✓ | ✓ | ✓ |
| ollama (local) | http | ✓ | ✓ | model-dependent | model-dependent | model-dependent |

\* The CLI providers are "agentic" in the sense the binary runs its own tools; they
do **not** implement our `runAgent` event stream (the app-defined tool loop is an
HTTP-provider capability). UI gates app-tools on `capabilities.agentic === true`
*and* `runAgent` present.

### 4.2 Config & secrets

**Config record** (per provider instance — a user can configure several):

```ts
// src/core/schema/aiProvider.ts (NEW) — recordEnvelope-wrapped, same as other entities
export const aiProviderConfigSchema = z.object({
  id: z.string(),                 // stable id, e.g. "deepseek-1"
  kind: z.enum(["cli", "http", "mock"]),
  providerType: z.string(),       // registry key: "openai" | "deepseek" | "openai-compatible" | "claude-pty" | ...
  label: z.string(),              // user-facing name
  model: z.string(),              // free text (ids drift): "gpt-5.5", "deepseek-v4-flash"
  baseURL: z.string().url().optional(),    // for openai-compatible / ollama / self-host
  params: z.record(z.unknown()).default({}),  // temperature, maxTokens, ...
  // NOTE: NO apiKey here. The key lives only in the secret store, referenced by id.
  apiKeyRef: z.string().optional()
});
```

**Where it's stored:** AI provider *selection + non-secret config* is **app-level,
not per-vault** — a user's keys/model choice should follow them across vaults.
Store as `ai-providers.json` next to other app settings (app userData dir under
Electron; a sibling of the vault config for the web/CLI build), read/written with
the existing `vault.storage.readText` / `writeTextAtomic` atomic-write pattern and
validated by zod on read (exactly like `operation-prefs.json`,
`app.ts:1075-1113`). A small `activeProviderId` field records the current choice.

> Decision: **app-level** for keys/model, with an optional **per-vault override**
> later (a vault could pin "use the local Ollama provider"). MVP = app-level only.

**Secure key storage** — never plaintext:

- **Electron (desktop, primary):** use `safeStorage` (OS keychain on macOS, DPAPI
  on Windows, libsecret on Linux). The server runs **in-process in main**
  (`start.ts:23`), so it can call `safeStorage.encryptString` /
  `decryptString` directly. Store only the **ciphertext** (hex) in a
  `secrets.json` (or in the OS keychain via a `keytar`-style call); decrypt on
  demand when constructing an HTTP provider. Guard on
  `safeStorage.isEncryptionAvailable()` (false on Windows before `ready`, and on
  some headless Linux) and surface a clear "encryption unavailable" state rather
  than silently writing plaintext. Prefer the async API
  (`encryptStringAsync`/`decryptStringAsync`).
- **Web / plain-Node-CLI fallback (no `safeStorage`):** read keys from
  **environment variables** (`OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, …) only — do
  **not** persist a plaintext key to disk. The settings UI shows "set via env" /
  "not stored" for that build. (This keeps the e2e/web path key-free and
  deterministic via the mock.)
- **Boundary:** keys live and are decrypted **server-side only** (in main). The
  renderer never receives a key; it only sees a "configured ✓ / not configured"
  flag over HTTP. The HTTP request to the vendor is made by the in-process server,
  not the browser — so no key crosses the contextBridge and CORS/key-exposure is a
  non-issue.

**Settings UI sketch** (a new registered workspace view, peer of the Operations
Manager `operationViews.tsx`; data via `entityClient`, never raw `fetch`):

```
┌ AI Providers ───────────────────────────────────────────────┐
│ Active: [ DeepSeek (deepseek-v4-flash)        ▼ ]            │
│                                                              │
│ Configured providers                          [+ Add]        │
│  • Claude (subscription CLI)   kind: cli    [✓ no key]  Edit │
│  • DeepSeek                    kind: http   [key set ●] Edit │
│  • Ollama (local)             kind: http   baseURL …    Edit │
│                                                              │
│ ── Add / Edit ───────────────────────────────────────────── │
│  Provider type [ OpenAI-compatible ▼ ]  (presets: OpenAI,    │
│                 Anthropic-API, Google, DeepSeek, OpenRouter, │
│                 Ollama, Claude CLI, Claude PTY, Custom)      │
│  Label         [ DeepSeek                              ]      │
│  Model         [ deepseek-v4-flash                     ]      │
│  Base URL      [ https://api.deepseek.com              ]      │
│  API key       [ ••••••••••••  ] [Save to keychain]          │
│                 (stored encrypted via OS keychain; never     │
│                  shown again — replace to change)            │
│  [ Test connection ]   [ Save ]                              │
└──────────────────────────────────────────────────────────────┘
```

"Test connection" runs a 1-token `complete()` and reports ok/capabilities.
Picking the active provider supersedes the env-only `STUDY_VAULT_AI_PROVIDER`
selection (env remains a fallback when no config exists — the migration path).

### 4.3 The agent loop

**Tool abstraction — define once, run anywhere.** A vault-side tool is a
zod-schema'd, named, async function. We define them provider-agnostically and
adapt to whichever provider runs them (`toSdkTools` for the AI SDK; the future
MCP slice exports the same set over MCP):

```ts
// src/ai/tools.ts (NEW) — pure registry, imports nothing from a kit (iron rule)
export type ToolDefinition<I = unknown, O = unknown> = {
  name: string;
  description: string;
  inputSchema: ZodTypeAny;
  execute: (input: I, ctx: ToolContext) => Promise<O>;
};
export function registerTool(t: ToolDefinition): void;
export function listTools(): ToolDefinition[];
```

`ToolContext` carries the *capabilities* the tool may use (the vault stores, the
current focus/source) — injected server-side, so a tool can `createNote`,
`listNotes`, `searchConcepts`, `runOperation`, etc. **Vault ops become tools** —
the realization of the deferred "GrowHTML MCP server" idea, but in-process first.

**The loop** runs in `runAgent` (delegated to `ToolLoopAgent` for HTTP providers):
LLM call → tool-calls → `execute` each via the registry → feed results back →
repeat until `stopWhen`/`done`. Each step is streamed as `AgentStepEvent`s.

**Streaming intermediate steps to the client.** Add `POST /api/agent/stream`
(SSE), modeled on `/api/chat/stream` (`app.ts:1213`), emitting the richer event
set (`text-delta`, `tool-call`, `tool-result`, `step`, `done`) instead of only
`chunk`. The client renders a transcript with tool-call/result cards (a superset
of the chat log). Non-agentic providers (mock, CLI) simply don't expose the agent
surface — the UI falls back to plain chat (capability-gated).

**MVP honesty:** the first agent slice ships with a *small, safe, read-mostly* tool
set (e.g. `searchNotes`, `getSource`, `listConcepts`) plus **one** write tool
(`createNote`) routed through the **existing generate→preview→save loop**
(`docs/design/generation-preview.md`) so nothing is persisted without user
confirmation — never a blind write. Destructive tools, MCP transport, and
human-in-the-loop approval gating come later.

### 4.4 How it reconciles with prior decisions

- **Iron rule** (`docs/design/ai-orchestration.md`): all new mechanism
  (`registry.ts`, `providers/*`, `tools.ts`, `buildPrompt.ts`) lives in `src/ai`
  and imports nothing from `src/kits`/`src/core`. Tools receive their vault
  capabilities by injection from the server, not by importing core.
- **Operation-as-data** (`docs/design/ai-operation-as-data.md`): unchanged. Stored
  operations now run against *any* provider for free, since `generateStructured`
  is provider-agnostic. A future tool `runOperation(operationId, input)` exposes
  operations to the agent.
- **Generation preview** (`docs/design/generation-preview.md`): reused as the
  confirmation gate for agent write-tools.
- **Deferred MCP server**: this design is the in-process precursor — the same
  `ToolDefinition` registry is what an MCP server would export later (AI SDK 6 has
  stable MCP support both as client and pattern).

---

## 5. Phased plan (each step independently shippable)

### Phase 0 — Registry refactor (no behavior change)
Convert `createModelProvider` into the registry/factory; register the existing
mock/claude-cli/claude-pty unchanged; extend `ProviderCapabilities` with
`structured`/`tools`/`kind` (existing providers fill them in honestly). Env
selection still works. **Ships invisibly; pure groundwork. All tests stay green.**

### Phase 1 — MVP: one HTTP provider + config + key storage + picker
- Add `ai` + `@ai-sdk/openai` (or `@ai-sdk/deepseek`) + `@ai-sdk/openai-compatible`.
- `AiSdkProvider` implementing `complete`/`stream`/`completeStructured` (no agent
  yet); register `deepseek` (or `openai`) + a generic `openai-compatible`.
- `ai-providers.json` config (zod) + `safeStorage`-backed `secrets.json` (with the
  env-var web/CLI fallback).
- AI Providers settings view + active-provider picker; `Test connection`.
- Server: provider selection per the active config (construct on demand / cache);
  `/api/chat` + `/api/chat/stream` unchanged otherwise. `claude-cli`/`claude-pty`
  **still selectable and fully working.**
- **Outcome:** user can pick DeepSeek/OpenAI with their own key, *or* keep
  free Claude-subscription CLI. Chat + structured generation work on all.

### Phase 2 — Tool calling + agent loop
- **A4a ✅ (server)** + **A4b ✅ (client, A4b-001 2026-07-05).** `ToolDefinition` registry + `toSdkTools`; `runAgent` on `AiSdkProvider` via `ToolLoopAgent`; `AgentStepEvent` + `POST /api/agent/stream`. **Client (A4b):** capability-gated 🛠 用工具 button → `entityClient.agentStream` (SSE 6-event dispatch) → render-only `agentTurn` transcript (collapsible tool-call/result cards + streamed answer), final message persists as one assistant turn; `MockAgentProvider` (offline tools provider, byte-identical mock delegation) for deterministic e2e. Plan + impl adversarially reviewed.
- A small read-mostly tool set (`search_notes`/`get_source`/`list_anchors`) shipped; `createNote` (write tool) gated by the preview loop — **still deferred**.
- Client agent transcript UI (tool-call/result cards), capability-gated.
- **Outcome:** the AI can *do* things (search the vault, draft a note) with
  confirmation, on any tool-capable HTTP provider.

### Phase 3 — Breadth + polish
- More provider presets (Google, OpenRouter, Ollama/local, Anthropic-API).
- Per-vault provider override; richer params (temperature, max tokens) UI.
- Token-level native streaming for the CLI/PTY Claude path (currently
  `streaming:false`), if worthwhile.

### Phase 4 (deferred) — MCP / external tools
Export the `ToolDefinition` registry over MCP (the deferred "GrowHTML MCP server"),
and/or consume external MCP servers as tools (AI SDK 6 stable MCP). Human-in-the-
loop approval for destructive tools.

---

## 6. Risks

1. **Secret-at-rest correctness.** `safeStorage` has real platform edge cases
   (`isEncryptionAvailable()` false on Windows pre-`ready`/in some headless Linux;
   decrypt failures across OS-user changes). Mitigation: guard on availability,
   async API, env-var fallback, never silently write plaintext, surface a clear
   "encryption unavailable" state.
2. **Losing the subscription/CLI advantage.** The free Claude-CLI path is a
   genuine differentiator and must remain first-class; the key-stripping invariant
   (`buildSubprocessEnv`) must keep its unit test. Risk: a careless unification
   makes CLI a second-class citizen or leaks the API key into the subprocess.
   Mitigation: `kind: "cli"` providers never touch the secret store; tests assert
   no key in CLI env.
3. **Provider/model drift + capability mismatches.** Model ids change; not every
   provider supports tools/structured output (esp. local models). Mitigation:
   model id is free text with presets; capabilities are declared and the UI/agent
   degrade gracefully (no tools → plain chat).
4. **Metered-billing surprise.** HTTP providers cost real money per token (unlike
   the subscription CLI). Mitigation: clear labeling in the picker (`kind: http` =
   "uses your API key, billed by the vendor"), and a later token/cost display.
5. **Dynamic provider construction vs the boot-time singleton.** Today the provider
   is built once in `createApp`. Switching to per-config construction needs care
   (cache instances; dispose PTY sessions on switch — `ClaudePtyProvider.dispose`
   exists). Mitigation: a small provider-manager that memoizes by config id and
   disposes on change.

---

## 7. Open decisions (for the user)

1. **First HTTP provider for the MVP** — DeepSeek (cheap, OpenAI-compatible, good
   default) vs OpenAI vs "let me enter any OpenAI-compatible endpoint"? Recommend
   shipping the generic `openai-compatible` provider + **DeepSeek** preset first
   (covers the most ground for the least code).
2. **Config scope** — app-level keys (recommended; follow the user across vaults)
   vs per-vault. MVP app-level; per-vault override later.
3. **Key storage on non-Electron builds** — env-var-only (recommended) vs an
   encrypted file with a user passphrase. Recommend env-only for now.
4. **Agent write-tools gating** — always route writes through the
   generate→preview→save confirmation (recommended) vs allow auto-apply for
   trusted tools. Recommend confirmation-only for the first agent slice.
5. **Keep `STUDY_VAULT_AI_PROVIDER`?** — yes, as a test/headless fallback +
   override; stored config wins when present. (Confirm we don't want a hard cutover.)
6. **Adopt the AI SDK as recommended** — confirm vs evaluating LangChain.js (only
   compelling if RAG/retrieval is on the near-term roadmap).

---

## 8. Appendix — cited symbols / paths

- `src/ai/provider.ts:55-80` — `ProviderCapabilities`, `ModelProvider`.
- `src/ai/index.ts:25-34` — `createModelProvider` env if-ladder (to become a registry).
- `src/ai/mockProvider.ts:42-58` — shared `answer()` stream/complete; `completeStructured` echo.
- `src/ai/claudeCliProvider.ts:20-30,83-141` — `buildSubprocessEnv` key-strip invariant; `claude -p` session handling.
- `src/ai/claudePtyProvider.ts:18-57` — persistent PTY session; `dispose()`.
- `src/ai/structured.ts:52-87` — `generateStructured` (provider-agnostic; reused).
- `src/ai/template.ts` — pure `{{var}}` engine (iron rule).
- `src/server/app.ts:241-243` — provider injection in `createApp`.
- `src/server/app.ts:1199-1244` — `/api/chat` + `/api/chat/stream` (SSE).
- `src/server/app.ts:1075-1113` — `operation-prefs.json` / `workspace.json` via `vault.storage` (config pattern).
- `src/core/storage/adapter.ts` — `StorageAdapter` interface (`readText`/`writeTextAtomic`/…); `src/core/storage/nodeStorage.ts` — atomic write impl (temp+rename).
- `src/client/data/entityClient.ts:463-517` — `chatStream` SSE reader (the client transport to extend for agent events).
- `src/server/start.ts:23-28` — server runs **in-process** in Electron main (→ `safeStorage` reachable).
- `electron/main.ts:16,23-41` — `contextIsolation:true`, `nodeIntegration:false`, in-process `startServer`.
- `electron/preload.ts:12-40` — locked-down `contextBridge` (`window.studyVault`), IPC channel pattern.
- `docs/design/ai-orchestration.md` — iron rule + structured-generation + streaming.
- `docs/design/ai-operation-as-data.md` — operation-as-data (provider-agnostic; reused).
- `docs/design/generation-preview.md` — preview/save loop (the agent write-tool gate).

### External references
- Vercel AI SDK — providers, `generateText`/`streamText`/`generateObject`, `tool()`, `ToolLoopAgent`, `fullStream`, MCP: https://ai-sdk.dev , https://github.com/vercel/ai , https://vercel.com/blog/ai-sdk-6
- `@ai-sdk/openai-compatible` (`createOpenAICompatible`): https://ai-sdk.dev/providers/openai-compatible-providers
- AI SDK vs LangChain.js comparison: https://strapi.io/blog/langchain-vs-vercel-ai-sdk-vs-openai-sdk-comparison-guide
- DeepSeek OpenAI-compatible API: https://api-docs.deepseek.com/
- OpenRouter (OpenAI-compatible gateway): https://openrouter.ai/docs/quickstart
- Electron `safeStorage`: https://www.electronjs.org/docs/latest/api/safe-storage

---

## 9. Addendum (2026-07, user-corrected) — `cli-agent` is a KIND, not a Claude special case; ownership = core

**Supersedes the §1/§4.1 framing** of claude-cli/claude-pty as two special "first-class" providers.
The correction: *"本地已订阅的 agent CLI"* is a **type** with instances — claude is one entry,
**codex** (the ChatGPT-subscription `codex` CLI) is the second, future subscription CLIs
(gemini-cli, …) are more entries. The category's value proposition is generic: the user already
pays a flat subscription; the app rides it with **zero key management**.

### 9.1 The kind axis (final)
```
kind: "mock" | "cli-agent" | "http" | "managed"
        │         │             │         └ your credits gateway (managed-ai-credits.md)
        │         │             └ BYOK API-key vendors (AI SDK engine, §3/§4)
        │         └ locally installed, already-subscribed agent CLI (claude / codex / …)
        └ offline determinism (tests, default)
```
(§4.1's `kind:"cli"` is renamed `"cli-agent"` — same axis, generalized meaning.)

### 9.2 Per-CLI adapters over the OFFICIAL SDKs (researched 2026-07 — do NOT hand-roll spawn/parse)
Both vendors ship first-party TypeScript SDKs that already own the spawn/parse/session mechanics:
- **claude → `@anthropic-ai/claude-agent-sdk`** — **already in `package.json` (0.3.185) but
  currently unwired in `src/`** (only the README mentions it; the live providers still hand-spawn).
  `query({ prompt, options })` returns an async generator of typed messages (native streaming);
  sessions resume via options; safe mode via `permissionMode` / allowed-tools options.
- **codex → `@openai/codex-sdk`** — official SDK wrapping the codex CLI (JSONL-over-stdio handled
  inside): `codex.startThread()` → `thread.run(prompt)` / `runStreamed()` (typed event stream);
  threads persist in `~/.codex/sessions`, `resumeThread(id)` continues. Node 18+, server-side.
- **zod compatibility verified:** these SDKs require zod 4; the repo is on `zod ^4.4.3` ✓.

So the "generic provider" shrinks to a thin per-CLI adapter over each SDK, and the spec keeps only
what the SDKs don't unify:

```ts
// src/ai/cliAgent/spec.ts — per-CLI: what the SDKs DON'T unify
export type CliAgentSpec = {
  id: "claude" | "codex";
  detect(): Promise<{ ok: boolean; version?: string }>; // binary/SDK probe → settings UI "已检测✓"
  stripEnvKeys: string[];   // invariant 1 — claude: ANTHROPIC_API_KEY/AUTH_TOKEN · codex: OPENAI_API_KEY
  safeOptions: unknown;     // invariant 2 — claude: permissionMode + no tools · codex: sandbox read-only
  makeProvider(deps: ProviderDeps): ModelProvider;      // thin adapter: vendor SDK → our seam
};
```

| | **claude** (`@anthropic-ai/claude-agent-sdk`) | **codex** (`@openai/codex-sdk`) |
|---|---|---|
| call | `query({ prompt, options })` | `startThread()` → `run(prompt)` |
| streaming | async generator of messages (native — upgrades today's `streaming:false`) | `runStreamed()` typed events |
| session | resume via options (id-based) | `resumeThread(id)`; threads on disk |
| structured | prompt-level JSON + our `generateStructured` extract/retry | SDK output-schema options, same fallback |
| subscription auth | the CLI's login | `codex login` (ChatGPT subscription) |

The hand-spawned `claude-cli` / `claude-pty` providers stay registered as **legacy fallback
entries** until the SDK adapter proves out in daily use — then deprecate.

### 9.3 Two safety invariants — spec-enforced, tested (they survive the SDK move)
1. **Per-CLI metered-key strip.** The SDKs honor env API keys — with `ANTHROPIC_API_KEY` /
   `OPENAI_API_KEY` present they can silently switch to metered API billing. Each spec DECLARES
   the keys to strip in subscription mode (generalizes `buildSubprocessEnv` + its unit test).
   The invariant is the category's, not Claude's.
2. **Pinned non-destructive mode.** These are agent binaries (file edits / command execution). As
   chat backends they MUST be pinned via SDK options: claude `permissionMode` with no tools
   granted; codex sandbox `read-only` (+ scratch cwd). `safeOptions` is part of the spec, **not
   optional**, and unit-tested (assert the options object passed to the SDK).

### 9.4 Ownership — core (registry-shaped); plugins consume, never define transports
| Layer | Owner | Why |
|---|---|---|
| `ModelProvider` seam + provider registry + the four kind engines (CliAgent/AiSdk/Managed/mock) | **core** (`src/ai` + server) | providers run server-side: spawn subprocesses, hold secrets (safeStorage), make vendor calls — a **trust boundary**, never third-party marketplace JS; AI chat is a core capability; managed is money+compliance |
| Concrete vendor entries (DeepSeek preset, claude/codex specs) | **data/adapters registered in core** | plugin-*shaped*, core-*shipped* — the same registry philosophy as NoteType/theme |
| "Add a vendor" | **configuration, not code** | the generic `openai-compatible` entry = baseURL+key+model |
| kits/plugins | **consume only** | via operations/prompts/commands; the iron rule stays one-way and its converse holds: kits never define transports |

If a real third-party-provider need ever emerges, the registry can open as a *server-side*
extension point with explicit trust — a trust decision for later, not something to build now.

### 9.5 Phasing update
Phase 0 unchanged. **New Phase 0.5 — cli-agent kind:** wire the two OFFICIAL SDKs behind thin
`CliAgentSpec` adapters (claude SDK is already a dependency; add `@openai/codex-sdk`); detection
probes; both invariants tested; legacy claude-cli/pty kept as fallback entries. Phases 1–4
unchanged. Roadmap names these **A1 (Phase 0) · A2 (Phase 0.5) · A3 (Phase 1) · A4 (Phase 2)**.

### 9.6 Prior art (researched 2026-07) — what we adopt vs copy vs skip
| Project | What it is | Our use |
|---|---|---|
| `@anthropic-ai/claude-agent-sdk` (official) | typed `query()` over Claude Code | **adopt** — the claude spec's engine (already a dep) |
| `@openai/codex-sdk` (official) | typed threads over the codex CLI | **adopt** — the codex spec's engine |
| `ai-sdk-provider-claude-code` (ben-vargas, listed in AI SDK community providers) | wraps the claude SDK as a Vercel-AI-SDK provider — proof the "subscription CLI behind a provider interface" pattern works; docs its limits (temperature/topP ignored; app tools unsupported — the CLI runs its own) | **reference, not dependency** — we adapt the official SDKs directly behind our own seam (first-party, one fewer layer); its documented param limits inform our honest `capabilities` (cli-agent: `tools:false` for app-tools) |
| Vercel AI SDK (`ai` + `@ai-sdk/*`) | unified HTTP-vendor engine | **adopt** in A3 (§3 unchanged) |
| one-api / new-api | open-source LLM gateway with tokens/quotas/recharge | **managed-side** — see `managed-ai-credits.md` §10.4 (adopt-or-copy) |
