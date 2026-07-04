import { afterEach, describe, expect, it, vi } from "vitest";
import { entityClient, type AgentStreamHandlers } from "./entityClient";

// entityClient.agentStream (A4b): the SSE fetch + `\n\n` frame buffering, dispatching
// the six agent events to typed handlers and resolving { message, provider } on `done`.
// A scripted stream body drives the handlers in order; the 501/400/mid-stream-error
// paths surface typed / thrown errors (DELTA 3 — the agent-specific event names, no
// silent chat fallback).

/** Build a mock fetch that streams `frames` (each an "event:…\ndata:…" block) as SSE. */
function streamingFetch(frames: string[], { splitEvery = 0 }: { splitEvery?: number } = {}) {
  const body = frames.map((f) => f.trimEnd() + "\n\n").join("");
  const bytes = new TextEncoder().encode(body);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (splitEvery > 0) {
        for (let i = 0; i < bytes.length; i += splitEvery) controller.enqueue(bytes.slice(i, i + splitEvery));
      } else {
        controller.enqueue(bytes);
      }
      controller.close();
    }
  });
  const fetchMock = vi.fn(async () => new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

type Recorded =
  | { kind: "step"; index: number }
  | { kind: "text"; delta: string }
  | { kind: "call"; id: string; toolName: string; argsJson: string; truncated: boolean }
  | { kind: "result"; id: string; resultJson: string; truncated: boolean };

function recordingHandlers(log: Recorded[]): AgentStreamHandlers {
  return {
    onStep: (index) => log.push({ kind: "step", index }),
    onTextDelta: (delta) => log.push({ kind: "text", delta }),
    onToolCall: (c) => log.push({ kind: "call", ...c }),
    onToolResult: (r) => log.push({ kind: "result", ...r })
  };
}

const ask = { messages: [{ role: "user" as const, content: "find my mitochondria note" }] };

afterEach(() => vi.unstubAllGlobals());

describe("entityClient.agentStream", () => {
  it("dispatches the six events in order and resolves { message, provider } on done", async () => {
    streamingFetch([
      'event: step\ndata: {"index":0}',
      'event: tool-call\ndata: {"id":"c1","toolName":"search_notes","argsJson":"{\\"query\\":\\"mito\\"}","truncated":false}',
      'event: tool-result\ndata: {"id":"c1","resultJson":"{\\"rows\\":[],\\"total\\":0}","truncated":false}',
      'event: step\ndata: {"index":1}',
      'event: text-delta\ndata: {"delta":"All "}',
      'event: text-delta\ndata: {"delta":"done."}',
      'event: done\ndata: {"message":{"role":"assistant","content":"All done."},"provider":"mock-agent"}'
    ]);
    const log: Recorded[] = [];
    const result = await entityClient.agentStream(ask, recordingHandlers(log));

    expect(log).toEqual([
      { kind: "step", index: 0 },
      { kind: "call", id: "c1", toolName: "search_notes", argsJson: '{"query":"mito"}', truncated: false },
      { kind: "result", id: "c1", resultJson: '{"rows":[],"total":0}', truncated: false },
      { kind: "step", index: 1 },
      { kind: "text", delta: "All " },
      { kind: "text", delta: "done." }
    ]);
    expect(result).toEqual({ message: { role: "assistant", content: "All done." }, provider: "mock-agent" });
  });

  it("reassembles frames that straddle read() chunk boundaries", async () => {
    streamingFetch(
      [
        'event: text-delta\ndata: {"delta":"Hello "}',
        'event: text-delta\ndata: {"delta":"world"}',
        'event: done\ndata: {"message":{"role":"assistant","content":"Hello world"},"provider":"mock-agent"}'
      ],
      { splitEvery: 7 } // tiny chunks force every frame to straddle a boundary
    );
    const log: Recorded[] = [];
    const result = await entityClient.agentStream(ask, recordingHandlers(log));
    expect(log.filter((e) => e.kind === "text")).toEqual([
      { kind: "text", delta: "Hello " },
      { kind: "text", delta: "world" }
    ]);
    expect(result.message.content).toBe("Hello world");
  });

  it("passes truncated payloads through as raw strings without parsing them", async () => {
    const rawArgs = '{"query":"' + "x".repeat(30); // unterminated JSON
    streamingFetch([
      `event: tool-call\ndata: ${JSON.stringify({ id: "c1", toolName: "search_notes", argsJson: rawArgs, truncated: true })}`,
      'event: done\ndata: {"message":{"role":"assistant","content":"ok"},"provider":"mock-agent"}'
    ]);
    const log: Recorded[] = [];
    await entityClient.agentStream(ask, recordingHandlers(log));
    const call = log.find((e) => e.kind === "call") as Extract<Recorded, { kind: "call" }>;
    expect(call.argsJson).toBe(rawArgs);
    expect(call.truncated).toBe(true);
  });

  it("throws a typed agent_unsupported error on 501 (no chat fallback)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ code: "agent_unsupported", provider: "mock", error: 'Provider "mock" does not support the agent loop' }), {
          status: 501,
          headers: { "content-type": "application/json" }
        })
      )
    );
    const err = await entityClient
      .agentStream(ask, recordingHandlers([]))
      .then(() => null)
      .catch((e) => e as Error & { code?: string; provider?: string });
    expect(err).toBeTruthy();
    expect(err?.code).toBe("agent_unsupported");
    expect(err?.provider).toBe("mock");
  });

  it("throws on a 400 validation failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "Invalid request" }), { status: 400, headers: { "content-type": "application/json" } }))
    );
    await expect(entityClient.agentStream(ask, recordingHandlers([]))).rejects.toThrow("Invalid request");
  });

  it("rejects when the stream ends with an `error` event", async () => {
    streamingFetch([
      'event: step\ndata: {"index":0}',
      'event: text-delta\ndata: {"delta":"partial"}',
      'event: error\ndata: {"error":"agent blew up"}'
    ]);
    await expect(entityClient.agentStream(ask, recordingHandlers([]))).rejects.toThrow("agent blew up");
  });

  it("rejects when the stream ends without a done result", async () => {
    streamingFetch(['event: text-delta\ndata: {"delta":"orphan"}']);
    await expect(entityClient.agentStream(ask, recordingHandlers([]))).rejects.toThrow(/without a result/);
  });
});
