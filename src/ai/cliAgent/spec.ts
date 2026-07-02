// cli-agent kind — the per-CLI contract (docs/design/multi-provider-ai-agent.md §9.2)
// plus the pieces the vendor SDKs DON'T unify, shared by every adapter:
//
//   1. buildCleanEnv       — invariant 1 (§9.3): strip the vendor's metered API keys
//                            so a subscription CLI can never silently bill the API.
//   2. prompt shaping      — weave ChatContext (source/quote/context) into prompt
//                            text and pick turn-vs-transcript per session state,
//                            mirroring the legacy claudeCliProvider byte-for-byte
//                            (the context blocks live in the shared
//                            src/ai/buildPrompt.ts so http providers weave the
//                            SAME text; cliAgent must not import legacy).
//   3. probeCliVersion     — `<cli> --version` detection probe with an injectable
//                            spawn so tests never launch a real binary.
//   4. scratch dir helpers — invariant 2 (§9.3) anchors each agent in a throwaway
//                            cwd instead of the repo/vault.
//
// Concrete specs live next door (claude.ts / codex.ts) and are registered by
// src/ai/index.ts; the registry itself stays pure (iron rule unchanged).

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { passageBlock, sourceBlock } from "../buildPrompt";
import type { ChatRequest, ModelProvider } from "../provider";

export type CliAgentDetectResult = { ok: boolean; version?: string };

/** What a spec's `makeProvider` may need. Mirrors the registry's ProviderContext. */
export type ProviderDeps = { env: NodeJS.ProcessEnv };

/**
 * Per-CLI adapter contract (§9.2): everything the OFFICIAL vendor SDKs don't
 * unify. `safeOptions` (invariant 2) is SDK-specific — claude pins tool-less
 * options for `query()`, codex pins a read-only sandbox for `startThread()` —
 * so the field is generic; both invariants are unit-tested per adapter.
 */
export type CliAgentSpec<SafeOptions = unknown> = {
  id: "claude" | "codex";
  /** Binary/SDK availability probe → settings UI "已检测✓". Never spawned in tests. */
  detect(): Promise<CliAgentDetectResult>;
  /** Invariant 1 — metered keys that must never reach the subprocess. */
  stripEnvKeys: readonly string[];
  /** Invariant 2 — the SDK options that pin the agent non-destructive. */
  safeOptions: SafeOptions;
  makeProvider(deps: ProviderDeps): ModelProvider;
};

// ---------------------------------------------------------------------------
// Invariant 1 — clean subprocess env
// ---------------------------------------------------------------------------

/**
 * Copy `base` minus the spec's metered keys (exact-name match), dropping
 * `undefined` values so the result satisfies both SDKs' env option types
 * (codex requires `Record<string, string>`). Generalizes the legacy
 * claudeCliProvider.buildSubprocessEnv to arbitrary key sets. Never mutates
 * `base`. Both SDKs treat a provided env as a FULL REPLACEMENT (no
 * process.env merge), so passing this object is what enforces the strip.
 */
export function buildCleanEnv(
  base: NodeJS.ProcessEnv,
  stripEnvKeys: readonly string[]
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined) env[key] = value;
  }
  for (const key of stripEnvKeys) delete env[key];
  return env;
}

// ---------------------------------------------------------------------------
// Prompt shaping — same context weaving as the legacy claudeCliProvider
// ---------------------------------------------------------------------------

function lastUserMessage(request: ChatRequest): string {
  return [...request.messages].reverse().find((message) => message.role === "user")?.content ?? "";
}

/**
 * Full transcript — used only to seed a fresh session that already has history
 * (e.g. the server restarted mid-conversation, so the CLI can't resume it).
 * The source/passage blocks come from the shared buildPrompt module.
 */
export function flattenPrompt(request: ChatRequest): string {
  const parts = [sourceBlock(request.context), passageBlock(request.context)].filter(Boolean);
  for (const message of request.messages) {
    parts.push(`${message.role.toUpperCase()}: ${message.content}`);
  }
  return parts.join("\n\n");
}

/**
 * A single turn: just the new user message, plus the source identity (first turn
 * only) and the current passage+context (selection can change between turns).
 */
export function turnPrompt(request: ChatRequest, firstTurn: boolean): string {
  const parts = [
    firstTurn ? sourceBlock(request.context) : "",
    passageBlock(request.context),
    lastUserMessage(request)
  ].filter(Boolean);
  return parts.join("\n\n");
}

export type ShapedTurn = {
  /** True → continue the live vendor session with just the new turn. */
  resuming: boolean;
  prompt: string;
};

/**
 * Session-aware prompt choice, shared by every cli-agent adapter (same rules
 * as the legacy claudeCliProvider):
 * - later turn + live session      → resume with the single-turn prompt;
 * - later turn but session lost    → fresh session seeded with the transcript;
 * - first turn (fresh chat — the client clears history on source switch)
 *                                  → fresh session, single-turn prompt + source.
 */
export function shapeTurn(request: ChatRequest, hasLiveSession: boolean): ShapedTurn {
  const userTurns = request.messages.filter((message) => message.role === "user").length;
  const resuming = userTurns > 1 && hasLiveSession;
  if (resuming) return { resuming, prompt: turnPrompt(request, false) };
  return { resuming, prompt: userTurns > 1 ? flattenPrompt(request) : turnPrompt(request, true) };
}

// ---------------------------------------------------------------------------
// detect() — version probe with injectable spawn (tests never launch a CLI)
// ---------------------------------------------------------------------------

/** Structural slice of ChildProcess the probe needs — lets tests fake it. */
export type SpawnedProbe = {
  stdout?: { on(event: "data", listener: (chunk: unknown) => void): unknown } | null;
  on(event: string, listener: (...args: never[]) => void): unknown;
  kill(): unknown;
};

export type SpawnProbeFn = (
  command: string,
  args: readonly string[],
  options: { shell: boolean; windowsHide: boolean }
) => SpawnedProbe;

export type ProbeDeps = { spawnFn?: SpawnProbeFn; timeoutMs?: number };

/**
 * Probe `<command> --version` with a short timeout. Resolves `{ok:false}` on
 * spawn failure / non-zero exit / timeout — never rejects (detection is a
 * status light, not a gate). Windows: agent CLIs are `.cmd` shims, so launch
 * through the shell exactly like the legacy provider.
 */
export function probeCliVersion(command: string, deps: ProbeDeps = {}): Promise<CliAgentDetectResult> {
  const spawnFn = deps.spawnFn ?? (spawn as unknown as SpawnProbeFn);
  const timeoutMs = deps.timeoutMs ?? 3000;

  return new Promise((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const done = (result: CliAgentDetectResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };

    let child: SpawnedProbe;
    try {
      child = spawnFn(command, ["--version"], { shell: process.platform === "win32", windowsHide: true });
    } catch {
      done({ ok: false });
      return;
    }

    timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // best effort — the probe already failed
      }
      done({ ok: false });
    }, timeoutMs);
    timer.unref?.();

    let stdout = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.on("error", () => done({ ok: false }));
    child.on("close", (code: number | null) => {
      if (code === 0) done({ ok: true, version: stdout.trim() || undefined });
      else done({ ok: false });
    });
  });
}

// ---------------------------------------------------------------------------
// Invariant 2 support — scratch working directory
// ---------------------------------------------------------------------------

/** Throwaway cwd shared by cli-agent adapters — never the repo or the vault. */
export function defaultScratchDir(): string {
  return join(tmpdir(), "growhtml-cli-agent-scratch");
}

/** Create the scratch dir if missing (spawn with a non-existent cwd fails). */
export function ensureScratchDir(dir: string): string {
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    // Leave real failures to the SDK spawn, which reports them with context.
  }
  return dir;
}
