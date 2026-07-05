// Prompt `mistake-photo.extract` — the VLM 抽取 step of the 拍错题 flow. Given a PHOTO of
// a worked problem (the image rides the structured request as a SIBLING `images` attachment,
// resolved to bytes for a vision provider server-side), the model reads it and extracts a
// study Mistake card: the question, the student's WRONG answer, the CORRECT solution, WHY it
// went wrong, and how to correct it. Output validates against the CORE `mistake` spec.
// React-free (the server registers + runs it).
//
// The prompt body is TEXT-only — it never references `{{images}}` (the image is not a template
// value; it rides the message array beside this text). `mockContent` returns a fixed,
// schema-valid mistake so the offline mock echoes a deterministic card (proving 拍照→抽取→存
// end to end without a live VLM), mirroring markAsMistakePrompt.mockContent.

import type { KitPrompt } from "../../types";
import { MISTAKE_CONTENT_TYPE, type MistakeContent } from "../../../core/notes/contentTypes";

export type ExtractMistakeInput = {
  /** Optional hint text the user typed alongside the photo (subject / grade / a note). */
  hint?: string;
};

export const extractMistakePrompt: KitPrompt<ExtractMistakeInput> = {
  id: "mistake-photo.extract",
  outputType: MISTAKE_CONTENT_TYPE,
  build: (input) => {
    const hint = (input.hint ?? "").replace(/\s+/g, " ").trim();
    return [
      "从这张错题照片中抽取一张错题卡片。仔细阅读图中的题目、学生的作答和批改。",
      "请判断:题目是什么、学生的错误答案、正确的解法、为什么错了、如何订正。",
      "Return a JSON object with: question(题目), wrongAnswer(学生的错误答案),",
      "correctAnswer(正确解法/答案), mistakeReason(错因), correction(订正建议),",
      "retryCount (0), mastery (unknown|weak|improving|mastered).",
      "只输出图中真实存在的内容;看不清的字段留空字符串,不要编造。",
      hint ? `\n补充提示:${hint}` : ""
    ].join("\n");
  },
  // Deterministic, schema-valid projection (the offline/e2e sample). Fixed content — the
  // image reaches the mock (proving the wire) but the mock echoes THIS card verbatim, so
  // the 拍照→抽取→预览→存 flow is byte-stable without a real VLM. Fills all 3 required
  // fields + the two optional diagnosis fields.
  mockContent: (input): MistakeContent => {
    const hint = (input.hint ?? "").replace(/\s+/g, " ").trim();
    return {
      question: "计算:1/2 + 1/3 = ?",
      wrongAnswer: "2/5(把分子分母分别相加)",
      correctAnswer: "5/6(先通分:3/6 + 2/6 = 5/6)",
      mistakeReason: hint
        ? `分数加法未通分就直接把分子、分母相加。${hint}`
        : "分数加法未通分就直接把分子、分母相加。",
      correction: "异分母分数相加要先通分成同分母,再把分子相加、分母不变。",
      retryCount: 0,
      mastery: "weak"
    };
  }
};
