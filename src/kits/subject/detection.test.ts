import { describe, expect, it } from "vitest";
import { detectKit, DETECTION_THRESHOLD, scoreKitDetection } from "../../core/subject/detectSubject";
import { textbookDetection } from "../textbook-learning/detection";
import { englishDetection, historyGeoDetection, mathDetection, subjectDetectionTables } from "./detection";

// The M-B subject tables (§3.3 rows), scored EXPLICITLY like the textbook table's test —
// the registration seam is covered by the server subjectAutoSwitch test + kits/index.ts.

const ALL = [textbookDetection, ...subjectDetectionTables];

describe("subject detection tables (§3.3)", () => {
  it("数学 titles clear the threshold (keyword + pattern forms, bilingual)", () => {
    for (const title of ["高一数学函数专题", "微积分入门", "Algebra Basics", "Geometry Workbook"]) {
      const result = detectKit({ title }, [mathDetection]);
      expect(result.kitId, title).toBe("subject-math");
      expect(result.confidence).toBeGreaterThanOrEqual(DETECTION_THRESHOLD);
    }
  });

  it("数学 fires on LaTeX density in the body sample (≥3/1k)", () => {
    const sample = "设 $x^2$ 与 $y^2$ 及 $z^2$ 已知,则……";
    const scored = scoreKitDetection(mathDetection, { title: "untitled scan", contentSample: sample });
    expect(scored.signals.map((s) => s.kind)).toContain("latex-density");
  });

  it("英语 titles + an English-dominant body clear the threshold", () => {
    for (const title of ["高考英语单词表", "English Reading", "Vocabulary Builder"]) {
      expect(detectKit({ title }, [englishDetection]).kitId, title).toBe("subject-english");
    }
    const sample =
      "The quick brown fox jumps over the lazy dog while reading comprehension passages about daily life.";
    const scored = scoreKitDetection(englishDetection, { title: "notes", contentSample: sample });
    expect(scored.signals.map((s) => s.kind)).toContain("lang-hint");
  });

  it("史地 titles + date-density body markers clear the threshold", () => {
    for (const title of ["中国历史 朝代年表", "世界地理", "History of Rome"]) {
      expect(detectKit({ title }, [historyGeoDetection]).kitId, title).toBe("subject-history-geo");
    }
    const scored = scoreKitDetection(historyGeoDetection, {
      title: "第三单元",
      contentSample: "公元前221年,秦统一六国;公元前202年,汉朝建立。"
    });
    expect(scored.signals.map((s) => s.kind)).toContain("content-keyword");
  });

  it("unrelated titles score nothing on any subject table", () => {
    for (const table of subjectDetectionTables) {
      expect(detectKit({ title: "周末随笔与旅行照片" }, [table]).kitId, table.kitId).toBeNull();
    }
  });

  it("a 数学教材 title ties textbook (0.6 vs 0.6) → the deterministic kitId-ASC leg picks subject-math, every run", () => {
    // §3.3: exactly the ambiguity the total order (score ↓, weight ↓, kitId ↑) is for.
    const input = { title: "人教版数学教材" };
    const first = detectKit(input, ALL);
    expect(first.candidates.map((c) => c.kitId)).toEqual(["subject-math", "textbook-learning"]);
    expect(first.kitId).toBe("subject-math");
    expect(detectKit(input, ALL)).toEqual(first); // no flapping
  });

  it("a pure-textbook title still resolves to the textbook kit beside the subject tables", () => {
    expect(detectKit({ title: "人教版教材 第一章" }, ALL).kitId).toBe("textbook-learning");
  });
});
