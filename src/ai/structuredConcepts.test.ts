// CG-2 "AI 顺手挂" engine seam — the `concepts` side-channel on structured outputs:
// captured + STRIPPED before schema validation (a STRICT schema proves the strip),
// requested via the system message only when asked, off by default.

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MockModelProvider } from "./mockProvider";
import type { ChatRequest, ChatResponse, ModelProvider } from "./provider";
import { generateStructured, generateStructuredWithConcepts } from "./structured";

// A strict schema: an un-stripped `concepts` key would FAIL validation, so a passing
// parse proves the side-channel was removed before schema.parse.
const strictThing = z.strictObject({ title: z.string(), n: z.number() });

function fakeProvider(reply: string): ModelProvider & { seen: ChatRequest[] } {
  const seen: ChatRequest[] = [];
  return {
    id: "fake",
    capabilities: { chat: true, agentic: false, streaming: false, structured: false, tools: false, kind: "mock" },
    seen,
    async complete(request: ChatRequest): Promise<ChatResponse> {
      seen.push(request);
      return { message: { role: "assistant", content: reply } };
    }
  };
}

describe("generateStructuredWithConcepts", () => {
  it("captures + strips the concepts side-channel before validating a strict schema", async () => {
    const provider = fakeProvider('{"title":"buoyancy","n":1,"concepts":["浮力","阿基米德原理"]}');
    const result = await generateStructuredWithConcepts(provider, {
      messages: [{ role: "user", content: "q" }],
      schema: strictThing,
      suggestConcepts: true
    });
    expect(result.output).toEqual({ title: "buoyancy", n: 1 });
    expect(result.concepts).toEqual(["浮力", "阿基米德原理"]);
    // The system message asked for the side-channel.
    expect(provider.seen[0].messages[0].content).toContain("concepts");
  });

  it("returns empty concepts when the model omits them or entries are junk", async () => {
    const provider = fakeProvider('{"title":"a","n":2,"concepts":[42,"  ",null,"ok"]}');
    const result = await generateStructuredWithConcepts(provider, {
      messages: [{ role: "user", content: "q" }],
      schema: strictThing,
      suggestConcepts: true
    });
    expect(result.concepts).toEqual(["ok"]);

    const silent = fakeProvider('{"title":"b","n":3}');
    const none = await generateStructuredWithConcepts(silent, {
      messages: [{ role: "user", content: "q" }],
      schema: strictThing,
      suggestConcepts: true
    });
    expect(none.concepts).toEqual([]);
  });

  it("is OFF by default: no ask in the prompt, no stripping, legacy path identical", async () => {
    const provider = fakeProvider('{"title":"c","n":4}');
    const out = await generateStructured(provider, {
      messages: [{ role: "user", content: "q" }],
      schema: strictThing
    });
    expect(out).toEqual({ title: "c", n: 4 });
    expect(provider.seen[0].messages[0].content).not.toContain("concepts");
  });

  it("rides the mock provider's sample echo (deterministic offline seam)", async () => {
    const mock = new MockModelProvider();
    const result = await generateStructuredWithConcepts(mock, {
      messages: [{ role: "user", content: "q" }],
      schema: strictThing,
      sample: { title: "seeded", n: 9, concepts: ["密度"] },
      suggestConcepts: true
    });
    expect(result.output).toEqual({ title: "seeded", n: 9 });
    expect(result.concepts).toEqual(["密度"]);
  });
});
