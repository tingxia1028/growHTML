// cli-agent adapter: codex over the OFFICIAL `@openai/codex-sdk`
// (docs/design/multi-provider-ai-agent.md §9.2). The SDK wraps the locally
// installed, ChatGPT-subscription `codex` CLI (JSONL-over-stdio handled
// inside): `new Codex()` → `startThread()` → `run(prompt)` / `runStreamed()`;
// threads persist in ~/.codex/sessions and `resumeThread(id)` continues one.
// This file is the thin seam onto ModelProvider plus the two §9.3 invariants:
//
//   Invariant 1 (key strip): `CodexOptions.env` — per the SDK typings,
//   "Environment variables passed to the Codex CLI process. When provided,
//   the SDK will not inherit variables from `process.env`." — so passing
//   buildCleanEnv(base, [OPENAI_API_KEY]) guarantees the metered key never
//   reaches the CLI → it authenticates with `codex login` (subscription) only.
//
//   Invariant 2 (pinned non-destructive): every thread is started with
//   `sandboxMode: "read-only"`, a throwaway `workingDirectory`, and
//   `skipGitRepoCheck: true` (the scratch dir is no repo), plus
//   `approvalPolicy: "never"` so a headless chat can neither block on an
//   approval prompt nor escalate past the sandbox.
//
// Like the claude adapter, the ESM-only SDK is loaded with a lazy dynamic
// import() (this module is reachable from the CJS electron bundle), which is
// also what lets vitest swap it with vi.mock — tests never spawn the CLI.

import type { Codex, Thread, ThreadItem, ThreadOptions } from "@openai/codex-sdk";
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

/** Invariant 1 — with OPENAI_API_KEY present the CLI can bill the metered API. */
export const CODEX_STRIP_ENV_KEYS = ["OPENAI_API_KEY"] as const;

/**
 * Invariant 2 — the exact `ThreadOptions` names from dist/index.d.ts (0.142.5):
 * `sandboxMode?: "read-only" | "workspace-write" | "danger-full-access"`,
 * `skipGitRepoCheck?: boolean`, `approvalPolicy?: "never" | "on-request" |
 * "on-failure" | "untrusted"`. The per-instance scratch `workingDirectory`
 * is added by the provider.
 */
export const CODEX_SAFE_THREAD_OPTIONS: ThreadOptions = Object.freeze({
  sandboxMode: "read-only",
  skipGitRepoCheck: true,
  approvalPolicy: "never"
});

type CodexModule = typeof import("@openai/codex-sdk");

// Lazy ESM load (see module comment). vi.mock intercepts this in tests.
async function loadCodexModule(): Promise<CodexModule> {
  return import("@openai/codex-sdk");
}

/**
 * Suffix-delta an `agent_message` item: codex streams the item's FULL text on
 * each `item.started/updated/completed`, so the yield-able increment is the
 * part that extends what this turn already emitted for that item id (a
 * rewritten prefix — not observed in practice — falls back to the full text).
 */
function agentMessageDelta(item: ThreadItem, emitted: Map<string, string>): string {
  if (item.type !== "agent_message" || typeof item.text !== "string") return "";
  const previous = emitted.get(item.id) ?? "";
  emitted.set(item.id, item.text);
  return item.text.startsWith(previous) ? item.text.slice(previous.length) : item.text;
}

export type CodexAgentProviderOptions = {
  /** Injected for tests; defaults to the real `process.env`. */
  baseEnv?: NodeJS.ProcessEnv;
  /** Throwaway workingDirectory for the sandbox (invariant 2). */
  scratchDir?: string;
  /**
   * Reattach to a thread persisted in ~/.codex/sessions (e.g. a held id that
   * outlived this process). The next non-fresh turn goes through
   * `codex.resumeThread(id, …)` instead of `startThread()`.
   */
  resumeThreadId?: string;
};

/**
 * `ModelProvider` over the official Codex SDK. One SDK thread per provider
 * instance carries multi-turn context: `startThread()` once, `run(prompt)`
 * per turn (the Thread object stays live between calls, and its id — populated
 * after the first turn — is kept so a held id can always be resumed). A fresh
 * chat (single user turn) starts a new thread, mirroring the shared cli-agent
 * session rules in spec.ts.
 */
export class CodexAgentProvider implements ModelProvider {
  readonly id = "codex";
  readonly capabilities = {
    chat: true,
    // The codex binary runs ITS OWN tools (agentic) — pinned read-only here —
    // and accepts no app-defined tools; no native JSON mode is exposed through
    // this chat seam → structured falls back to complete()+extract.
    agentic: true,
    streaming: true,
    structured: false,
    tools: false,
    // Text prompt only through this seam; image parts degrade to `[image]`.
    vision: false,
    kind: "cli-agent"
  } as const;

  private readonly baseEnv: NodeJS.ProcessEnv;
  private readonly scratchDir: string;
  private codex: Codex | null = null;
  private thread: Thread | null = null;
  private threadId: string | null = null;

  constructor(options: CodexAgentProviderOptions = {}) {
    this.baseEnv = options.baseEnv ?? process.env;
    this.scratchDir = options.scratchDir ?? defaultScratchDir();
    this.threadId = options.resumeThreadId ?? null;
  }

  private async getCodex(): Promise<Codex> {
    if (!this.codex) {
      const { Codex: CodexClient } = await loadCodexModule();
      // Invariant 1 enforced here: a provided env REPLACES process.env for the
      // CLI subprocess (see module comment), and ours is pre-stripped.
      this.codex = new CodexClient({ env: buildCleanEnv(this.baseEnv, CODEX_STRIP_ENV_KEYS) });
    }
    return this.codex;
  }

  private threadOptions(): ThreadOptions {
    return { ...CODEX_SAFE_THREAD_OPTIONS, workingDirectory: ensureScratchDir(this.scratchDir) };
  }

  private hasLiveSession(): boolean {
    return this.thread !== null || this.threadId !== null;
  }

  private async resolveThread(resuming: boolean): Promise<Thread> {
    const codex = await this.getCodex();
    if (resuming && this.thread) return this.thread;
    if (resuming && this.threadId) {
      // Held id but no live Thread object → reattach to the persisted thread.
      this.thread = codex.resumeThread(this.threadId, this.threadOptions());
      return this.thread;
    }
    // Fresh chat: drop any previous conversation and start a new thread.
    this.thread = codex.startThread(this.threadOptions());
    this.threadId = null;
    return this.thread;
  }

  async complete(request: ChatRequest): Promise<ChatResponse> {
    const { resuming, prompt } = shapeTurn(request, this.hasLiveSession());
    const thread = await this.resolveThread(resuming);
    const turn = await thread.run(prompt);
    this.threadId = thread.id ?? this.threadId;
    return { message: { role: "assistant", content: turn.finalResponse.trim() } };
  }

  async *stream(request: ChatRequest): AsyncIterable<string> {
    const { resuming, prompt } = shapeTurn(request, this.hasLiveSession());
    const thread = await this.resolveThread(resuming);
    const { events } = await thread.runStreamed(prompt);

    const emitted = new Map<string, string>();
    for await (const event of events) {
      if (event.type === "thread.started") {
        this.threadId = event.thread_id;
      } else if (event.type === "item.started" || event.type === "item.updated" || event.type === "item.completed") {
        const delta = agentMessageDelta(event.item, emitted);
        if (delta) yield delta;
      } else if (event.type === "turn.failed") {
        throw new Error(`codex turn failed: ${event.error.message}`);
      } else if (event.type === "error") {
        throw new Error(`codex stream error: ${event.message}`);
      }
    }
    this.threadId = thread.id ?? this.threadId;
  }
}

/** §9.2 spec entry for codex — consumed by src/ai/index.ts registration. */
export const codexAgentSpec: CliAgentSpec<ThreadOptions> = {
  id: "codex",
  detect: () => probeCliVersion("codex"),
  stripEnvKeys: CODEX_STRIP_ENV_KEYS,
  safeOptions: CODEX_SAFE_THREAD_OPTIONS,
  makeProvider: ({ env }: ProviderDeps) => new CodexAgentProvider({ baseEnv: env })
};
