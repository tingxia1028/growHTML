import { describe, expect, it } from "vitest";
import { teachbackSummarySpec } from "./contentTypes";
import { wrapupPrompt } from "./prompts";
import {
  atRoundCap,
  initialSession,
  openGaps,
  pickTopics,
  studentPoints,
  teachbackReducer,
  TEACHBACK_MAX_ROUNDS,
  TEACHBACK_TOPIC_LIMIT,
  type TeachbackSession
} from "./teachbackSession";
import type { MemoryDimensionSummary } from "../../core/memory/digest";

// A weak-bucket digest summary cell (the minimum weakReviewBuckets reads).
function weakCell(dimension: MemoryDimensionSummary["dimension"], bucket: string, failRatio: number, attempts: number): MemoryDimensionSummary {
  return {
    dimension,
    bucket,
    events: attempts,
    counts: {},
    review: { attempts, passes: 0, fails: Math.round(attempts * failRatio), skips: 0, failRatio },
    firstAt: "2026-07-01T00:00:00.000Z",
    lastAt: "2026-07-05T00:00:00.000Z"
  } as unknown as MemoryDimensionSummary;
}

const aiPose = { role: "ai" as const, kind: "pose" as const, text: "教教我浮力?", topic: "浮力", round: 0 };
const aiProbe = (round: number) => ({ role: "ai" as const, kind: "probe" as const, text: `第 ${round} 问`, topic: "浮力", round });

describe("teachback reducer — phase transitions", () => {
  it("init seeds picking with topics; pick → posing → explaining", () => {
    let s = teachbackReducer(initialSession(), { type: "init", topics: ["浮力", "压强"] });
    expect(s.phase).toBe("picking");
    expect(s.topics).toEqual(["浮力", "压强"]);

    s = teachbackReducer(s, { type: "pick", topic: "浮力" });
    expect(s.phase).toBe("posing");
    expect(s.topic).toBe("浮力");

    s = teachbackReducer(s, { type: "posed", turn: aiPose });
    expect(s.phase).toBe("explaining");
    expect(s.turns).toHaveLength(1);
  });

  it("explain → probing, probed → explaining (a full round loop)", () => {
    let s: TeachbackSession = { ...initialSession(), phase: "explaining", topic: "浮力", turns: [aiPose], round: 0 };
    s = teachbackReducer(s, { type: "explain", text: "浮力等于排开的水重" });
    expect(s.phase).toBe("probing");
    expect(s.round).toBe(1);
    expect(studentPoints(s)).toEqual(["浮力等于排开的水重"]);

    s = teachbackReducer(s, { type: "probed", turn: aiProbe(1) });
    expect(s.phase).toBe("explaining");
    expect(openGaps(s)).toEqual(["第 1 问"]);
  });

  it("illegal actions for a phase are no-ops (double dispatch / stray callback safe)", () => {
    const s: TeachbackSession = { ...initialSession(), phase: "posing", topic: "浮力" };
    // an explain while posing is ignored (waiting for the pose to arrive)
    expect(teachbackReducer(s, { type: "explain", text: "x" })).toBe(s);
    // a second pick while posing is ignored
    expect(teachbackReducer(s, { type: "pick", topic: "别的" })).toBe(s);
    // an empty explanation is ignored
    const explaining: TeachbackSession = { ...s, phase: "explaining" };
    expect(teachbackReducer(explaining, { type: "explain", text: "   " })).toBe(explaining);
  });
});

describe("teachback reducer — round cap", () => {
  it("the (TEACHBACK_MAX_ROUNDS)th explanation drives to assessing, not another probe", () => {
    let s: TeachbackSession = { ...initialSession(), phase: "explaining", topic: "浮力", turns: [aiPose], round: 0 };
    for (let r = 1; r <= TEACHBACK_MAX_ROUNDS; r += 1) {
      expect(s.phase).toBe("explaining");
      s = teachbackReducer(s, { type: "explain", text: `解释 ${r}` });
      if (r < TEACHBACK_MAX_ROUNDS) {
        expect(s.phase).toBe("probing");
        expect(atRoundCap(s)).toBe(false);
        s = teachbackReducer(s, { type: "probed", turn: aiProbe(r) });
      } else {
        // the cap hit → assessing (no more probes)
        expect(s.phase).toBe("assessing");
        expect(atRoundCap(s)).toBe(true);
      }
    }
    expect(s.round).toBe(TEACHBACK_MAX_ROUNDS);
  });

  it("end early from an active phase → assessing", () => {
    const explaining: TeachbackSession = { ...initialSession(), phase: "explaining", topic: "浮力", turns: [aiPose] };
    expect(teachbackReducer(explaining, { type: "end" }).phase).toBe("assessing");
    const probing: TeachbackSession = { ...initialSession(), phase: "probing", topic: "浮力" };
    expect(teachbackReducer(probing, { type: "end" }).phase).toBe("assessing");
  });
});

describe("teachback reducer — empty-topic state (delta 5)", () => {
  it("init with NO topics → the empty phase (a fresh vault, weakReviewBuckets [])", () => {
    const s = teachbackReducer(initialSession(), { type: "init", topics: [] });
    expect(s.phase).toBe("empty");
    expect(s.topics).toEqual([]);
    // whitespace-only topics are filtered out too → still empty
    expect(teachbackReducer(initialSession(), { type: "init", topics: ["  ", ""] }).phase).toBe("empty");
  });

  it("a manual pick from the empty state still starts a session (fresh-user arming)", () => {
    let s = teachbackReducer(initialSession(), { type: "init", topics: [] });
    expect(s.phase).toBe("empty");
    s = teachbackReducer(s, { type: "pick", topic: "自选主题" });
    expect(s.phase).toBe("posing");
    expect(s.topic).toBe("自选主题");
  });
});

describe("teachback reducer — wrap-up assembles a valid teachback.summary", () => {
  it("the wrapup prompt's mock over the session projects a schema-valid summary; wrapped → done", () => {
    // Build a completed session transcript.
    let s: TeachbackSession = { ...initialSession(), phase: "explaining", topic: "浮力", turns: [aiPose], round: 0 };
    s = teachbackReducer(s, { type: "explain", text: "浮力等于排开的水重" });
    s = teachbackReducer(s, { type: "probed", turn: aiProbe(1) });
    s = teachbackReducer(s, { type: "explain", text: "阿基米德原理" });
    s = teachbackReducer(s, { type: "probed", turn: aiProbe(2) });
    s = teachbackReducer(s, { type: "explain", text: "压强差推导" }); // 3rd → assessing
    expect(s.phase).toBe("assessing");

    // The panel feeds the session into the wrapup prompt's mock (the deterministic seam).
    const summary = wrapupPrompt.mockContent!({
      topic: s.topic,
      studentPoints: studentPoints(s),
      openGaps: openGaps(s),
      turns: s.turns
    });
    const parsed = teachbackSummarySpec.schema.parse(summary);
    expect(parsed.topic).toBe("浮力");
    expect(parsed.explainedWell).toEqual(["浮力等于排开的水重", "阿基米德原理", "压强差推导"]);
    expect(parsed.gaps).toEqual(["第 1 问", "第 2 问"]);
    expect(parsed.transcript.length).toBe(s.turns.length);

    const done = teachbackReducer(s, { type: "wrapped", summary: parsed });
    expect(done.phase).toBe("done");
    expect(done.wrapUp).toEqual(parsed);
  });
});

describe("pickTopics — weak buckets → human-teachable topics", () => {
  it("prefers subject/contentType buckets, drops sourceId, caps the list", () => {
    const summaries = [
      weakCell("subject", "浮力", 0.7, 10),
      weakCell("contentType", "mistake", 0.6, 8),
      weakCell("sourceId", "src_1", 0.9, 12), // dropped (not human-teachable)
      weakCell("subject", "压强", 0.5, 6),
      weakCell("subject", "电路", 0.5, 6),
      weakCell("subject", "光学", 0.5, 6),
      weakCell("subject", "热学", 0.5, 6)
    ];
    const topics = pickTopics(summaries);
    expect(topics).not.toContain("src_1");
    expect(topics.length).toBeLessThanOrEqual(TEACHBACK_TOPIC_LIMIT);
    expect(topics[0]).toBe("浮力"); // strongest fail ratio first (weakReviewBuckets order)
  });

  it("empty on a fresh vault (no weak buckets) → drives the empty state", () => {
    expect(pickTopics([])).toEqual([]);
  });
});
