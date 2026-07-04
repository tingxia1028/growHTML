import { describe, expect, it } from "vitest";
import { getNoteContentSpec, parseNoteContent, registerNoteContentSpec } from "../../core/notes/contentTypes";
import { teachbackContentSpecs, teachbackSummarySpec, teachbackTurnSpec } from "./contentTypes";

// Register the kit's React-free specs into the core registry (the same path the server
// uses for API validation) — a bare register, no React import.
for (const spec of teachbackContentSpecs) registerNoteContentSpec(spec);

describe("Teach-back Kit content specs", () => {
  it("registers both teachback content types into the core registry", () => {
    expect(getNoteContentSpec("teachback.summary")).toBeTruthy();
    expect(getNoteContentSpec("teachback.turn")).toBeTruthy();
  });

  it("teachback.turn is a hidden machine type; teachback.summary is user-facing", () => {
    // hidden-ness is a CLIENT plugin flag; the spec here just declares the two types.
    // The kit registers turn with hidden:true (see noteTypes.tsx / index.tsx) — asserted
    // in the register commit; here we assert the specs exist + round-trip.
    expect(teachbackTurnSpec.contentType).toBe("teachback.turn");
    expect(teachbackSummarySpec.contentType).toBe("teachback.summary");
  });

  it("each createDefault round-trips through its own schema", () => {
    for (const spec of [teachbackSummarySpec, teachbackTurnSpec]) {
      expect(() => spec.schema.parse(spec.createDefault())).not.toThrow();
    }
  });

  it("validates a well-formed teachback.summary via the API path", () => {
    expect(() =>
      parseNoteContent("teachback.summary", {
        topic: "浮力",
        explainedWell: ["排开的水"],
        gaps: ["压强差"],
        summary: "讲清了排开水,压强差还没说透。",
        transcript: [{ role: "ai", kind: "pose", text: "为什么浮力只跟排开的水有关?", topic: "浮力", round: 0 }]
      })
    ).not.toThrow();
  });

  it("fills array/default fields on summary parse", () => {
    const parsed = parseNoteContent("teachback.summary", { topic: "浮力" }) as {
      explainedWell: string[];
      gaps: string[];
      summary: string;
      transcript: unknown[];
    };
    expect(parsed.explainedWell).toEqual([]);
    expect(parsed.gaps).toEqual([]);
    expect(parsed.summary).toBe("");
    expect(parsed.transcript).toEqual([]);
  });

  it("validates a teachback.turn and defaults kind/round", () => {
    const parsed = parseNoteContent("teachback.turn", { role: "student", text: "我觉得是排开的水" }) as {
      kind: string;
      round: number;
      topic: string;
    };
    expect(parsed.kind).toBe("explain");
    expect(parsed.round).toBe(0);
    expect(parsed.topic).toBe("");
    // a bad role enum is rejected
    expect(() => parseNoteContent("teachback.turn", { role: "teacher", text: "x" })).toThrow();
  });

  it("reduces content to searchable text without structural noise", () => {
    expect(
      teachbackSummarySpec.toSearchText({
        topic: "浮力",
        explainedWell: ["排开的水"],
        gaps: ["压强差"],
        summary: "讲清了排开水。",
        transcript: []
      })
    ).toBe("浮力\n讲清了排开水。\n排开的水\n压强差");
    expect(
      teachbackTurnSpec.toSearchText({ role: "ai", kind: "pose", text: "为什么?", topic: "浮力", round: 0 })
    ).toBe("浮力\n为什么?");
  });
});
