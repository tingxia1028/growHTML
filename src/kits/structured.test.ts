import { describe, expect, it } from "vitest";
import { z } from "zod";
import { registerNoteContentSpec } from "../core/notes/contentTypes";
import { registerKitPrompt } from "./prompts";
import { extractJson, generateStructuredContent, StructuredGenerationError } from "./structured";
import { resolvePrompt } from "./resolvePrompt";
import { operationSchema, type OperationRecord } from "../core/schema";
import type { SnapshotStore } from "../core/store/snapshotStore";
import { MockModelProvider } from "../ai/mockProvider";
import type { ChatRequest, ChatResponse, ModelProvider } from "../ai/provider";

// A minimal in-memory SnapshotStore over a fixed set of operations — enough to
// exercise resolvePrompt + generateStructuredContent without touching disk.
function memoryOperationStore(records: OperationRecord[]): SnapshotStore<OperationRecord> {
  const byId = new Map(records.map((r) => [r.id, r]));
  return {
    async list() {
      return Array.from(byId.values());
    },
    async readWithIssues() {
      return { records: Array.from(byId.values()), issues: [] };
    },
    async get(id: string) {
      return byId.get(id) ?? null;
    },
    async upsert(record: OperationRecord) {
      byId.set(record.id, record);
      return record;
    },
    async delete(id: string) {
      return byId.delete(id);
    }
  };
}

const storedThingOp = operationSchema.parse({
  id: "op_01HZZZZZZZZZZZZZZZZZZZZZZ0",
  type: "operation",
  schemaVersion: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  createdBy: "user",
  name: "My Thing",
  outputContentType: "test.thing",
  promptTemplate: "make a thing about {{topic}}",
  declaredVariables: [{ name: "topic", source: "anchorText" }],
  source: "custom"
});

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

describe("resolvePrompt", () => {
  it("returns a built-in KitPrompt verbatim (mockContent preserved)", async () => {
    const resolved = await resolvePrompt("test.make-thing");
    expect(resolved?.id).toBe("test.make-thing");
    expect(resolved?.outputType).toBe("test.thing");
    expect(resolved?.mockContent?.({ topic: "x" })).toEqual({ title: "x", n: 1 });
  });

  it("wraps a stored operation into a KitPrompt whose build() renders the template", async () => {
    const store = memoryOperationStore([storedThingOp]);
    const resolved = await resolvePrompt(storedThingOp.id, store);
    expect(resolved?.outputType).toBe("test.thing");
    expect(resolved?.mockContent).toBeUndefined();
    // declaredVariables map runtime input through by name; missing → "".
    expect(resolved?.build({ topic: "the ocean" })).toBe("make a thing about the ocean");
    expect(resolved?.build({})).toBe("make a thing about ");
  });

  it("applies a literal variable's default and runtime fallback", async () => {
    const op = operationSchema.parse({
      ...storedThingOp,
      promptTemplate: "{{lead}} about {{topic}}",
      declaredVariables: [
        { name: "lead", source: "literal", default: "Tell me" },
        { name: "topic", source: "anchorText", default: "everything" }
      ]
    });
    const resolved = await resolvePrompt(op.id, memoryOperationStore([op]));
    // literal always uses its default; non-literal falls back to default when absent.
    expect(resolved?.build({})).toBe("Tell me about everything");
    expect(resolved?.build({ topic: "ducks" })).toBe("Tell me about ducks");
  });

  it("returns undefined for an unknown id (no store / not stored)", async () => {
    expect(await resolvePrompt("nope")).toBeUndefined();
    expect(await resolvePrompt("op_does_not_exist", memoryOperationStore([]))).toBeUndefined();
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
      capabilities: { chat: true, agentic: false, streaming: false, structured: false, tools: false, kind: "mock" },
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
      capabilities: { chat: true, agentic: false, streaming: false, structured: false, tools: false, kind: "mock" },
      async complete(): Promise<ChatResponse> {
        return { message: { role: "assistant", content: "{\"title\":123}" } };
      }
    };
    await expect(
      generateStructuredContent(bad, { promptId: "test.make-thing", contentType: "test.thing" }, 2)
    ).rejects.toBeInstanceOf(StructuredGenerationError);
  });

  it("runs a STORED data operation end-to-end via resolvePrompt + store", async () => {
    const store = memoryOperationStore([storedThingOp]);
    // The mock provider has no mockContent for a data op, so it echoes the spec's
    // createDefault (deterministic + schema-valid).
    const out = await generateStructuredContent(
      new MockModelProvider(),
      { promptId: storedThingOp.id, contentType: "test.thing", input: { topic: "tides" } },
      3,
      store
    );
    expect(out).toEqual({ title: "", n: 0 });
  });

  it("still resolves a built-in prompt with the new optional store param", async () => {
    const store = memoryOperationStore([storedThingOp]);
    const out = await generateStructuredContent(
      new MockModelProvider(),
      { promptId: "test.make-thing", contentType: "test.thing", input: { topic: "photosynthesis" } },
      3,
      store
    );
    expect(out).toEqual({ title: "photosynthesis", n: 1 });
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
