import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatRequest } from "../provider";

// The OFFICIAL SDK is mocked at the module boundary — the adapter loads it via
// a lazy dynamic import(), which vitest intercepts. No real codex CLI is run.
const codexState = vi.hoisted(() => {
  type FakeThread = {
    id: string | null;
    runInputs: unknown[];
    streamedInputs: unknown[];
    nextFinalResponse: string;
    nextEvents: unknown[];
    run(input: unknown): Promise<{ items: unknown[]; finalResponse: string; usage: null }>;
    runStreamed(input: unknown): Promise<{ events: AsyncGenerator<unknown> }>;
  };

  const state = {
    ctorOptions: [] as unknown[],
    startThreadOptions: [] as unknown[],
    resumeCalls: [] as Array<{ id: string; options: unknown }>,
    threads: [] as FakeThread[],
    threadCounter: 0,
    reset() {
      state.ctorOptions.length = 0;
      state.startThreadOptions.length = 0;
      state.resumeCalls.length = 0;
      state.threads.length = 0;
      state.threadCounter = 0;
    }
  };

  function makeThread(id: string | null): FakeThread {
    const thread: FakeThread = {
      id,
      runInputs: [],
      streamedInputs: [],
      nextFinalResponse: "final answer",
      nextEvents: [],
      async run(input: unknown) {
        thread.runInputs.push(input);
        if (!thread.id) thread.id = `thread-${++state.threadCounter}`;
        return { items: [], finalResponse: thread.nextFinalResponse, usage: null };
      },
      async runStreamed(input: unknown) {
        thread.streamedInputs.push(input);
        const events = thread.nextEvents;
        return {
          events: (async function* () {
            for (const event of events) yield event;
          })()
        };
      }
    };
    state.threads.push(thread);
    return thread;
  }

  class FakeCodex {
    constructor(options?: unknown) {
      state.ctorOptions.push(options);
    }
    startThread(options?: unknown): FakeThread {
      state.startThreadOptions.push(options);
      return makeThread(null);
    }
    resumeThread(id: string, options?: unknown): FakeThread {
      state.resumeCalls.push({ id, options });
      return makeThread(id);
    }
  }

  return { ...state, FakeCodex };
});

vi.mock("@openai/codex-sdk", () => ({ Codex: codexState.FakeCodex }));

import { CODEX_SAFE_THREAD_OPTIONS, CODEX_STRIP_ENV_KEYS, CodexAgentProvider, codexAgentSpec } from "./codex";

const scratchDir = join(tmpdir(), "growhtml-codex-adapter-test-scratch");
afterAll(() => rmSync(scratchDir, { recursive: true, force: true }));

const baseEnv: NodeJS.ProcessEnv = { OPENAI_API_KEY: "sk-metered", PATH: "C:\\bin", HOME: "/home/u" };

function makeProvider(resumeThreadId?: string): CodexAgentProvider {
  return new CodexAgentProvider({ baseEnv, scratchDir, resumeThreadId });
}

beforeEach(() => codexState.reset());

const firstTurn: ChatRequest = { messages: [{ role: "user", content: "Q1" }] };
const secondTurn: ChatRequest = {
  messages: [
    { role: "user", content: "Q1" },
    { role: "assistant", content: "A1" },
    { role: "user", content: "Q2" }
  ]
};

describe("CodexAgentProvider — safe mode + env (the two §9.3 invariants)", () => {
  it("constructs Codex with a REPLACEMENT env: OPENAI_API_KEY absent, the rest intact", async () => {
    await makeProvider().complete(firstTurn);

    expect(codexState.ctorOptions).toHaveLength(1);
    const options = codexState.ctorOptions[0] as { env?: Record<string, string> };
    // CodexOptions.env: "When provided, the SDK will not inherit variables
    // from process.env" — so this object IS the CLI subprocess env.
    expect(options.env).toEqual({ PATH: "C:\\bin", HOME: "/home/u" });
    expect(options.env).not.toHaveProperty("OPENAI_API_KEY");
  });

  it("starts every thread sandboxed read-only in a scratch working dir, skipping the git check", async () => {
    await makeProvider().complete(firstTurn);

    expect(codexState.startThreadOptions).toEqual([
      {
        sandboxMode: "read-only",
        skipGitRepoCheck: true,
        approvalPolicy: "never",
        workingDirectory: scratchDir
      }
    ]);
    expect(existsSync(scratchDir)).toBe(true); // scratch dir actually exists for the spawn
  });
});

describe("CodexAgentProvider.complete", () => {
  it("maps thread.run()'s finalResponse to the assistant message", async () => {
    const provider = makeProvider();
    const response = await provider.complete(firstTurn);

    expect(response.message).toEqual({ role: "assistant", content: "final answer" });
    expect(codexState.threads[0].runInputs).toEqual(["Q1"]);
  });

  it("reuses ONE thread across turns: startThread once, then run(new turn) only", async () => {
    const provider = makeProvider();
    await provider.complete(firstTurn);
    await provider.complete(secondTurn);

    expect(codexState.startThreadOptions).toHaveLength(1); // no second thread
    expect(codexState.ctorOptions).toHaveLength(1); // and one Codex client
    expect(codexState.threads[0].runInputs).toEqual(["Q1", "Q2"]); // resumed turn = just the new message
  });

  it("a fresh chat (single user turn) starts a NEW thread instead of reusing the old one", async () => {
    const provider = makeProvider();
    await provider.complete(firstTurn);
    await provider.complete({ messages: [{ role: "user", content: "New chat" }] });

    expect(codexState.startThreadOptions).toHaveLength(2);
    expect(codexState.threads[1].runInputs).toEqual(["New chat"]);
  });

  it("resumes a persisted thread id via codex.resumeThread with the same safe options", async () => {
    const provider = makeProvider("t-persisted");
    await provider.complete(secondTurn); // history exists + held id → resume, not re-seed

    expect(codexState.resumeCalls).toEqual([
      {
        id: "t-persisted",
        options: {
          sandboxMode: "read-only",
          skipGitRepoCheck: true,
          approvalPolicy: "never",
          workingDirectory: scratchDir
        }
      }
    ]);
    expect(codexState.startThreadOptions).toHaveLength(0);
    expect(codexState.threads[0].runInputs).toEqual(["Q2"]);
  });

  it("with history but no live session, seeds a new thread with the flattened transcript", async () => {
    await makeProvider().complete(secondTurn);
    expect(codexState.startThreadOptions).toHaveLength(1);
    expect(codexState.threads[0].runInputs).toEqual(["USER: Q1\n\nASSISTANT: A1\n\nUSER: Q2"]);
  });
});

describe("CodexAgentProvider.stream", () => {
  it("maps runStreamed() agent_message events to suffix text deltas, in order", async () => {
    const provider = makeProvider();
    await provider.complete(firstTurn); // create the thread, then script its stream
    const thread = codexState.threads[0];
    thread.nextEvents = [
      { type: "thread.started", thread_id: "t-stream" },
      { type: "turn.started" },
      { type: "item.started", item: { id: "m1", type: "agent_message", text: "" } },
      { type: "item.updated", item: { id: "m1", type: "agent_message", text: "Hel" } },
      { type: "item.completed", item: { id: "r1", type: "reasoning", text: "thinking…" } }, // not the reply
      { type: "item.updated", item: { id: "m1", type: "agent_message", text: "Hello" } },
      { type: "item.completed", item: { id: "m1", type: "agent_message", text: "Hello!" } },
      { type: "turn.completed", usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 } }
    ];

    const chunks: string[] = [];
    for await (const chunk of provider.stream(secondTurn)) chunks.push(chunk);

    expect(chunks).toEqual(["Hel", "lo", "!"]);
    expect(thread.streamedInputs).toEqual(["Q2"]); // same live thread, new turn only
  });

  it("throws on turn.failed", async () => {
    const provider = makeProvider();
    await provider.complete(firstTurn);
    codexState.threads[0].nextEvents = [
      { type: "turn.started" },
      { type: "turn.failed", error: { message: "sandbox denied" } }
    ];

    await expect(async () => {
      for await (const chunk of provider.stream(secondTurn)) void chunk;
    }).rejects.toThrow("codex turn failed: sandbox denied");
  });
});

describe("codexAgentSpec (§9.2 contract)", () => {
  it("declares the per-CLI invariants: strip keys and safe options", () => {
    expect(codexAgentSpec.id).toBe("codex");
    expect(codexAgentSpec.stripEnvKeys).toEqual(["OPENAI_API_KEY"]);
    expect(codexAgentSpec.safeOptions).toBe(CODEX_SAFE_THREAD_OPTIONS);
    expect(CODEX_STRIP_ENV_KEYS).toEqual(["OPENAI_API_KEY"]);
  });

  it("makeProvider wires the registry env through to the Codex client", async () => {
    const provider = codexAgentSpec.makeProvider({ env: { OPENAI_API_KEY: "sk", KEEP: "kept" } });
    expect(provider).toBeInstanceOf(CodexAgentProvider);
    await provider.complete(firstTurn);
    expect((codexState.ctorOptions[0] as { env?: Record<string, string> }).env).toEqual({ KEEP: "kept" });
  });

  it("declares the cli-agent capability row (native streaming, no app tools)", () => {
    expect(makeProvider().capabilities).toEqual({
      chat: true,
      agentic: true,
      streaming: true,
      structured: false,
      tools: false,
      vision: false,
      kind: "cli-agent"
    });
  });
});
