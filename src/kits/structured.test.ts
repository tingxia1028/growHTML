import { describe, expect, it } from "vitest";
import { z } from "zod";
import { registerNoteContentSpec } from "../core/notes/contentTypes";
import { registerKitPrompt } from "./prompts";
import { extractJson, generateStructuredContent, StructuredGenerationError } from "./structured";
import { MockModelProvider } from "../ai/mockProvider";
import type { ChatRequest, ChatResponse, ModelProvider } from "../ai/provider";

// Isolated test type + prompt so the structured path is verified independent of any kit.
registerNoteContentSpec({
  contentType: "test.thing",
  schema: z.object({ title: z.string(), n: z.number() }),
  createDefault: () => ({ title: "", n: 0 }),
  toSearchText: (c) => (c as { title: string }).title
});
registerKitPrompt({
  id: "test.make-thing",
  outputType: "test.thing",
  build: (input) => `make a thing about ${JSON.stringify(input)}`,
  mockContent: (input) => ({ title: String((input as { topic?: string }).topic ?? "x"), n: 1 })
});

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

describe("generateStructuredContent", () => {
  it("returns the prompt's deterministic mock content via the mock provider", async () => {
    const out = await generateStructuredContent(new MockModelProvider(), {
      promptId: "test.make-thing",
      contentType: "test.thing",
      input: { topic: "photosynthesis" }
    });
    expect(out).toEqual({ title: "photosynthesis", n: 1 });
  });

  it("retries a text provider that first emits invalid output, then validates", async () => {
    let calls = 0;
    const flaky: ModelProvider = {
      id: "flaky",
      capabilities: { chat: true, agentic: false, streaming: false },
      async complete(_req: ChatRequest): Promise<ChatResponse> {
        calls += 1;
        const content = calls === 1 ? "oops not json" : '{"title":"ok","n":5}';
        return { message: { role: "assistant", content } };
      }
    };
    const out = await generateStructuredContent(flaky, {
      promptId: "test.make-thing",
      contentType: "test.thing"
    });
    expect(out).toEqual({ title: "ok", n: 5 });
    expect(calls).toBe(2);
  });

  it("throws after exhausting attempts on persistently invalid output", async () => {
    const bad: ModelProvider = {
      id: "bad",
      capabilities: { chat: true, agentic: false, streaming: false },
      async complete(): Promise<ChatResponse> {
        return { message: { role: "assistant", content: "{\"title\":123}" } };
      }
    };
    await expect(
      generateStructuredContent(bad, { promptId: "test.make-thing", contentType: "test.thing" }, 2)
    ).rejects.toBeInstanceOf(StructuredGenerationError);
  });

  it("rejects unknown promptId / contentType / mismatched output type", async () => {
    const mock = new MockModelProvider();
    await expect(
      generateStructuredContent(mock, { promptId: "nope", contentType: "test.thing" })
    ).rejects.toBeInstanceOf(StructuredGenerationError);
    await expect(
      generateStructuredContent(mock, { promptId: "test.make-thing", contentType: "nope" })
    ).rejects.toBeInstanceOf(StructuredGenerationError);
  });
});
