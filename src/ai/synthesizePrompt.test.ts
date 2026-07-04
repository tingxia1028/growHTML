import { describe, expect, it } from "vitest";
import type { ChatContext, ChatMessage } from "./provider";
import {
  buildSynthesisMessages,
  synthesisDocSchema,
  SYNTHESIS_TRANSCRIPT_CAP
} from "./synthesizePrompt";

const transcript: ChatMessage[] = [
  { role: "user", content: "Explain mitochondria." },
  { role: "assistant", content: "Mitochondria are the powerhouse of the cell." },
  { role: "user", content: "Now turn that into a study doc." }
];

describe("synthesisDocSchema (DELTA 3)", () => {
  it("accepts a non-empty {title, markdown}", () => {
    const parsed = synthesisDocSchema.parse({ title: "T", markdown: "# H" });
    expect(parsed).toEqual({ title: "T", markdown: "# H" });
  });

  it("rejects an empty title OR empty markdown (min(1) blocks a blank source)", () => {
    expect(() => synthesisDocSchema.parse({ title: "", markdown: "# H" })).toThrow();
    expect(() => synthesisDocSchema.parse({ title: "T", markdown: "" })).toThrow();
  });
});

describe("buildSynthesisMessages", () => {
  it("carries the transcript turns + the synthesis instruction", () => {
    const [system, user] = buildSynthesisMessages({ transcript });
    expect(system.role).toBe("system");
    expect(system.content).toContain("Markdown headings");
    expect(user.role).toBe("user");
    expect(user.content).toContain("Explain mitochondria.");
    expect(user.content).toContain("powerhouse of the cell");
    expect(user.content).toContain("turn that into a study doc");
  });

  it("weaves attached-source EXCERPTS into the system message", () => {
    const context: ChatContext = {
      sources: [{ title: "ATP", type: "html", excerpt: "ATP synthase produces ATP." }]
    };
    const [system] = buildSynthesisMessages({ transcript, context });
    expect(system.content).toContain("ATP synthase produces ATP.");
    expect(system.content).toContain("ATP");
  });

  it("emits the 'Attached: N source(s)' marker when sources are present", () => {
    const context: ChatContext = {
      sources: [
        { title: "A", excerpt: "aaa" },
        { title: "B", excerpt: "bbb" }
      ]
    };
    const [system] = buildSynthesisMessages({ transcript, context });
    expect(system.content).toContain("Attached: 2 source(s)");
  });

  it("emits NO 'Attached' marker at zero attachments (byte-identical preamble path)", () => {
    const [systemNoCtx] = buildSynthesisMessages({ transcript });
    expect(systemNoCtx.content).not.toContain("Attached:");
    const [systemEmpty] = buildSynthesisMessages({ transcript, context: { sources: [] } });
    expect(systemEmpty.content).not.toContain("Attached:");
  });

  it("appends an optional extra instruction to the system directive", () => {
    const [system] = buildSynthesisMessages({ transcript, instruction: "Keep it under 500 words." });
    expect(system.content).toContain("Keep it under 500 words.");
  });

  it("over-cap: drops OLDEST turns but keeps the final user turn", () => {
    // Build a transcript far over the cap: many big old turns + a final user marker.
    const filler = "x".repeat(2000);
    const big: ChatMessage[] = [];
    for (let i = 0; i < 40; i += 1) {
      big.push({ role: i % 2 === 0 ? "user" : "assistant", content: `OLD${i} ${filler}` });
    }
    const finalMarker = "FINAL_INSTRUCTION_KEEP_ME";
    big.push({ role: "user", content: finalMarker });

    const [, user] = buildSynthesisMessages({ transcript: big });
    // The final user turn always survives…
    expect(user.content).toContain(finalMarker);
    // …the very oldest turn is dropped (the cap forced eviction from the front)…
    expect(user.content).not.toContain("OLD0 ");
    // …and the rendered transcript stays within the budget (plus the final turn slack).
    expect(user.content.length).toBeLessThanOrEqual(SYNTHESIS_TRANSCRIPT_CAP + finalMarker.length + 200);
  });

  it("keeps every turn when the transcript is under the cap", () => {
    const [, user] = buildSynthesisMessages({ transcript });
    expect(user.content).toContain("Explain mitochondria.");
    expect(user.content).toContain("powerhouse of the cell");
    expect(user.content).toContain("turn that into a study doc");
  });

  it("empty transcript still produces a valid two-message request (attachments-only synth)", () => {
    const messages = buildSynthesisMessages({ transcript: [] });
    expect(messages).toHaveLength(2);
    expect(messages[1].role).toBe("user");
    expect(messages[1].content.length).toBeGreaterThan(0);
  });
});
