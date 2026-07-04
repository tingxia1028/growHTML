import { describe, expect, it } from "vitest";
import {
  initialAgentTurn,
  reduceAgentEvent,
  type AgentEvent,
  type AgentTranscriptItem,
  type AgentTurnState
} from "./agentTurnReducer";

// Pure reducer for the A4b agent transcript: the six agent SSE events fold into a
// render-only turn state. Covers text accumulation, keyed tool call→result
// transitions, in-band tool errors, truncated (non-parsing) payloads that must NOT
// throw, interleave order, and terminal done/error status.

function run(events: AgentEvent[], start: AgentTurnState = initialAgentTurn()): AgentTurnState {
  return events.reduce(reduceAgentEvent, start);
}

const tool = (state: AgentTurnState, id: string): Extract<AgentTranscriptItem, { kind: "tool" }> => {
  const item = state.items.find((i): i is Extract<AgentTranscriptItem, { kind: "tool" }> => i.kind === "tool" && i.id === id);
  if (!item) throw new Error(`no tool item ${id}`);
  return item;
};

describe("reduceAgentEvent", () => {
  it("starts empty + running", () => {
    const s = initialAgentTurn();
    expect(s.items).toEqual([]);
    expect(s.status).toBe("running");
  });

  it("coalesces consecutive text-deltas into one trailing text item", () => {
    const s = run([
      { type: "text-delta", delta: "All " },
      { type: "text-delta", delta: "done." }
    ]);
    expect(s.items).toEqual([{ kind: "text", content: "All done." }]);
  });

  it("ignores `step` events (loop boundary, no row)", () => {
    const s = run([
      { type: "step", index: 0 },
      { type: "text-delta", delta: "hi" },
      { type: "step", index: 1 }
    ]);
    expect(s.items).toEqual([{ kind: "text", content: "hi" }]);
    expect(s.status).toBe("running");
  });

  it("pushes a `calling` tool item keyed by id with parsed args", () => {
    const s = run([
      { type: "tool-call", id: "c1", toolName: "search_notes", argsJson: '{"query":"mito"}', truncated: false }
    ]);
    const t = tool(s, "c1");
    expect(t.state).toBe("calling");
    expect(t.toolName).toBe("search_notes");
    expect(t.args).toEqual({ query: "mito" });
    expect(t.argsRaw).toBe('{"query":"mito"}');
    expect(t.truncated).toBe(false);
    expect(t.result).toBeUndefined();
  });

  it("settles the matching tool item to `done` with the parsed result", () => {
    const s = run([
      { type: "tool-call", id: "c1", toolName: "search_notes", argsJson: '{"query":"mito"}', truncated: false },
      { type: "tool-result", id: "c1", resultJson: '{"rows":[],"total":0}', truncated: false }
    ]);
    const t = tool(s, "c1");
    expect(t.state).toBe("done");
    expect(t.result).toEqual({ rows: [], total: 0 });
    expect(t.error).toBeUndefined();
  });

  it("matches a result to its call by id even with two interleaved tools", () => {
    const s = run([
      { type: "tool-call", id: "a", toolName: "search_notes", argsJson: "{}", truncated: false },
      { type: "tool-call", id: "b", toolName: "get_source", argsJson: "{}", truncated: false },
      { type: "tool-result", id: "b", resultJson: '{"title":"S"}', truncated: false },
      { type: "tool-result", id: "a", resultJson: '{"total":3}', truncated: false }
    ]);
    expect(tool(s, "a").result).toEqual({ total: 3 });
    expect(tool(s, "b").result).toEqual({ title: "S" });
    expect(s.items.map((i) => (i.kind === "tool" ? i.id : "text"))).toEqual(["a", "b"]);
  });

  it("marks an in-band tool error ({error}) as `error` state carrying the message", () => {
    const s = run([
      { type: "tool-call", id: "c1", toolName: "get_source", argsJson: '{"sourceId":"x"}', truncated: false },
      { type: "tool-result", id: "c1", resultJson: '{"error":"Source not found: x"}', truncated: false }
    ]);
    const t = tool(s, "c1");
    expect(t.state).toBe("error");
    expect(t.error).toBe("Source not found: x");
  });

  it("does NOT throw on a truncated (non-parsing) args payload — keeps raw + flags truncated", () => {
    const raw = '{"query":"' + "x".repeat(50); // deliberately unterminated JSON
    let s!: AgentTurnState;
    expect(() => {
      s = run([{ type: "tool-call", id: "c1", toolName: "search_notes", argsJson: raw, truncated: true }]);
    }).not.toThrow();
    const t = tool(s, "c1");
    expect(t.args).toBeUndefined();
    expect(t.argsRaw).toBe(raw);
    expect(t.truncated).toBe(true);
  });

  it("does NOT throw on a truncated result payload — settles to done, raw kept, truncated flagged", () => {
    const raw = '{"rows":[{"id":"' + "y".repeat(50); // unterminated
    let s!: AgentTurnState;
    expect(() => {
      s = run([
        { type: "tool-call", id: "c1", toolName: "search_notes", argsJson: "{}", truncated: false },
        { type: "tool-result", id: "c1", resultJson: raw, truncated: true }
      ]);
    }).not.toThrow();
    const t = tool(s, "c1");
    expect(t.state).toBe("done");
    expect(t.result).toBeUndefined();
    expect(t.resultRaw).toBe(raw);
    expect(t.truncated).toBe(true);
  });

  it("flags truncation when the server capped even a payload that still parses", () => {
    const s = run([
      { type: "tool-call", id: "c1", toolName: "search_notes", argsJson: '{"q":"ok"}', truncated: true }
    ]);
    expect(tool(s, "c1").truncated).toBe(true);
  });

  it("interleaves text and tools in arrival order", () => {
    const s = run([
      { type: "step", index: 0 },
      { type: "tool-call", id: "c1", toolName: "search_notes", argsJson: "{}", truncated: false },
      { type: "tool-result", id: "c1", resultJson: "{}", truncated: false },
      { type: "step", index: 1 },
      { type: "text-delta", delta: "Found it." }
    ]);
    expect(s.items.map((i) => i.kind)).toEqual(["tool", "text"]);
  });

  it("done sets status + the persisted message", () => {
    const s = run([
      { type: "text-delta", delta: "hi" },
      { type: "done", message: { role: "assistant", content: "hi" }, provider: "mock-agent" }
    ]);
    expect(s.status).toBe("done");
    expect(s.message).toEqual({ role: "assistant", content: "hi" });
  });

  it("error sets status + error but keeps the accumulated items", () => {
    const s = run([
      { type: "text-delta", delta: "partial" },
      { type: "error", error: "agent blew up" }
    ]);
    expect(s.status).toBe("error");
    expect(s.error).toBe("agent blew up");
    expect(s.items).toEqual([{ kind: "text", content: "partial" }]);
  });
});
