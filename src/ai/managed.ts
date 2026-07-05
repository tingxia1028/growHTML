// ManagedProvider (G-A3a) — the client half of the managed credits gateway
// (docs/design/managed-ai-credits.md §4.1). The provider only ever talks to OUR
// gateway (src/gateway/app.ts): it never sees a vendor, a key, or a tool. It
// carries the user's session token as `Authorization: Bearer` and consumes the
// gateway's ONE agent endpoint, POST {base}/agent/stream (SSE). There is no
// non-streaming twin, so complete() drains the same stream and returns the
// `done` message; stream() yields the `chunk` deltas as they arrive.
//
// SSE consumption is a small Web-stream reader over Node 18+'s global fetch —
// the server-side sibling of entityClient.chatStream (src/client/data), kept
// separate because this file must stay client-free (src/ai iron rule): bytes
// accumulate on a string buffer, frames split on the blank-line boundary
// (\n\n; CRLF tolerated), and each frame's `event:`/`data:` lines are folded
// per the framing the gateway emits. Robust across chunk boundaries by
// construction — nothing is parsed until a full frame is buffered.
//
// Error mapping (exact statuses per src/gateway/app.ts):
//   no baseUrl / no token       → ManagedNotConfiguredError, BEFORE any fetch
//   401 {code:"unauthorized"}   → ManagedAuthError
//   402 {code:"insufficient_balance", needed, balance}
//                               → InsufficientCreditsError (needed/balance carried)
//   any other non-2xx (400/429/5xx JSON {code, …}) and mid-stream
//   `event: error` frames       → ManagedGatewayError (status/code attached)

import type { ChatRequest, ChatResponse, ModelProvider } from "./provider";

export type ManagedDeps = {
  /** The hosted gateway origin, e.g. "https://gw.example.com" (trailing slash tolerated). */
  gatewayBaseUrl: string;
  /**
   * Live session bearer for the gateway (§4.4 phone-login access token).
   * Read PER CALL — G-A3b's login flow swaps tokens under a long-lived
   * provider without reconstruction. Null/empty → not logged in.
   */
  getSessionToken: () => string | null;
};

// --- Typed errors ------------------------------------------------------------------

/** Managed selected but unusable: no gateway URL configured, or no live session. */
export class ManagedNotConfiguredError extends Error {
  constructor(
    message = "managed AI is not configured — set the gateway URL and log in (登录) to use managed credits"
  ) {
    super(message);
    this.name = "ManagedNotConfiguredError";
  }
}

/** The gateway refused to open a hold: balance below the run's pre-authorized estimate (402). */
export class InsufficientCreditsError extends Error {
  readonly code = "insufficient_balance";
  constructor(
    readonly needed: number,
    readonly balance: number
  ) {
    super(
      `insufficient managed credits: this run needs ${needed} but the balance is ${balance} — top up (充值) to continue`
    );
    this.name = "InsufficientCreditsError";
  }
}

/** The gateway rejected the session token (401 unauthorized — missing/expired/forged). */
export class ManagedAuthError extends Error {
  constructor(message = "managed gateway rejected the session (401) — log in again (重新登录)") {
    super(message);
    this.name = "ManagedAuthError";
  }
}

/** Any other gateway failure: non-2xx JSON (400/429/5xx), a mid-stream `event: error`, or a truncated stream. */
export class ManagedGatewayError extends Error {
  readonly status?: number;
  readonly code?: string;
  constructor(message: string, options: { status?: number; code?: string } = {}) {
    super(message);
    this.name = "ManagedGatewayError";
    this.status = options.status;
    this.code = options.code;
  }
}

// --- SSE reader over fetch's Web stream --------------------------------------------

export type SseEvent = { event: string; data: string };

// Frame boundary: a blank line. The gateway emits `\n\n`; CRLF variants are
// tolerated because intermediaries (and future real deployments) may normalize
// line endings. No /g flag — exec() must return the FIRST boundary each pass.
const FRAME_BOUNDARY = /\r?\n\r?\n/;

/** Per the SSE spec, one leading space after the field colon is framing, not payload. */
function stripLeadingSpace(value: string): string {
  return value.startsWith(" ") ? value.slice(1) : value;
}

// Fold one buffered frame into {event, data}. Lines the gateway never emits
// (comments, `id:`, `retry:`) are skipped; frames without data (keep-alives)
// return null. Multi-line data joins with "\n" per the spec.
function parseSseFrame(frame: string): SseEvent | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = stripLeadingSpace(line.slice("event:".length));
    else if (line.startsWith("data:")) dataLines.push(stripLeadingSpace(line.slice("data:".length)));
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join("\n") };
}

/**
 * Decode an SSE byte stream into events. Bytes accumulate on `buffer` and only
 * complete frames (terminated by a blank line) are parsed, so `event:`/`data:`
 * lines split across network chunks — even mid-multibyte-codepoint, via the
 * streaming TextDecoder — reassemble correctly. Exported for the boundary
 * unit test; not part of the provider surface.
 */
export async function* readSseStream(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent, void, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for (;;) {
        const boundary = FRAME_BOUNDARY.exec(buffer);
        if (!boundary) break;
        const frame = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const parsed = parseSseFrame(frame);
        if (parsed) yield parsed;
      }
    }
    buffer += decoder.decode(); // flush a trailing partial code point
    if (buffer.trim()) {
      // A final frame without its terminating blank line (defensive: the
      // gateway always terminates frames, but a proxy may strip the tail).
      const parsed = parseSseFrame(buffer);
      if (parsed) yield parsed;
    }
  } finally {
    // Consumer broke out early (or threw) → release the HTTP connection.
    await reader.cancel().catch(() => undefined);
  }
}

// --- Gateway payload extraction (structural, per app.ts's exact shapes) -------------

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

async function jsonBody(response: Response): Promise<Record<string, unknown>> {
  try {
    return asRecord(await response.json());
  } catch {
    return {};
  }
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === "number" ? value : 0;
}

// --- Provider -----------------------------------------------------------------------

type ManagedConfig = { baseUrl: string; token: string };

type AgentEvent = { type: "delta"; delta: string } | { type: "done"; content: string };

export class ManagedProvider implements ModelProvider {
  readonly id = "managed";
  readonly capabilities = {
    chat: true,
    // The G-A2 gateway serves TEXT CHAT over SSE only. The §4.1 sketch's fuller
    // flags (agentic/tools/structured) arrive with the runAgent surface + the
    // G-B tool loop; until then this provider must not advertise them.
    agentic: false,
    streaming: true,
    structured: false,
    tools: false,
    // The G-A2 gateway serves TEXT chat over SSE only; vision rides the modality×vendor
    // pricing table but is not wired yet, so an image send is gated (VisionUnsupportedError)
    // before ever reaching the gateway. Flip when managed-vision lands (deferred).
    vision: false,
    kind: "managed"
  } as const;

  constructor(private readonly deps: ManagedDeps) {}

  /**
   * Resolve config or throw ManagedNotConfiguredError — always BEFORE any
   * fetch, so an unconfigured provider never touches the network. Called
   * synchronously by stream() too, so config defects surface at call time
   * rather than on first iteration.
   */
  private requireConfig(): ManagedConfig {
    const baseUrl = this.deps.gatewayBaseUrl.trim();
    if (!baseUrl) {
      throw new ManagedNotConfiguredError(
        "managed gateway URL is not configured — set STUDY_VAULT_MANAGED_GATEWAY_URL (G-A3b: app settings)"
      );
    }
    const token = this.deps.getSessionToken()?.trim();
    if (!token) {
      throw new ManagedNotConfiguredError("no managed session — log in (登录) to use managed credits");
    }
    return { baseUrl: baseUrl.replace(/\/+$/, ""), token };
  }

  /** POST /agent/stream; map pre-stream HTTP failures to typed errors; return the SSE body. */
  private async openAgentStream(config: ManagedConfig, request: ChatRequest): Promise<ReadableStream<Uint8Array>> {
    const response = await fetch(`${config.baseUrl}/agent/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.token}`
      },
      // Pass the request through as the gateway's chatRequestSchema expects
      // ({messages, context?}); JSON.stringify drops an undefined context.
      body: JSON.stringify({ messages: request.messages, context: request.context })
    });

    if (response.status === 401) {
      response.body?.cancel().catch(() => undefined);
      throw new ManagedAuthError();
    }
    if (response.status === 402) {
      // {code:"insufficient_balance", needed, balance} — emitted BEFORE any SSE
      // byte or vendor call (app.ts step 1), so failing here consumed nothing.
      const body = await jsonBody(response);
      throw new InsufficientCreditsError(numberField(body, "needed"), numberField(body, "balance"));
    }
    if (!response.ok) {
      // 400 invalid_request / 429 / 500 internal_error / … — all JSON {code, message?}.
      const body = await jsonBody(response);
      const code = stringField(body, "code");
      const message = stringField(body, "message") ?? stringField(body, "error") ?? code;
      throw new ManagedGatewayError(
        `managed gateway request failed (${response.status})${message ? `: ${message}` : ""}`,
        { status: response.status, code }
      );
    }
    if (!response.body) {
      throw new ManagedGatewayError("managed gateway returned an empty response body", {
        status: response.status
      });
    }
    return response.body;
  }

  /**
   * The shared pump behind complete() and stream(): open the SSE stream and
   * translate the gateway's frames into typed events. `event: error` frames
   * and truncated streams (no `done`) throw ManagedGatewayError; unknown event
   * names are skipped for forward compatibility (future tool/credits events).
   */
  private async *agentEvents(config: ManagedConfig, request: ChatRequest): AsyncGenerator<AgentEvent, void, void> {
    const body = await this.openAgentStream(config, request);
    let sawDone = false;
    for await (const frame of readSseStream(body)) {
      let payload: Record<string, unknown>;
      try {
        payload = asRecord(JSON.parse(frame.data));
      } catch {
        throw new ManagedGatewayError(`managed gateway sent a malformed "${frame.event}" frame`);
      }
      if (frame.event === "chunk") {
        const delta = payload.delta;
        if (typeof delta !== "string") {
          throw new ManagedGatewayError('managed gateway sent a "chunk" frame without a delta');
        }
        yield { type: "delta", delta };
      } else if (frame.event === "done") {
        const content = asRecord(payload.message).content;
        if (typeof content !== "string") {
          throw new ManagedGatewayError('managed gateway sent a "done" frame without a message');
        }
        sawDone = true;
        yield { type: "done", content };
      } else if (frame.event === "error") {
        // app.ts emits {code:"run_failed", error}; tolerate {message} too. The
        // gateway already refunded the hold — a failed run costs nothing.
        const message = stringField(payload, "error") ?? stringField(payload, "message") ?? "agent run failed";
        throw new ManagedGatewayError(`managed run failed: ${message}`, {
          code: stringField(payload, "code")
        });
      }
    }
    if (!sawDone) {
      throw new ManagedGatewayError("managed gateway stream ended without a done event");
    }
  }

  /** Consume the SSE stream fully and return the gateway's `done` message. */
  async complete(request: ChatRequest): Promise<ChatResponse> {
    const config = this.requireConfig();
    let content: string | null = null;
    for await (const event of this.agentEvents(config, request)) {
      if (event.type === "done") content = event.content;
    }
    if (content === null) {
      // Unreachable (agentEvents throws when done never arrives) — kept for narrowing.
      throw new ManagedGatewayError("managed gateway stream ended without a done event");
    }
    // The done frame's message is always the assistant reply (app.ts sends
    // {role:"assistant", content: full}); pin the role rather than trust wire data.
    return { message: { role: "assistant", content } };
  }

  /** Yield the gateway's chunk deltas; their concatenation equals the complete() text. */
  stream(request: ChatRequest): AsyncIterable<string> {
    const config = this.requireConfig(); // sync — config defects throw before iteration
    return this.streamDeltas(config, request);
  }

  private async *streamDeltas(config: ManagedConfig, request: ChatRequest): AsyncGenerator<string, void, void> {
    for await (const event of this.agentEvents(config, request)) {
      if (event.type === "delta") yield event.delta;
    }
  }
}
