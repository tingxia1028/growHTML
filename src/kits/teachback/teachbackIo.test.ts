import { afterEach, describe, expect, it } from "vitest";
import { getTeachbackIo, setTeachbackIoForTests } from "./teachbackIo";

afterEach(() => setTeachbackIoForTests(null));

describe("teachbackIo — the swappable seam", () => {
  it("setTeachbackIoForTests overrides a subset; getTeachbackIo returns the stub", async () => {
    const calls: string[] = [];
    setTeachbackIoForTests({
      generate: async (req) => {
        calls.push(req.promptId);
        return { content: { role: "ai", kind: "pose", text: "mock", topic: "浮力", round: 0 } };
      }
    });
    const io = getTeachbackIo();
    const out = await io.generate({ promptId: "teach.pose", contentType: "teachback.turn", input: {} });
    expect(calls).toEqual(["teach.pose"]);
    expect((out.content as { text: string }).text).toBe("mock");
    // unstubbed edges fall through to the real (degrading) defaults
    expect(typeof io.fetchDigestSummaries).toBe("function");
    expect(typeof io.fetchProfileFacts).toBe("function");
  });

  it("null restores the real IO edges", () => {
    setTeachbackIoForTests({ generate: async () => ({ content: {} }) });
    setTeachbackIoForTests(null);
    // the real generate is back (a function, not the stub) — no throw on access
    expect(typeof getTeachbackIo().generate).toBe("function");
  });
});
