import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
  clearToolsForTests,
  MockAgentProvider,
  MOCK_AGENT_FINAL_ANSWER,
  type AgentRequest,
  type AgentStepEvent,
  type ModelProvider
} from "../ai";
import { openVault, type StudyVault } from "../core/vault";
import { AGENT_EVENT_PAYLOAD_CHAR_CAP, serializePayload } from "./agent";
import { createApp } from "./app";

// POST /api/agent/stream (A4a): body validated pre-headers (400), capability-gated
// on provider.runAgent (501), and the AgentStepEvent → SSE frame mapping including
// the args/result serialization cap. The provider is a scripted fake injected via
// createApp's modelProvider seam — no SDK, no network.

const madeDirs: string[] = [];
const madeVaults: StudyVault[] = [];
async function tmpVault() {
  const d = await mkdtemp(path.join(os.tmpdir(), "agent-route-"));
  madeDirs.push(d);
  const vault = await openVault({ rootDir: d });
  madeVaults.push(vault);
  return vault;
}
afterAll(async () => {
  // STORE-SQL Stage-3: release each vault's sqlite handles before rm (no-op on jsonl).
  for (const v of madeVaults.splice(0)) v.close();
  await Promise.all(madeDirs.map((d) => rm(d, { recursive: true, force: true })));
});
afterEach(() => clearToolsForTests());

/** Parse an SSE body back into ordered { event, data } frames (app.test.ts idiom). */
function parseSse(text: string): Array<{ event: string; data: any }> {
  const frames: Array<{ event: string; data: any }> = [];
  for (const frame of text.split("\n\n")) {
    if (!frame.trim()) continue;
    let event = "message";
    const data: string[] = [];
    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trim());
    }
    frames.push({ event, data: JSON.parse(data.join("\n")) });
  }
  return frames;
}

const httpCapabilities = {
  chat: true,
  agentic: true,
  streaming: true,
  structured: false,
  tools: true,
  vision: false,
  kind: "http"
} as const;

/** A ModelProvider whose runAgent replays a script (or throws mid-stream). */
function fakeAgentProvider(
  script: Array<AgentStepEvent | { throw: string }>,
  onRequest?: (request: AgentRequest) => void
): ModelProvider {
  return {
    id: "fake-agent",
    capabilities: httpCapabilities,
    async complete() {
      return { message: { role: "assistant", content: "unused" } };
    },
    async *runAgent(request) {
      onRequest?.(request);
      for (const entry of script) {
        if ("throw" in entry) throw new Error(entry.throw);
        yield entry;
      }
    }
  };
}

const ask = { messages: [{ role: "user", content: "find my mitochondria note" }] };

describe("POST /api/agent/stream", () => {
  it("rejects an invalid body with a plain 400 BEFORE any stream byte", async () => {
    const app = createApp({ vault: await tmpVault() });
    const res = await request(app).post("/api/agent/stream").send({ messages: [] }).expect(400);
    expect(res.headers["content-type"]).toContain("application/json"); // not text/event-stream
    expect(res.body.error).toBe("Invalid request");

    await request(app).post("/api/agent/stream").send({ ...ask, maxSteps: 0 }).expect(400);
    await request(app).post("/api/agent/stream").send({ ...ask, maxSteps: 33 }).expect(400);
  });

  it("answers 501 agent_unsupported when the active provider lacks runAgent (mock default)", async () => {
    const app = createApp({ vault: await tmpVault() }); // provider defaults to mock
    const res = await request(app).post("/api/agent/stream").send(ask).expect(501);
    expect(res.body).toMatchObject({ code: "agent_unsupported", provider: "mock" });
  });

  it("streams a scripted event sequence as SSE frames that parse back 1:1", async () => {
    let seen: AgentRequest | null = null;
    const provider = fakeAgentProvider(
      [
        { type: "step", index: 0 },
        { type: "tool-call", toolName: "search_notes", args: { query: "mito" }, id: "call-1" },
        { type: "tool-result", id: "call-1", result: { rows: [], total: 0, truncated: false } },
        { type: "step", index: 1 },
        { type: "text-delta", delta: "All " },
        { type: "text-delta", delta: "done." },
        { type: "done", message: { role: "assistant", content: "All done." } }
      ],
      (request) => {
        seen = request;
      }
    );
    const app = createApp({ vault: await tmpVault(), modelProvider: provider });

    const res = await request(app).post("/api/agent/stream").send({ ...ask, maxSteps: 4 }).expect(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");

    const frames = parseSse(res.text);
    expect(frames.map((f) => f.event)).toEqual([
      "step",
      "tool-call",
      "tool-result",
      "step",
      "text-delta",
      "text-delta",
      "done"
    ]);
    expect(frames[0].data).toEqual({ index: 0 });
    expect(frames[1].data).toEqual({
      id: "call-1",
      toolName: "search_notes",
      argsJson: '{"query":"mito"}',
      truncated: false
    });
    expect(JSON.parse(frames[2].data.resultJson)).toEqual({ rows: [], total: 0, truncated: false });
    expect(frames[4].data).toEqual({ delta: "All " });
    expect(frames[6].data).toEqual({
      message: { role: "assistant", content: "All done." },
      provider: "fake-agent"
    });

    // The route passed the REGISTERED server tools + the request's budget through.
    const forwarded = seen as AgentRequest | null;
    expect(forwarded?.maxSteps).toBe(4);
    expect(forwarded?.messages).toEqual(ask.messages);
    expect(forwarded?.tools?.map((t) => t.name)).toEqual(["search_notes", "get_source", "list_anchors"]);
  });

  it("caps oversized tool payloads on the wire and flags the truncation", async () => {
    const provider = fakeAgentProvider([
      { type: "tool-call", toolName: "search_notes", args: { q: "x".repeat(9000) }, id: "call-1" },
      { type: "tool-result", id: "call-1", result: "y".repeat(9000) },
      { type: "done", message: { role: "assistant", content: "ok" } }
    ]);
    const app = createApp({ vault: await tmpVault(), modelProvider: provider });

    const frames = parseSse((await request(app).post("/api/agent/stream").send(ask).expect(200)).text);
    expect(frames[0].data.argsJson.length).toBe(AGENT_EVENT_PAYLOAD_CHAR_CAP);
    expect(frames[0].data.truncated).toBe(true);
    expect(frames[1].data.resultJson.length).toBe(AGENT_EVENT_PAYLOAD_CHAR_CAP);
    expect(frames[1].data.truncated).toBe(true);
  });

  it("drives the shipping MockAgentProvider end-to-end (search_notes tool-call + result + final answer)", async () => {
    // The real registered agent provider (A4b) against the real registered vault tools —
    // no scripted fake. The empty temp vault → search_notes returns total 0.
    const app = createApp({ vault: await tmpVault(), modelProvider: new MockAgentProvider() });
    const res = await request(app).post("/api/agent/stream").send(ask).expect(200);
    const frames = parseSse(res.text);

    expect(frames.map((f) => f.event)).toEqual(["step", "tool-call", "tool-result", "step", "text-delta", "text-delta", "done"]);
    expect(frames[1].data).toMatchObject({ toolName: "search_notes", truncated: false });
    expect(JSON.parse(frames[1].data.argsJson)).toEqual({ query: "find my mitochondria note" });
    // The real search_notes ran against the empty vault → { rows: [], total: 0 }.
    expect(JSON.parse(frames[2].data.resultJson)).toMatchObject({ rows: [], total: 0 });
    expect(frames.at(-1)!.data).toEqual({ message: { role: "assistant", content: MOCK_AGENT_FINAL_ANSWER }, provider: "mock-agent" });
  });

  it("reports a mid-stream failure as `event: error` (headers already sent)", async () => {
    const provider = fakeAgentProvider([
      { type: "step", index: 0 },
      { type: "text-delta", delta: "partial" },
      { throw: "agent blew up" }
    ]);
    const app = createApp({ vault: await tmpVault(), modelProvider: provider });

    const res = await request(app).post("/api/agent/stream").send(ask).expect(200);
    const frames = parseSse(res.text);
    expect(frames.map((f) => f.event)).toEqual(["step", "text-delta", "error"]);
    expect(frames[2].data).toEqual({ error: "agent blew up" });
  });
});

describe("serializePayload", () => {
  it("passes small values through, degrades non-JSON values, and caps big ones", () => {
    expect(serializePayload({ a: 1 })).toEqual({ json: '{"a":1}', truncated: false });
    expect(serializePayload(undefined)).toEqual({ json: "null", truncated: false });

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(serializePayload(circular)).toEqual({ json: '"[object Object]"', truncated: false });

    const big = serializePayload("z".repeat(AGENT_EVENT_PAYLOAD_CHAR_CAP * 2));
    expect(big.json.length).toBe(AGENT_EVENT_PAYLOAD_CHAR_CAP);
    expect(big.truncated).toBe(true);
  });
});
