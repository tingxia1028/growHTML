// cli-agent adapter: claude over the OFFICIAL `@anthropic-ai/claude-agent-sdk`
// (docs/design/multi-provider-ai-agent.md §9.2). The SDK owns spawn/parse/
// session mechanics — `query({ prompt, options })` returns an async generator
// of typed messages — so this file is only the thin seam onto ModelProvider
// plus the two §9.3 invariants:
//
//   Invariant 1 (key strip): `Options.env` REPLACES the subprocess environment
//   entirely (per the SDK typings: "it is not merged with `process.env`"), so
//   passing buildCleanEnv(base, [ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN])
//   guarantees the metered keys never reach the CLI → subscription OAuth only.
//
//   Invariant 2 (pinned non-destructive): CLAUDE_SAFE_OPTIONS grants NO tools
//   (`tools: []` — "Disable all built-in tools"), never prompts and denies
//   anything not pre-approved (`permissionMode: "dontAsk"`), ignores all
//   filesystem settings that could re-add tools/hooks (`settingSources: []` —
//   "SDK isolation mode") and external MCP servers (`strictMcpConfig: true`),
//   and anchors the session in a throwaway scratch cwd.
//
// The module NEVER imports the SDK eagerly: the package is ESM-only and this
// file is reachable from the CJS electron main bundle via src/ai/index, so the
// SDK is loaded with a lazy dynamic import() on first use (also what lets
// vitest swap it with vi.mock without any real subprocess).

import type { Options } from "@anthropic-ai/claude-agent-sdk";
import type { ChatRequest, ChatResponse, ModelProvider } from "../provider";
import {
  buildCleanEnv,
  defaultScratchDir,
  ensureScratchDir,
  probeCliVersion,
  shapeTurn,
  type CliAgentSpec,
  type ProviderDeps
} from "./spec";

/** Invariant 1 — metered Anthropic keys the SDK subprocess must never see. */
export const CLAUDE_STRIP_ENV_KEYS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"] as const;

/**
 * Invariant 2 — the exact SDK option names, from sdk.d.ts (0.3.185):
 * - `tools?: string[] | {type:'preset';…}` — "`[]` (empty array) - Disable all built-in tools"
 * - `allowedTools?: string[]` — auto-allow nothing (belt to `tools`' suspenders)
 * - `permissionMode?: PermissionMode` — `'dontAsk'`: "Don't prompt for
 *   permissions, deny if not pre-approved" (headless-safe: nothing can block on
 *   an interactive prompt, nothing unexpected runs)
 * - `settingSources?: SettingSource[]` — "Pass `[]` to disable filesystem
 *   settings (SDK isolation mode)" so user/project settings can't re-grant tools
 * - `strictMcpConfig?: boolean` — ignore all external MCP configurations
 * `persistSession` stays at its default (true): resume-across-turns needs the
 * session on disk. The per-instance scratch `cwd` is added by the provider.
 */
export const CLAUDE_SAFE_OPTIONS: Options = Object.freeze({
  tools: [],
  allowedTools: [],
  permissionMode: "dontAsk",
  settingSources: [],
  strictMcpConfig: true
});

type ClaudeQueryFn = typeof import("@anthropic-ai/claude-agent-sdk").query;

// Lazy ESM load (see module comment). vi.mock intercepts this in tests.
async function loadQuery(): Promise<ClaudeQueryFn> {
  const sdk = await import("@anthropic-ai/claude-agent-sdk");
  return sdk.query;
}

// The SDK message payloads are typed against @anthropic-ai/sdk's beta surface;
// extract text structurally so this adapter neither deep-imports vendor types
// nor breaks if a block shape it doesn't care about changes.
function assistantTextOf(message: { message?: unknown }): string {
  const content = (message.message as { content?: unknown } | undefined)?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  let text = "";
  for (const block of content as Array<{ type?: unknown; text?: unknown }>) {
    if (block && block.type === "text" && typeof block.text === "string") text += block.text;
  }
  return text;
}

// SDKPartialAssistantMessage.event is a raw Anthropic stream event; the text
// increments are `content_block_delta` events carrying a `text_delta`.
function textDeltaOf(event: unknown): string {
  const streamEvent = event as { type?: unknown; delta?: { type?: unknown; text?: unknown } } | undefined;
  if (
    streamEvent?.type === "content_block_delta" &&
    streamEvent.delta?.type === "text_delta" &&
    typeof streamEvent.delta.text === "string"
  ) {
    return streamEvent.delta.text;
  }
  return "";
}

function describeResultError(subtype: string, errors: unknown): string {
  const details = Array.isArray(errors) ? errors.filter((e): e is string => typeof e === "string") : [];
  return `claude-agent query failed (${subtype})${details.length > 0 ? `: ${details.join("; ")}` : ""}`;
}

export type ClaudeAgentProviderOptions = {
  /** Injected for tests; defaults to the real `process.env`. */
  baseEnv?: NodeJS.ProcessEnv;
  /** Throwaway cwd for the agent (invariant 2); defaults to the shared scratch dir. */
  scratchDir?: string;
};

/**
 * `ModelProvider` over the official Claude Agent SDK. Streaming is native
 * (an upgrade over the legacy hand-spawned claude-cli's `streaming: false`);
 * multi-turn context rides the SDK session facility: the first turn lets the
 * CLI mint a session (captured from every message's `session_id`), later turns
 * pass `Options.resume` — "Session ID to resume. Loads the conversation
 * history from the specified session." A fresh chat (single user turn) drops
 * the held id, exactly like the legacy provider's session rotation.
 */
export class ClaudeAgentProvider implements ModelProvider {
  readonly id = "claude-agent";
  readonly capabilities = {
    chat: true,
    // The binary runs ITS OWN tools in general (agentic), but safe mode grants
    // none of them here and it accepts no app-defined tools (tools: false); no
    // native JSON mode → structured falls back to complete()+extract.
    agentic: true,
    streaming: true,
    structured: false,
    tools: false,
    // Text prompt only through this seam; image parts degrade to `[image]` (a native
    // Agent-SDK image-block adapter is deferred to a later phase).
    vision: false,
    kind: "cli-agent"
  } as const;

  private readonly baseEnv: NodeJS.ProcessEnv;
  private readonly scratchDir: string;
  private sessionId: string | null = null;

  constructor(options: ClaudeAgentProviderOptions = {}) {
    this.baseEnv = options.baseEnv ?? process.env;
    this.scratchDir = options.scratchDir ?? defaultScratchDir();
  }

  private buildOptions(resuming: boolean): Options {
    return {
      ...CLAUDE_SAFE_OPTIONS,
      cwd: ensureScratchDir(this.scratchDir),
      env: buildCleanEnv(this.baseEnv, CLAUDE_STRIP_ENV_KEYS),
      ...(resuming && this.sessionId ? { resume: this.sessionId } : {})
    };
  }

  /** Every SDK message carries `session_id` — remember it for the next turn's `resume`. */
  private noteSession(message: unknown): void {
    const sessionId = (message as { session_id?: unknown }).session_id;
    if (typeof sessionId === "string" && sessionId.length > 0) this.sessionId = sessionId;
  }

  async complete(request: ChatRequest): Promise<ChatResponse> {
    const query = await loadQuery();
    const { resuming, prompt } = shapeTurn(request, this.sessionId !== null);
    if (!resuming) this.sessionId = null; // fresh chat → let the CLI mint a new session

    let assistantText = "";
    let resultText: string | null = null;
    for await (const message of query({ prompt, options: this.buildOptions(resuming) })) {
      this.noteSession(message);
      if (message.type === "assistant" && !message.parent_tool_use_id) {
        assistantText += assistantTextOf(message);
      } else if (message.type === "result") {
        if (message.subtype === "success") resultText = message.result;
        else throw new Error(describeResultError(message.subtype, message.errors));
      }
    }

    // The concatenated top-level assistant text IS the reply; the result
    // message is only a fallback (e.g. if a future SDK stops echoing blocks).
    const content = (assistantText || resultText || "").trim();
    return { message: { role: "assistant", content } };
  }

  async *stream(request: ChatRequest): AsyncIterable<string> {
    const query = await loadQuery();
    const { resuming, prompt } = shapeTurn(request, this.sessionId !== null);
    if (!resuming) this.sessionId = null;

    // `includePartialMessages` (sdk.d.ts): "When true, `SDKPartialAssistantMessage`
    // events will be emitted during streaming."
    const options: Options = { ...this.buildOptions(resuming), includePartialMessages: true };

    let streamedAny = false;
    let assistantText = "";
    let resultText: string | null = null;
    for await (const message of query({ prompt, options })) {
      this.noteSession(message);
      if (message.type === "stream_event") {
        if (message.parent_tool_use_id) continue; // subagent chatter is not the reply
        const delta = textDeltaOf(message.event);
        if (delta) {
          streamedAny = true;
          yield delta;
        }
      } else if (message.type === "assistant" && !message.parent_tool_use_id) {
        assistantText += assistantTextOf(message);
      } else if (message.type === "result") {
        if (message.subtype === "success") resultText = message.result;
        else throw new Error(describeResultError(message.subtype, message.errors));
      }
    }

    // Defensive: if no partial events arrived, emit the reply as one chunk so
    // callers still receive the full message (same contract as the endpoint's
    // own non-streaming fallback).
    if (!streamedAny) {
      const fallback = (assistantText || resultText || "").trim();
      if (fallback) yield fallback;
    }
  }
}

/** §9.2 spec entry for claude — consumed by src/ai/index.ts registration. */
export const claudeAgentSpec: CliAgentSpec<Options> = {
  id: "claude",
  detect: () => probeCliVersion("claude"),
  stripEnvKeys: CLAUDE_STRIP_ENV_KEYS,
  safeOptions: CLAUDE_SAFE_OPTIONS,
  makeProvider: ({ env }: ProviderDeps) => new ClaudeAgentProvider({ baseEnv: env })
};
