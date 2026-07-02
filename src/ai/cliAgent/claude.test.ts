import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatRequest } from "../provider";
import { buildCleanEnv } from "./spec";

// The OFFICIAL SDK is mocked at the module boundary — the adapter loads it via
// a lazy dynamic import(), which vitest intercepts. No real CLI is ever run.
const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query: queryMock }));

import { CLAUDE_SAFE_OPTIONS, CLAUDE_STRIP_ENV_KEYS, ClaudeAgentProvider, claudeAgentSpec } from "./claude";

const scratchDir = join(tmpdir(), "growhtml-claude-adapter-test-scratch");
afterAll(() => rmSync(scratchDir, { recursive: true, force: true }));

const baseEnv: NodeJS.ProcessEnv = {
  ANTHROPIC_API_KEY: "sk-metered",
  ANTHROPIC_AUTH_TOKEN: "tok-metered",
  PATH: "C:\\bin",
  HOME: "/home/u"
};

function makeProvider(): ClaudeAgentProvider {
  return new ClaudeAgentProvider({ baseEnv, scratchDir });
}

// --- fake SDK message stream -------------------------------------------------

async function* gen(messages: unknown[]): AsyncGenerator<unknown> {
  for (const message of messages) yield message;
}

function assistantMsg(text: string, opts: { sessionId?: string; parent?: string | null } = {}): unknown {
  return {
    type: "assistant",
    parent_tool_use_id: opts.parent ?? null,
    session_id: opts.sessionId ?? "sess-1",
    message: { content: [{ type: "text", text }] }
  };
}

function successResult(result: string, sessionId = "sess-1"): unknown {
  return { type: "result", subtype: "success", is_error: false, result, session_id: sessionId };
}

function deltaMsg(text: string, opts: { parent?: string | null } = {}): unknown {
  return {
    type: "stream_event",
    parent_tool_use_id: opts.parent ?? null,
    session_id: "sess-1",
    event: { type: "content_block_delta", delta: { type: "text_delta", text } }
  };
}

function capturedParams(callIndex = 0): { prompt: string; options: Record<string, unknown> } {
  expect(queryMock.mock.calls.length).toBeGreaterThan(callIndex);
  return queryMock.mock.calls[callIndex][0] as { prompt: string; options: Record<string, unknown> };
}

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockImplementation(() => gen([assistantMsg("ok"), successResult("ok")]));
});

const firstTurn: ChatRequest = { messages: [{ role: "user", content: "Q1" }] };
const secondTurn: ChatRequest = {
  messages: [
    { role: "user", content: "Q1" },
    { role: "assistant", content: "A1" },
    { role: "user", content: "Q2" }
  ]
};

describe("ClaudeAgentProvider — safe mode + env (the two §9.3 invariants)", () => {
  it("passes options that grant NO tools, pin permissions, isolate settings, and anchor a scratch cwd", async () => {
    await makeProvider().complete(firstTurn);

    const { prompt, options } = capturedParams();
    expect(prompt).toBe("Q1");
    // Invariant 2 — real option names from the SDK typings.
    expect(options.tools).toEqual([]); // "[] (empty array) - Disable all built-in tools"
    expect(options.allowedTools).toEqual([]);
    expect(options.permissionMode).toBe("dontAsk"); // never prompts, denies what isn't pre-approved
    expect(options.settingSources).toEqual([]); // SDK isolation mode: no filesystem settings
    expect(options.strictMcpConfig).toBe(true);
    expect(options.cwd).toBe(scratchDir);
    expect(existsSync(scratchDir)).toBe(true); // scratch cwd actually exists for the spawn
    // Sessions must stay resumable — never disable persistence.
    expect(options.persistSession).toBeUndefined();
    expect(options.resume).toBeUndefined(); // first turn: no resume
  });

  it("hands the SDK a REPLACEMENT env with the metered keys absent and everything else intact", async () => {
    await makeProvider().complete(firstTurn);

    const { options } = capturedParams();
    // Options.env replaces the subprocess environment entirely, so what we
    // assert here is exactly what the CLI subprocess will see.
    expect(options.env).toEqual({ PATH: "C:\\bin", HOME: "/home/u" });
    expect(options.env).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(options.env).not.toHaveProperty("ANTHROPIC_AUTH_TOKEN");
  });
});

describe("ClaudeAgentProvider.complete", () => {
  it("returns the concatenated top-level assistant text", async () => {
    queryMock.mockImplementation(() =>
      gen([
        assistantMsg("Hello, "),
        assistantMsg("sub-agent noise", { parent: "tool-1" }), // not part of the reply
        assistantMsg("world."),
        successResult("result-summary")
      ])
    );

    const response = await makeProvider().complete(firstTurn);
    expect(response.message).toEqual({ role: "assistant", content: "Hello, world." });
  });

  it("falls back to the result text when no assistant blocks arrived", async () => {
    queryMock.mockImplementation(() => gen([successResult("only-result")]));
    const response = await makeProvider().complete(firstTurn);
    expect(response.message.content).toBe("only-result");
  });

  it("rejects with the SDK's error details on a non-success result", async () => {
    queryMock.mockImplementation(() =>
      gen([
        {
          type: "result",
          subtype: "error_during_execution",
          is_error: true,
          errors: ["boom"],
          session_id: "sess-1"
        }
      ])
    );
    await expect(makeProvider().complete(firstTurn)).rejects.toThrow(
      "claude-agent query failed (error_during_execution): boom"
    );
  });
});

describe("ClaudeAgentProvider.stream", () => {
  it("yields text deltas in order and requests partial messages", async () => {
    queryMock.mockImplementation(() =>
      gen([
        deltaMsg("Hel"),
        deltaMsg("ignored", { parent: "tool-1" }), // subagent stream is not the reply
        deltaMsg("lo "),
        deltaMsg("world"),
        assistantMsg("Hello world"),
        successResult("Hello world")
      ])
    );

    const chunks: string[] = [];
    for await (const chunk of makeProvider().stream(firstTurn)) chunks.push(chunk);

    expect(chunks).toEqual(["Hel", "lo ", "world"]);
    expect(capturedParams().options.includePartialMessages).toBe(true);
    // Streaming carries the same pinned safe options.
    expect(capturedParams().options.tools).toEqual([]);
    expect(capturedParams().options.permissionMode).toBe("dontAsk");
  });

  it("falls back to a single full-reply chunk when the SDK emitted no partials", async () => {
    queryMock.mockImplementation(() => gen([assistantMsg("full reply"), successResult("full reply")]));
    const chunks: string[] = [];
    for await (const chunk of makeProvider().stream(firstTurn)) chunks.push(chunk);
    expect(chunks).toEqual(["full reply"]);
  });
});

describe("ClaudeAgentProvider — session threading across turns", () => {
  it("captures the SDK session id on turn 1 and resumes it on turn 2 with just the new message", async () => {
    const provider = makeProvider();

    queryMock.mockImplementationOnce(() => gen([assistantMsg("A1", { sessionId: "sess-42" }), successResult("A1", "sess-42")]));
    await provider.complete(firstTurn);
    expect(capturedParams(0).options.resume).toBeUndefined();

    await provider.complete(secondTurn);
    const second = capturedParams(1);
    expect(second.options.resume).toBe("sess-42"); // Options.resume: "Session ID to resume."
    expect(second.prompt).toBe("Q2"); // resumed session gets only the new turn
  });

  it("threads the session across stream() and complete() alike", async () => {
    const provider = makeProvider();
    queryMock.mockImplementationOnce(() => gen([deltaMsg("A1"), successResult("A1")]));
    for await (const chunk of provider.stream(firstTurn)) void chunk;

    await provider.complete(secondTurn);
    expect(capturedParams(1).options.resume).toBe("sess-1");
  });

  it("a fresh chat (single user turn) rotates the session instead of resuming the old one", async () => {
    const provider = makeProvider();
    await provider.complete(firstTurn); // establishes sess-1
    await provider.complete({ messages: [{ role: "user", content: "New chat" }] });

    const second = capturedParams(1);
    expect(second.options.resume).toBeUndefined();
    expect(second.prompt).toBe("New chat");
  });

  it("a later turn with the session lost re-seeds a fresh session with the flattened transcript", async () => {
    await makeProvider().complete(secondTurn); // brand-new provider: no live session
    const { prompt, options } = capturedParams();
    expect(options.resume).toBeUndefined();
    expect(prompt).toBe("USER: Q1\n\nASSISTANT: A1\n\nUSER: Q2");
  });
});

describe("claudeAgentSpec (§9.2 contract)", () => {
  it("declares the per-CLI invariants: strip keys and safe options", () => {
    expect(claudeAgentSpec.id).toBe("claude");
    expect(claudeAgentSpec.stripEnvKeys).toEqual(["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"]);
    expect(claudeAgentSpec.safeOptions).toBe(CLAUDE_SAFE_OPTIONS);
    expect(buildCleanEnv({ ANTHROPIC_API_KEY: "x", KEEP: "y" }, CLAUDE_STRIP_ENV_KEYS)).toEqual({ KEEP: "y" });
  });

  it("makeProvider wires the registry env through to the SDK subprocess env", async () => {
    const provider = claudeAgentSpec.makeProvider({ env: { ANTHROPIC_API_KEY: "sk", KEEP: "kept" } });
    expect(provider).toBeInstanceOf(ClaudeAgentProvider);
    await provider.complete(firstTurn);
    expect(capturedParams().options.env).toEqual({ KEEP: "kept" });
  });

  it("declares the cli-agent capability row (native streaming, no app tools)", () => {
    expect(new ClaudeAgentProvider({ baseEnv, scratchDir }).capabilities).toEqual({
      chat: true,
      agentic: true,
      streaming: true,
      structured: false,
      tools: false,
      kind: "cli-agent"
    });
  });
});
