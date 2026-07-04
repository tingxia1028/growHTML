import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createModelProvider } from "./index";
import { MockAgentProvider, MOCK_AGENT_FINAL_ANSWER } from "./mockAgentProvider";
import { MockModelProvider } from "./mockProvider";
import { FORM_ROUTER_CONTENT_TYPE } from "./mockProvider";
import type { AgentStepEvent, ChatRequest, StructuredRequest, ToolDefinition } from "./index";

// MockAgentProvider (A4b, DELTA 1): the offline mock EXTENDED with a scripted agent
// loop. It must (a) yield a deterministic runAgent event sequence, (b) advertise
// honest capabilities, (c) register under "mock-agent" via createModelProvider, and
// (d) delegate complete / stream / completeStructured BYTE-IDENTICALLY to a plain
// MockModelProvider — the invariant that keeps the global e2e pin non-perturbing.

async function collect(iter: AsyncIterable<AgentStepEvent>): Promise<AgentStepEvent[]> {
  const out: AgentStepEvent[] = [];
  for await (const event of iter) out.push(event);
  return out;
}

async function streamText(iter: AsyncIterable<string>): Promise<string> {
  let text = "";
  for await (const chunk of iter) text += chunk;
  return text;
}

/** A fake search_notes tool that records its input and returns a fixed row set. */
function fakeSearchTool(seen: unknown[]): ToolDefinition {
  return {
    name: "search_notes",
    description: "fake",
    inputSchema: z.object({ query: z.string() }),
    execute: async (input) => {
      seen.push(input);
      return { rows: [{ id: "note_1", snippet: "hit" }], total: 1, truncated: false };
    }
  };
}

const ask: ChatRequest = { messages: [{ role: "user", content: "find my mitochondria note" }] };

describe("MockAgentProvider", () => {
  it("advertises honest agent capabilities (agentic + tools true, structured kept)", () => {
    const p = new MockAgentProvider();
    expect(p.id).toBe("mock-agent");
    expect(p.capabilities).toMatchObject({ chat: true, agentic: true, streaming: true, structured: true, tools: true, kind: "mock" });
    expect(typeof p.runAgent).toBe("function");
  });

  it("runAgent yields the scripted step → tool-call → tool-result → step → text → done", async () => {
    const seen: unknown[] = [];
    const events = await collect(new MockAgentProvider().runAgent({ ...ask, tools: [fakeSearchTool(seen)] }));

    expect(events.map((e) => e.type)).toEqual(["step", "tool-call", "tool-result", "step", "text-delta", "text-delta", "done"]);
    const call = events[1] as Extract<AgentStepEvent, { type: "tool-call" }>;
    expect(call.toolName).toBe("search_notes");
    expect(call.args).toEqual({ query: "find my mitochondria note" });
    // The REAL tool ran with the user's query.
    expect(seen).toEqual([{ query: "find my mitochondria note" }]);
    const result = events[2] as Extract<AgentStepEvent, { type: "tool-result" }>;
    expect(result.id).toBe(call.id);
    expect(result.result).toEqual({ rows: [{ id: "note_1", snippet: "hit" }], total: 1, truncated: false });
    const done = events.at(-1) as Extract<AgentStepEvent, { type: "done" }>;
    expect(done.message).toEqual({ role: "assistant", content: MOCK_AGENT_FINAL_ANSWER });
  });

  it("degrades to step → text → done when no search tool is available", async () => {
    const events = await collect(new MockAgentProvider().runAgent(ask));
    expect(events.map((e) => e.type)).toEqual(["step", "step", "text-delta", "text-delta", "done"]);
  });

  it("createModelProvider(mock-agent) resolves to a MockAgentProvider", () => {
    const p = createModelProvider({ STUDY_VAULT_AI_PROVIDER: "mock-agent" } as NodeJS.ProcessEnv);
    expect(p.id).toBe("mock-agent");
    expect(p.capabilities.tools).toBe(true);
    expect(typeof p.runAgent).toBe("function");
  });

  it("delegates complete BYTE-IDENTICALLY to a plain MockModelProvider", async () => {
    const agent = new MockAgentProvider();
    const mock = new MockModelProvider();
    const req: ChatRequest = {
      messages: [{ role: "user", content: "What is the key idea here?" }],
      context: { sourceTitle: "Cells", quote: "Mitochondria is the powerhouse", location: "p.3" }
    };
    expect((await agent.complete(req)).message).toEqual((await mock.complete(req)).message);
  });

  it("delegates stream BYTE-IDENTICALLY (concatenation matches the mock's answer)", async () => {
    const agent = new MockAgentProvider();
    const mock = new MockModelProvider();
    const req: ChatRequest = { messages: [{ role: "user", content: "Explain enzymes" }] };
    expect(await streamText(agent.stream(req))).toBe(await streamText(mock.stream(req)));
  });

  it("delegates completeStructured BYTE-IDENTICALLY (sample echo + form-router + synthesis defaults)", async () => {
    const agent = new MockAgentProvider();
    const mock = new MockModelProvider();
    const cases: StructuredRequest[] = [
      { messages: [{ role: "user", content: "x" }], contentType: "flashcard", sample: { front: "a", back: "b" } },
      { messages: [{ role: "user", content: "x" }], contentType: FORM_ROUTER_CONTENT_TYPE },
      { messages: [{ role: "user", content: "x" }], contentType: "markdown" }
    ];
    for (const req of cases) {
      expect(await agent.completeStructured(req)).toEqual(await mock.completeStructured(req));
    }
  });
});
