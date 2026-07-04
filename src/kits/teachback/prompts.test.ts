import { describe, expect, it } from "vitest";
import { teachbackSummarySpec, teachbackTurnSpec } from "./contentTypes";
import { FEYNMAN_PERSONA, posePrompt, probePrompt, wrapupPrompt } from "./prompts";

const PROFILE = "弱项:浮力(错误率 60%)· 连续学习 3 天";

describe("teach-back prompt pack — persona + gating", () => {
  it("pose + probe carry the Feynman confused-student persona", () => {
    const pose = posePrompt.build({ topic: "浮力" });
    const probe = probePrompt.build({ topic: "浮力", weakestTopic: "压强差" });
    for (const built of [pose, probe]) {
      expect(built).toContain(FEYNMAN_PERSONA);
      expect(built.toLowerCase()).toContain("confused");
      expect(built.toLowerCase()).toContain("json");
    }
  });

  it("the profileContext 学生画像 block appears IFF a profileContext is present", () => {
    // absent → byte-identical to no-profile (no 学生画像 marker)
    const noProfile = posePrompt.build({ topic: "浮力" });
    expect(noProfile).not.toContain("学生画像");
    // present → the delimited block is appended
    const withProfile = posePrompt.build({ topic: "浮力", profileContext: PROFILE });
    expect(withProfile).toContain("学生画像");
    expect(withProfile).toContain(PROFILE);
    // the no-profile prefix is preserved verbatim (appended, never interleaved)
    expect(withProfile.startsWith(noProfile)).toBe(true);

    // whitespace-only profile is treated as absent
    expect(posePrompt.build({ topic: "浮力", profileContext: "   " })).toBe(noProfile);
    // same law for probe
    expect(probePrompt.build({ topic: "浮力" })).not.toContain("学生画像");
    expect(probePrompt.build({ topic: "浮力", profileContext: PROFILE })).toContain(PROFILE);
  });

  it("every prompt's outputType matches its target spec contentType", () => {
    expect(posePrompt.outputType).toBe(teachbackTurnSpec.contentType);
    expect(probePrompt.outputType).toBe(teachbackTurnSpec.contentType);
    expect(wrapupPrompt.outputType).toBe(teachbackSummarySpec.contentType);
  });
});

describe("teach-back prompt pack — mockContent validates + stable projection (delta 4)", () => {
  it("pose mock is schema-valid and deterministically names input.topic", () => {
    const sample = posePrompt.mockContent!({ topic: "浮力" });
    expect(() => teachbackTurnSpec.schema.parse(sample)).not.toThrow();
    const turn = teachbackTurnSpec.schema.parse(sample);
    expect(turn.role).toBe("ai");
    expect(turn.kind).toBe("pose");
    expect(turn.topic).toBe("浮力");
    expect(turn.text).toContain("浮力"); // the pose names the topic (intentional output)
    // pure/stable: identical input → identical output
    expect(posePrompt.mockContent!({ topic: "浮力" })).toEqual(sample);
  });

  it("probe mock is schema-valid and deterministically names input.weakestTopic (fixed-shape)", () => {
    const sample = probePrompt.mockContent!({ topic: "浮力", weakestTopic: "压强差", round: 2 });
    const turn = teachbackTurnSpec.schema.parse(sample);
    expect(turn.role).toBe("ai");
    expect(turn.kind).toBe("probe");
    expect(turn.round).toBe(2);
    expect(turn.text).toContain("压强差"); // probe names the WEAKEST topic, not the topic
    // weakestTopic falls back to topic when absent, still stable
    const fallback = teachbackTurnSpec.schema.parse(probePrompt.mockContent!({ topic: "浮力", round: 1 }));
    expect(fallback.text).toContain("浮力");
    expect(probePrompt.mockContent!({ topic: "浮力", round: 1 })).toEqual(fallback);
  });

  it("wrapup mock is schema-valid and projects studentPoints→explainedWell, openGaps→gaps", () => {
    const sample = wrapupPrompt.mockContent!({
      topic: "浮力",
      studentPoints: ["浮力等于排开的水重", "阿基米德原理"],
      openGaps: ["压强差推导"],
      turns: [{ role: "ai", kind: "pose", text: "为什么?", topic: "浮力", round: 0 }]
    });
    const parsed = teachbackSummarySpec.schema.parse(sample);
    expect(parsed.topic).toBe("浮力");
    expect(parsed.explainedWell).toEqual(["浮力等于排开的水重", "阿基米德原理"]);
    expect(parsed.gaps).toEqual(["压强差推导"]);
    expect(parsed.summary).toContain("浮力");
    expect(parsed.transcript).toHaveLength(1);
    // pure/stable
    expect(
      wrapupPrompt.mockContent!({
        topic: "浮力",
        studentPoints: ["浮力等于排开的水重", "阿基米德原理"],
        openGaps: ["压强差推导"],
        turns: [{ role: "ai", kind: "pose", text: "为什么?", topic: "浮力", round: 0 }]
      })
    ).toEqual(sample);
  });

  it("empty inputs still yield schema-valid mocks (no crash on a fresh session)", () => {
    expect(() => teachbackTurnSpec.schema.parse(posePrompt.mockContent!({}))).not.toThrow();
    expect(() => teachbackTurnSpec.schema.parse(probePrompt.mockContent!({}))).not.toThrow();
    expect(() => teachbackSummarySpec.schema.parse(wrapupPrompt.mockContent!({}))).not.toThrow();
  });
});
