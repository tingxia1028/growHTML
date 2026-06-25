import { describe, expect, it } from "vitest";
import { z } from "zod";
import { extractJson, generateStructured, StructuredGenerationError } from "./structured";
import { MockModelProvider } from "./mockProvider";
import type { ChatRequest, ChatResponse, ModelProvider, StructuredRequest } from "./provider";

// The base engine is kit-agnostic: the caller passes a zod schema + messages (and,
// for the mock, a deterministic sample). These tests exercise the engine directly,
// with NO kit / core content spec involved.
const schema = z.object({ title: z.string(), n: z.number() });

describe("extractJson", () => {
  it("parses bare JSON, fenced JSON, and JSON embedded in prose", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson("```json\n{\"a\":2}\n```")).toEqual({ a: 2 });
    expect(extractJson("Sure! Here:\n{\"a\":3}\nHope that helps")).toEqual({ a: 3 });
  });
  it("throws when there is no JSON object", () => {
    expect(() => extractJson("no json here")).toThrow();
  });
});

describe("generateStructured", () => {
  it("validates the mock's echoed sample against the schema", async () => {
    const out = await generateStructured(new MockModelProvider(), {
      messages: [{ role: "user", content: "make a thing" }],
      schema,
      sample: { title: "hello", n: 7 },
      contentType: "test.thing"
    });
    expect(out).toEqual({ title: "hello", n: 7 });
  });

  it("prepends a JSON-only system message before the caller's messages", async () => {
    let seen: ChatRequest | null = null;
    const provider: ModelProvider = {
      id: "spy",
      capabilities: { chat: true, agentic: false, streaming: false },
      async complete(req: ChatRequest): Promise<ChatResponse> {
        seen = req;
        return { message: { role: "assistant", content: '{"title":"x","n":1}' } };
      }
    };
    await generateStructured(provider, { messages: [{ role: "user", content: "q" }], schema });
    expect(seen!.messages[0].role).toBe("system");
    expect(seen!.messages[1]).toEqual({ role: "user", content: "q" });
  });

  it("re-prompts with the validation error, then validates on retry", async () => {
    let calls = 0;
    const flaky: ModelProvider = {
      id: "flaky",
      capabilities: { chat: true, agentic: false, streaming: false },
      async complete(req: ChatRequest): Promise<ChatResponse> {
        calls += 1;
        // First reply is malformed; the engine should append a corrective user turn.
        if (calls === 1) return { message: { role: "assistant", content: "oops not json" } };
        // The corrective message is the last one before this second attempt.
        expect(req.messages[req.messages.length - 1].role).toBe("user");
        return { message: { role: "assistant", content: '{"title":"ok","n":5}' } };
      }
    };
    const out = await generateStructured(flaky, { messages: [{ role: "user", content: "q" }], schema });
    expect(out).toEqual({ title: "ok", n: 5 });
    expect(calls).toBe(2);
  });

  it("throws StructuredGenerationError after exhausting attempts", async () => {
    const bad: ModelProvider = {
      id: "bad",
      capabilities: { chat: true, agentic: false, streaming: false },
      async complete(): Promise<ChatResponse> {
        return { message: { role: "assistant", content: '{"title":123}' } };
      }
    };
    await expect(
      generateStructured(bad, { messages: [{ role: "user", content: "q" }], schema }, 2)
    ).rejects.toBeInstanceOf(StructuredGenerationError);
  });

  it("uses completeStructured (with sample + contentType) when the provider has it", async () => {
    let seen: StructuredRequest | null = null;
    const provider: ModelProvider = {
      id: "structured",
      capabilities: { chat: true, agentic: false, streaming: false },
      async complete(): Promise<ChatResponse> {
        throw new Error("complete() should not be called when completeStructured exists");
      },
      async completeStructured(req: StructuredRequest): Promise<{ json: string }> {
        seen = req;
        return { json: JSON.stringify(req.sample) };
      }
    };
    const out = await generateStructured(provider, {
      messages: [{ role: "user", content: "q" }],
      schema,
      sample: { title: "via-structured", n: 2 },
      contentType: "test.thing"
    });
    expect(out).toEqual({ title: "via-structured", n: 2 });
    expect(seen!.contentType).toBe("test.thing");
  });
});
