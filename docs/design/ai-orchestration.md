# AI Orchestration Base — v1 (Foundation + Streaming)

The first slice of the AI orchestration engine. It does two things: it sinks the
**structured-generation engine** into a kit-agnostic base layer (`src/ai`), and it
adds **streaming chat** end-to-end (provider → server → client). It deliberately
does NOT add tool-calling/agentic loops, embeddings, or a `buildChatContext`
refactor — those are later slices.

## Iron rule: `src/ai` never imports a kit

`src/ai` owns *mechanism*; kits own *domain*. The dependency arrow points one way:
kits → `src/ai`, never the reverse. This keeps the engine reusable by any caller
(future kits, agent loops, batch jobs) and keeps the provider boundary clean.

```
            (domain: which prompt, which schema, the deterministic sample)
src/kits/structured.ts  ──┐
                          ├──►  src/ai/structured.ts   (mechanism: JSON-only
                          │       generateStructured()    inject + extract +
src/server/app.ts ────────┘       extractJson()           schema.parse + retry)
  (/api/kits/generate)            StructuredGenerationError
                                          │
                                          ▼
                                  src/ai/provider.ts  (ModelProvider boundary)
                                   mock / claude-cli / claude-pty
```

## Structured generation (the engine)

`src/ai/structured.ts` exports the kit-agnostic core:

- `generateStructured(provider, { messages, schema, sample?, contentType?, context? }, maxAttempts = 3)`
  → the validated value. It prepends a JSON-only **system** message, asks the
  provider for JSON (via `completeStructured` when the provider has it, else
  `complete()` + extraction), runs `schema.parse(extractJson(raw))`, and on a
  schema mismatch pushes a corrective user turn and re-prompts up to `maxAttempts`,
  then throws `StructuredGenerationError`.
- `extractJson(text)` — strips ``` fences, fast-paths whole-string JSON, else takes
  the first balanced `{…}` span.
- `StructuredGenerationError` — the one error type the caller maps to a 400.

`schema` is a generic `ZodTypeAny` — the engine knows nothing about content types.

### Kit wrapper (thin)

`src/kits/structured.ts` is now a thin wrapper: `generateStructuredContent` resolves
the `KitPrompt` (`getKitPrompt`) + the contentType's `NoteContentSpec.schema`
(`getNoteContentSpec`), builds the deterministic `sample` (the prompt's `mockContent`
or the spec's `createDefault`), and delegates to `generateStructured`. It re-exports
`extractJson` / `StructuredGenerationError` so existing importers (and tests) keep
their import path. `/api/kits/generate` behavior and response are unchanged.

## Provider interface + capabilities

`ProviderCapabilities` now carries `streaming: boolean` alongside `chat` / `agentic`,
and `ModelProvider` gains an optional `stream?(request): AsyncIterable<string>`.

| Provider | chat | agentic | streaming | stream() |
| --- | --- | --- | --- | --- |
| `mock` | ✓ | ✗ | ✓ | yields the deterministic answer in word-ish chunks |
| `claude-cli` | ✓ | ✓ | ✗ | — (server wraps `complete()` as one chunk) |
| `claude-pty` | ✓ | ✓ | ✗ | — (server wraps `complete()` as one chunk) |

The mock's `complete()` and `stream()` share one private `answer()`, so the streamed
chunk concatenation is **byte-identical** to the one-shot reply. Chunking via
`/\S+\s*/g` keeps whitespace so the chunks rejoin exactly. An optional per-chunk
delay (`STUDY_VAULT_MOCK_STREAM_DELAY_MS`, default 0) spaces chunks out so a browser
e2e can watch the reply fill in; it never changes the content.

Subscription mode still strips `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN`
(`buildSubprocessEnv`) — unchanged.

## Streaming transport

### Server — `POST /api/chat/stream` (new; `/api/chat` untouched)

Server-Sent Events (`text/event-stream`). Request body is the same
`chatRequestSchema` as `/api/chat`, and is validated **before** any byte is written,
so a bad request still surfaces as a `400` (identical to `/api/chat`). Frames:

- `event: chunk` / `data: {"delta": "..."}` — one per incremental piece.
- `event: done`  / `data: {"message": {"role":"assistant","content": "<full>"}, "provider": "<id>"}` — once, at the end.
- `event: error` / `data: {"error": "..."}` — if generation throws *after* headers are sent.

If `provider.stream` exists, the server iterates it and accumulates `full`; otherwise
it calls `complete()` and emits the whole reply as a single `chunk`. Either way the
`done` message content equals the concatenated chunks.

### Client — `entityClient.chatStream(input, onDelta)`

`fetch` + `ReadableStream` reader + `TextDecoder`; splits on the SSE `\n\n` frame
delimiter, invokes `onDelta(delta)` per `chunk`, resolves with the `done`
`{ message, provider }`. **Fallback:** if the endpoint is unavailable (non-OK,
non-400, or no body) it degrades to the non-streaming `chat()`. A `400` surfaces as
an error.

### Command + UI

`anchor.ask-ai` feature-detects streaming: when the host wired both
`client.chatStream` and an `onAssistantChunk` action it streams, otherwise it calls
`chat()`. `onAssistantChunk` appends each delta to the trailing assistant message
(or starts one) — the accumulated text equals the final reply, so no separate
finalize step is needed. If streaming produced **no** deltas (the client fell back),
the command appends the final message via `onAssistantMessage` instead. The chat log
(`.chat-log .chat-msg.chat-assistant`) renders the message as it grows.

## Tested

- Unit: base-engine parse/validate/retry/exhaustion + system-message injection +
  `completeStructured` path (`src/ai/structured.test.ts`); mock `streaming` capability
  + multi-chunk stream that rejoins to `complete()` (`src/ai/ai.test.ts`); the thin
  wrapper still produces correct structure (`src/kits/structured.test.ts`, unchanged
  behavior); SSE endpoint chunk/done framing + `400` on empty body
  (`src/server/app.test.ts`).
- E2E (web, mock): `e2e/streaming-chat.spec.ts` — reply arrives progressively over
  `text/event-stream` with the deterministic final answer; existing AI chat loop and
  textbook AI specs stay green.

## Manual verification with `claude-cli` (real subscription)

`claude-cli` sets `streaming: false`, so the server's single-chunk fallback path is
what runs against a real subscription. To verify by hand:

1. Restart the client with the real provider:
   `STUDY_VAULT_ROOT=.vault-dev STUDY_VAULT_AI_PROVIDER=claude-cli npm run electron`
2. Open a source, select a passage, ask a question in **Ask AI** mode.
3. Expect: the reply renders as one block (no progressive fill, since `claude-cli`
   has no `stream()`), the answer references the passage, and no metered API key is
   used (subscription OAuth; `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` stripped).
4. Confirm `/api/kits/generate` (e.g. the textbook Explain/Practice actions) still
   produces validated structured cards.

## Deferred (explicitly out of scope for v1)

- Tool-calling / agentic loops (provider-internal tool use, multi-step plans).
- Embeddings / semantic retrieval.
- `buildChatContext` refactor (kept as-is).
- Real-provider native streaming (`claude-cli`/`claude-pty` set `streaming:false`;
  a token-level stream from the CLI/PTY is a later slice).
