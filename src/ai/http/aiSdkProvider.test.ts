import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AgentStepEvent, ChatRequest } from "../provider";
import { generateStructured } from "../structured";
import type { ToolDefinition } from "../tools";
import { AiSdkProvider, DEFAULT_AGENT_MAX_STEPS, toModelMessages } from "./aiSdkProvider";

// These tests run the REAL `ai` runtime (generateText/streamText/generateObject)
// against the SDK's own fake models from `ai/test` — offline by construction,
// and exercising the actual v7 plumbing (message conversion, the
// allowSystemInMessages gate, no-schema JSON mode) instead of a mocked module.

// --- V4 fake-model fixtures ----------------------------------------------------

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 }
};
const finishReason = { unified: "stop", raw: undefined } as const;

function textModel(text: string): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doGenerate: { content: [{ type: "text", text }], finishReason, usage, warnings: [] }
  });
}

function streamModel(deltas: string[]): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: {
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "1" },
          ...deltas.map((delta) => ({ type: "text-delta", id: "1", delta }) as const),
          { type: "text-end", id: "1" },
          { type: "finish", usage, finishReason }
        ]
      })
    }
  });
}

function providerFor(model: MockLanguageModelV4): AiSdkProvider {
  return new AiSdkProvider({ id: "test-http", label: "Test (BYOK)", makeModel: async () => model });
}

// Same context fixture as cliAgent/spec.test.ts — the weaving contract is
// shared (src/ai/buildPrompt.ts), so the expected TEXT is byte-identical.
const context = {
  sourceTitle: "Render Thread",
  sourceType: "article",
  location: "https://example.com/render",
  quote: "submits rendering commands",
  contextBefore: "The render thread ",
  contextAfter: " to the GPU."
};

const CONTEXT_PREAMBLE =
  "Source: Render Thread (article)\nLocation: https://example.com/render" +
  "\n\nSelected passage (between ⟦⟧, with surrounding context):\n…The render thread ⟦submits rendering commands⟧ to the GPU.…";

const ask: ChatRequest = { messages: [{ role: "user", content: "What does it do?" }], context };

describe("AiSdkProvider.complete", () => {
  it("returns the fake model's text as the assistant message", async () => {
    const response = await providerFor(textModel("fake reply")).complete(ask);
    expect(response.message).toEqual({ role: "assistant", content: "fake reply" });
  });

  it("weaves the study context in as a leading system message the model actually receives", async () => {
    const model = textModel("ok");
    await providerFor(model).complete(ask);

    expect(model.doGenerateCalls).toHaveLength(1);
    expect(model.doGenerateCalls[0].prompt).toEqual([
      { role: "system", content: CONTEXT_PREAMBLE },
      { role: "user", content: [{ type: "text", text: "What does it do?" }] }
    ]);
  });

  it("without context there is no synthetic system message", async () => {
    const model = textModel("ok");
    await providerFor(model).complete({ messages: [{ role: "user", content: "hi" }] });
    expect(model.doGenerateCalls[0].prompt).toEqual([{ role: "user", content: [{ type: "text", text: "hi" }] }]);
  });

  it("passes caller system messages through (v7 rejects them unless explicitly allowed)", async () => {
    const model = textModel("ok");
    await providerFor(model).complete({
      messages: [
        { role: "system", content: "You output ONLY JSON." },
        { role: "user", content: "Q" },
        { role: "assistant", content: "A" },
        { role: "user", content: "Q2" }
      ],
      context
    });

    expect(model.doGenerateCalls[0].prompt).toEqual([
      { role: "system", content: CONTEXT_PREAMBLE }, // context first, like flattenPrompt
      { role: "system", content: "You output ONLY JSON." },
      { role: "user", content: [{ type: "text", text: "Q" }] },
      { role: "assistant", content: [{ type: "text", text: "A" }] },
      { role: "user", content: [{ type: "text", text: "Q2" }] }
    ]);
  });
});

describe("AiSdkProvider.stream", () => {
  it("yields the fake model's deltas in order; concatenation equals the reply", async () => {
    const chunks: string[] = [];
    for await (const chunk of providerFor(streamModel(["Hel", "lo ", "world"])).stream(ask)) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual(["Hel", "lo ", "world"]);
    expect(chunks.join("")).toBe("Hello world");
  });

  it("weaves the same context system message into the streamed call", async () => {
    const model = streamModel(["x"]);
    for await (const chunk of providerFor(model).stream(ask)) void chunk;
    expect(model.doStreamCalls[0].prompt[0]).toEqual({ role: "system", content: CONTEXT_PREAMBLE });
  });
});

describe("AiSdkProvider.completeStructured (native no-schema JSON mode)", () => {
  it("returns the model's JSON via generateObject", async () => {
    const result = await providerFor(textModel('{"kind":"quiz","questions":2}')).completeStructured({
      messages: [{ role: "user", content: "make a quiz" }],
      contentType: "quiz"
    });
    expect(JSON.parse(result.json)).toEqual({ kind: "quiz", questions: 2 });
  });

  it("on NoObjectGeneratedError returns the RAW text so the extractJson retry loop above can recover", async () => {
    // Prose around the JSON: generateObject's strict parse fails, but our
    // boundary contract is "raw JSON TEXT, validated above" — hand it up.
    const raw = 'Sure! Here it is: {"kind":"note","title":"T"}';
    const result = await providerFor(textModel(raw)).completeStructured({
      messages: [{ role: "user", content: "note please" }],
      contentType: "note"
    });
    expect(result.json).toBe(raw);
  });

  it("slots into generateStructured: schema validation above the boundary, even for prose-wrapped JSON", async () => {
    const provider = providerFor(textModel('Here you go: {"kind":"note","title":"T"}'));
    const parsed = await generateStructured(provider, {
      messages: [{ role: "user", content: "note please" }],
      schema: z.object({ kind: z.literal("note"), title: z.string() })
    });
    expect(parsed).toEqual({ kind: "note", title: "T" });
  });
});

describe("AiSdkProvider — lazy model construction", () => {
  it("does not run makeModel at construction; runs it once and memoizes across calls", async () => {
    let calls = 0;
    const generate = textModel("ok");
    const streaming = streamModel(["ok"]);
    // One model object serving both paths, so complete() and stream() share
    // the single memoized makeModel result.
    const model = new MockLanguageModelV4({ doGenerate: generate.doGenerate, doStream: streaming.doStream });
    const provider = new AiSdkProvider({
      id: "lazy",
      label: "Lazy",
      makeModel: async () => {
        calls += 1;
        return model;
      }
    });
    expect(calls).toBe(0); // constructing a provider costs nothing

    await provider.complete({ messages: [{ role: "user", content: "a" }] });
    await provider.complete({ messages: [{ role: "user", content: "b" }] });
    for await (const chunk of provider.stream({ messages: [{ role: "user", content: "c" }] })) void chunk;
    expect(calls).toBe(1);
  });

  it("does not cache a FAILED makeModel: the next call retries (config can heal in place)", async () => {
    let calls = 0;
    const provider = new AiSdkProvider({
      id: "flaky",
      label: "Flaky",
      makeModel: async () => {
        calls += 1;
        if (calls === 1) throw new Error("not configured yet");
        return textModel("recovered");
      }
    });

    await expect(provider.complete({ messages: [{ role: "user", content: "a" }] })).rejects.toThrow(
      "not configured yet"
    );
    const response = await provider.complete({ messages: [{ role: "user", content: "b" }] });
    expect(response.message.content).toBe("recovered");
    expect(calls).toBe(2);
  });
});

describe("AiSdkProvider — capabilities + message mapping", () => {
  it("declares the http capability row honestly (runAgent shipped in A4a → tools/agentic true)", () => {
    const provider = providerFor(textModel("x"));
    expect(provider.capabilities).toEqual({
      chat: true,
      agentic: true,
      streaming: true,
      structured: true,
      tools: true,
      kind: "http"
    });
    expect(typeof provider.runAgent).toBe("function");
    expect(provider.id).toBe("test-http");
    expect(provider.label).toBe("Test (BYOK)");
  });

  it("toModelMessages maps roles 1:1 and only prepends a system message when the context has content", () => {
    expect(toModelMessages([{ role: "user", content: "hi" }], {})).toEqual([{ role: "user", content: "hi" }]);
    expect(toModelMessages([{ role: "user", content: "hi" }], context)).toEqual([
      { role: "system", content: CONTEXT_PREAMBLE },
      { role: "user", content: "hi" }
    ]);
  });
});

// --- runAgent (A4a agent loop) ---------------------------------------------------
// Runs the REAL v7 ToolLoopAgent against scripted V4 fake models: doStream given an
// ARRAY yields one response per LLM call, so a tool-call step followed by a text step
// scripts a full call→execute→feed-back→answer loop offline.

const toolCallsFinish = { unified: "tool-calls", raw: undefined } as const;

// Model-layer stream types, derived from the mock's constructor so the helpers
// stay annotated without importing the transitive @ai-sdk/provider package.
type MockModelInit = NonNullable<ConstructorParameters<typeof MockLanguageModelV4>[0]>;
type StreamTurn = Extract<MockModelInit["doStream"], { stream: unknown }>;
type StreamChunk = StreamTurn["stream"] extends ReadableStream<infer P> ? P : never;

/** One LLM turn that calls `toolName` with the given JSON input (model layer input is a STRING). */
function toolCallTurn(toolCallId: string, toolName: string, inputJson: string): StreamTurn {
  const chunks: StreamChunk[] = [
    { type: "stream-start", warnings: [] },
    { type: "tool-call", toolCallId, toolName, input: inputJson },
    { type: "finish", usage, finishReason: toolCallsFinish }
  ];
  return { stream: simulateReadableStream({ chunks }) };
}

/** One LLM turn that streams plain text. */
function textTurn(deltas: string[]): StreamTurn {
  const chunks: StreamChunk[] = [
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "1" },
    ...deltas.map((delta): StreamChunk => ({ type: "text-delta", id: "1", delta })),
    { type: "text-end", id: "1" },
    { type: "finish", usage, finishReason }
  ];
  return { stream: simulateReadableStream({ chunks }) };
}

function searchTool(execute: ToolDefinition["execute"]): ToolDefinition {
  return {
    name: "search_notes",
    description: "Search the vault's notes",
    inputSchema: z.object({ query: z.string() }),
    execute
  };
}

async function collect(events: AsyncIterable<AgentStepEvent>): Promise<AgentStepEvent[]> {
  const out: AgentStepEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

describe("AiSdkProvider.runAgent", () => {
  it("streams the full AgentStepEvent sequence for a tool-call step then a text step", async () => {
    const model = new MockLanguageModelV4({
      doStream: [toolCallTurn("call-1", "search_notes", '{"query":"mito"}'), textTurn(["Found ", "it."])]
    });
    const execute = vi.fn(async (_input: unknown, _ctx: unknown) => ({ rows: [{ id: "note-1" }], total: 1 }));

    const events = await collect(
      providerFor(model).runAgent({
        messages: [{ role: "user", content: "find my mitochondria note" }],
        tools: [searchTool(execute)]
      })
    );

    expect(events).toEqual([
      { type: "step", index: 0 },
      { type: "tool-call", toolName: "search_notes", args: { query: "mito" }, id: "call-1" },
      { type: "tool-result", id: "call-1", result: { rows: [{ id: "note-1" }], total: 1 } },
      { type: "step", index: 1 },
      { type: "text-delta", delta: "Found " },
      { type: "text-delta", delta: "it." },
      { type: "done", message: { role: "assistant", content: "Found it." } }
    ]);

    // The SDK validated the args against inputSchema and called OUR execute with
    // the parsed input; ctx is the reserved opaque slot (undefined in A4a).
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toEqual({ query: "mito" });
    expect(execute.mock.calls[0][1]).toBeUndefined();
    // And the model actually saw the mapped tool definition.
    expect(model.doStreamCalls[0].tools).toMatchObject([{ name: "search_notes" }]);
  });

  it("honors maxSteps: a model that always tool-calls stops at N with a sane done", async () => {
    let calls = 0;
    const model = new MockLanguageModelV4({
      doStream: async () => {
        calls += 1;
        return toolCallTurn(`call-${calls}`, "search_notes", '{"query":"again"}');
      }
    });
    const execute = vi.fn(async () => "nothing new");

    const events = await collect(
      providerFor(model).runAgent({
        messages: [{ role: "user", content: "loop forever" }],
        tools: [searchTool(execute)],
        maxSteps: 2
      })
    );

    expect(model.doStreamCalls).toHaveLength(2); // the budget stopped the loop
    expect(execute).toHaveBeenCalledTimes(2);
    expect(events.filter((e) => e.type === "step")).toEqual([
      { type: "step", index: 0 },
      { type: "step", index: 1 }
    ]);
    expect(events.filter((e) => e.type === "tool-call")).toHaveLength(2);
    // Final step produced no text — done still closes the stream honestly.
    expect(events.at(-1)).toEqual({ type: "done", message: { role: "assistant", content: "" } });
  });

  it("defaults the step budget to DEFAULT_AGENT_MAX_STEPS", async () => {
    let calls = 0;
    const model = new MockLanguageModelV4({
      doStream: async () => {
        calls += 1;
        return toolCallTurn(`call-${calls}`, "search_notes", '{"query":"again"}');
      }
    });

    const events = await collect(
      providerFor(model).runAgent({
        messages: [{ role: "user", content: "loop forever" }],
        tools: [searchTool(async () => "ok")]
      })
    );

    expect(model.doStreamCalls).toHaveLength(DEFAULT_AGENT_MAX_STEPS);
    expect(events.at(-1)?.type).toBe("done");
  });

  it("maps a throwing execute to an in-band tool-result { error } and the loop continues", async () => {
    const model = new MockLanguageModelV4({
      doStream: [toolCallTurn("call-1", "search_notes", '{"query":"mito"}'), textTurn(["Recovered."])]
    });

    const events = await collect(
      providerFor(model).runAgent({
        messages: [{ role: "user", content: "try anyway" }],
        tools: [
          searchTool(async () => {
            throw new Error("boom: store offline");
          })
        ]
      })
    );

    const toolResults = events.filter((e) => e.type === "tool-result");
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0]).toMatchObject({ id: "call-1", result: { error: expect.stringContaining("boom") } });
    expect(events.at(-1)).toEqual({ type: "done", message: { role: "assistant", content: "Recovered." } });
  });

  it("rethrows an in-stream error part so the caller's error path runs", async () => {
    const model = new MockLanguageModelV4({
      doStream: {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] } as const,
            { type: "error", error: new Error("kaput") } as const,
            { type: "finish", usage, finishReason } as const
          ]
        })
      }
    });

    await expect(
      collect(providerFor(model).runAgent({ messages: [{ role: "user", content: "hi" }] }))
    ).rejects.toThrow(/kaput/);
  });
});
