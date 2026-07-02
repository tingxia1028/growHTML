import { afterEach, describe, expect, it } from "vitest";
import {
  DETECTION_THRESHOLD,
  detectKit,
  listKitDetections,
  registerKitDetection,
  resetKitDetections,
  scoreKitDetection,
  type KitDetectionTable
} from "./detectSubject";

// The M-A engine (subject-kits.md §3.2, post-F4 kit-centric): pure scorer + registry.
// Buckets: title 0.6 · sourceType 0.1 · latex 0.3 · lang 0.3 · content keyword 0.2,
// clamped to [0,1]; threshold 0.35; total order = score DESC → weight DESC → kitId ASC.

const mathKit: KitDetectionTable = {
  kitId: "subject-math",
  titleKeywords: ["数学", "代数", "Calculus"],
  titlePatterns: [/\b(math|algebra)\b/i],
  sourceTypes: ["pdf", "markdown"],
  contentSignals: { latexDensity: 3 },
  weight: 1
};

const scienceKit: KitDetectionTable = {
  kitId: "subject-science",
  titleKeywords: ["物理", "化学", "生物"],
  titlePatterns: [/\b(physics|chemistry|biology)\b/i],
  sourceTypes: ["pdf"],
  contentSignals: { latexDensity: 2, keywords: ["NaCl", "mol", "细胞"] },
  weight: 2
};

const englishKit: KitDetectionTable = {
  kitId: "subject-english",
  titleKeywords: ["英语", "English"],
  titlePatterns: [],
  sourceTypes: ["webpage", "transcript"],
  contentSignals: { langHint: "en" },
  weight: 1
};

afterEach(() => resetKitDetections());

describe("scoreKitDetection — bucket scoring, explainable signals", () => {
  it("a title keyword scores 0.6 and names the keyword that fired", () => {
    const c = scoreKitDetection(mathKit, { title: "高一数学 必修一" });
    expect(c.confidence).toBe(0.6);
    expect(c.signals).toEqual([{ kind: "title-keyword", value: "数学", points: 0.6 }]);
  });

  it("a title pattern scores 0.6; keyword AND pattern together still count the bucket once", () => {
    const byPattern = scoreKitDetection(mathKit, { title: "Intro to Algebra" });
    expect(byPattern.confidence).toBe(0.6);
    expect(byPattern.signals[0]?.kind).toBe("title-pattern");
    // "Calculus" keyword + /math/ pattern both present → still one title signal, 0.6.
    const both = scoreKitDetection(mathKit, { title: "Calculus and math tricks" });
    expect(both.confidence).toBe(0.6);
    expect(both.signals).toHaveLength(1);
  });

  it("sourceType is a weak +0.1 hint that stacks with the title bucket", () => {
    expect(scoreKitDetection(mathKit, { sourceType: "pdf" }).confidence).toBe(0.1);
    expect(scoreKitDetection(mathKit, { title: "数学", sourceType: "pdf" }).confidence).toBe(0.7);
  });

  it("content probes: latex density (+0.3) and body keyword (+0.2) fire on the sample", () => {
    const latexSample = "设 $E_k = \\frac{1}{2}mv^2$ 且 $F=ma$，见 \\(p=mv\\)。"; // 3 hits, short sample
    const latex = scoreKitDetection(mathKit, { contentSample: latexSample });
    expect(latex.confidence).toBe(0.3);
    expect(latex.signals[0]?.kind).toBe("latex-density");

    const keyword = scoreKitDetection(scienceKit, { contentSample: "滴入 NaCl 溶液后观察沉淀。" });
    expect(keyword.confidence).toBe(0.2);
    expect(keyword.signals).toEqual([{ kind: "content-keyword", value: "NaCl", points: 0.2 }]);
  });

  it("langHint fires only on a judgeable, dominant sample", () => {
    const english = "The quick brown fox jumps over the lazy dog while reading an English passage aloud.";
    expect(scoreKitDetection(englishKit, { contentSample: english }).confidence).toBe(0.3);
    // Too few letters to judge → silent.
    expect(scoreKitDetection(englishKit, { contentSample: "ok" }).confidence).toBe(0);
    // Chinese-dominant sample (well past the min-letter bar) does not match an "en" hint.
    const chinese =
      "这是一段完全以中文书写的样例文本，用来验证语言比例探针不会误报英文提示，" +
      "字数足够多以便真正走到主导比例的判断分支而不是被最小字数门槛拦下。";
    expect(scoreKitDetection(englishKit, { contentSample: chinese }).confidence).toBe(0);
  });

  it("signals sum to the confidence, clamped to 1", () => {
    const sample = `公式 $F=ma$ 与 $E=mc^2$ 还有 $p=mv$ 出现在很短的样文里，NaCl mol 细胞。`;
    const c = scoreKitDetection(scienceKit, { title: "高中物理", sourceType: "pdf", contentSample: sample });
    // title 0.6 + sourceType 0.1 + latex 0.3 + keyword 0.2 = 1.2 → clamp 1.
    expect(c.confidence).toBe(1);
    const sum = c.signals.reduce((total, s) => total + s.points, 0);
    expect(Math.round(sum * 100)).toBe(120);
  });

  it("never throws on a broken table — it just scores 0", () => {
    const broken = { kitId: "broken", titleKeywords: null, titlePatterns: null } as unknown as KitDetectionTable;
    expect(scoreKitDetection(broken, { title: "anything" }).confidence).toBe(0);
  });
});

describe("detectKit — threshold, ties, determinism", () => {
  it("a title hit clears the threshold; a bare sourceType hint does not", () => {
    const win = detectKit({ title: "初三化学教材", sourceType: "pdf" }, [mathKit, scienceKit]);
    expect(win.kitId).toBe("subject-science");
    expect(win.confidence).toBeGreaterThanOrEqual(DETECTION_THRESHOLD);

    const weak = detectKit({ title: "untitled scan", sourceType: "pdf" }, [mathKit, scienceKit]);
    expect(weak.kitId).toBeNull(); // 0.1 < 0.35
    expect(weak.candidates.map((c) => c.kitId).sort()).toEqual(["subject-math", "subject-science"]);
  });

  it("no signals at all → the none result with empty candidates", () => {
    expect(detectKit({ title: "散文随笔" }, [mathKit, scienceKit])).toEqual({
      kitId: null,
      confidence: 0,
      signals: [],
      candidates: []
    });
  });

  it("tie-break: equal score → higher weight wins; equal weight → kitId ascending", () => {
    // Both titles hit (数学 + 化学) → 0.6 each; science carries weight 2 → wins.
    const byWeight = detectKit({ title: "数学与化学竞赛讲义" }, [mathKit, scienceKit]);
    expect(byWeight.kitId).toBe("subject-science");
    expect(byWeight.candidates.map((c) => c.kitId)).toEqual(["subject-science", "subject-math"]);

    // Equal score AND equal weight → kitId ASC decides (a-kit < b-kit).
    const a: KitDetectionTable = { kitId: "b-kit", titleKeywords: ["shared"], titlePatterns: [] };
    const b: KitDetectionTable = { kitId: "a-kit", titleKeywords: ["shared"], titlePatterns: [] };
    expect(detectKit({ title: "shared topic" }, [a, b]).kitId).toBe("a-kit");
  });

  it("deterministic: repeated runs and reversed table order give the identical result", () => {
    const input = { title: "高中物理 第二章", sourceType: "pdf" };
    const first = detectKit(input, [mathKit, scienceKit, englishKit]);
    const second = detectKit(input, [mathKit, scienceKit, englishKit]);
    const reversed = detectKit(input, [englishKit, scienceKit, mathKit]);
    expect(second).toEqual(first);
    expect(reversed).toEqual(first);
  });

  it("a /g-flagged title pattern cannot leak lastIndex state across runs", () => {
    const sticky: KitDetectionTable = { kitId: "g-kit", titleKeywords: [], titlePatterns: [/math/gi] };
    expect(detectKit({ title: "math math" }, [sticky]).kitId).toBe("g-kit");
    expect(detectKit({ title: "math math" }, [sticky]).kitId).toBe("g-kit"); // same, not flapping
  });

  it("pathological input degrades to the none result (never throws)", () => {
    expect(detectKit(undefined as unknown as { title: string }, [mathKit]).kitId).toBeNull();
  });
});

describe("registry — the KitLayerPolicy precedent", () => {
  it("registers idempotently per kitId and feeds detectKit by default", () => {
    registerKitDetection(mathKit);
    registerKitDetection({ ...mathKit, weight: 99 }); // duplicate kitId → ignored
    expect(listKitDetections()).toHaveLength(1);
    expect(listKitDetections()[0]?.weight).toBe(1);
    expect(detectKit({ title: "数学必修" }).kitId).toBe("subject-math");
    resetKitDetections();
    expect(detectKit({ title: "数学必修" }).kitId).toBeNull();
  });
});
