import { describe, expect, it } from "vitest";
import { detectKit, DETECTION_THRESHOLD, scoreKitDetection } from "../../core/subject/detectSubject";
import { textbookDetection } from "./detection";

// The M-A stand-in table (subject-kits.md PART 5): textbook-y sources score toward the
// existing textbook kit; unrelated titles stay below the threshold. Passed EXPLICITLY to
// detectKit — the registration seam itself is covered by the activation/server tests.

describe("textbook-learning detection table", () => {
  it("textbook titles clear the threshold (keyword and chapter-pattern forms)", () => {
    for (const title of [
      "人教版数学教材",
      "高一物理 必修一",
      "语文课本 第三章 古诗词",
      "Biology Textbook",
      "Chemistry — Chapter 12"
    ]) {
      const result = detectKit({ title }, [textbookDetection]);
      expect(result.kitId, title).toBe("textbook-learning");
      expect(result.confidence).toBeGreaterThanOrEqual(DETECTION_THRESHOLD);
    }
  });

  it("unrelated titles do not fire; a bare pdf hint stays below the threshold", () => {
    expect(detectKit({ title: "周末随笔与旅行照片" }, [textbookDetection]).kitId).toBeNull();
    const weak = detectKit({ title: "scan_0421", sourceType: "pdf" }, [textbookDetection]);
    expect(weak.kitId).toBeNull();
    expect(weak.candidates[0]?.confidence).toBe(0.1);
  });

  it("body markers add the content-keyword bucket on top of a title hit", () => {
    const scored = scoreKitDetection(textbookDetection, {
      title: "第五章 三角函数",
      contentSample: "本节例题:求下列函数的最小正周期……课后请完成习题 5.1。"
    });
    expect(scored.confidence).toBe(0.8); // title 0.6 + content keyword 0.2
    expect(scored.signals.map((s) => s.kind)).toEqual(["title-pattern", "content-keyword"]);
  });
});
