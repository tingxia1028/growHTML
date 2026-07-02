// Operation `review.grade-answer` — structured grading of a user's answer into the
// HIDDEN `review.grade` content shape ({ correct, explanation }). The verdict is
// shown inline in the runner and is NEVER persisted as a note (review-loop.md §2);
// it still flows through /api/kits/generate so the schema gate + re-prompt loop
// apply exactly as for any declared-form generation. React-free.

import type { KitPrompt } from "../../types";
import { REVIEW_GRADE_CONTENT_TYPE, type ReviewGradeContent } from "../contentTypes";

export type GradeAnswerInput = {
  question?: string;
  /** The expected/correct answer, when the item knows it (a quiz's correct option). */
  expected?: string;
  userAnswer?: string;
};

// Whitespace/case-insensitive equality — the deterministic offline grading rule the
// mock sample implements (a real provider judges semantically instead).
const normalize = (text: string | undefined) => (text ?? "").replace(/\s+/g, " ").trim().toLowerCase();

export const gradeAnswerPrompt: KitPrompt<GradeAnswerInput> = {
  id: "review.grade-answer",
  outputType: REVIEW_GRADE_CONTENT_TYPE,
  build: (input) =>
    [
      "You are grading a student's answer to a review question.",
      "Judge whether the answer is correct IN MEANING (not verbatim), then explain briefly",
      "in the student's language. Return a JSON object with: correct (boolean),",
      "explanation (string).",
      "",
      `Question: ${input.question ?? ""}`,
      input.expected ? `Expected answer: ${input.expected}` : "",
      `Student's answer: ${input.userAnswer ?? ""}`
    ].join("\n"),
  mockContent: (input): ReviewGradeContent => {
    const correct = normalize(input.expected) !== "" && normalize(input.expected) === normalize(input.userAnswer);
    return {
      correct,
      explanation: correct
        ? `答对了:「${(input.userAnswer ?? "").trim()}」正是要点。`
        : `再想想:正确答案应当是「${(input.expected ?? "").trim() || "(见原笔记)"}」。`
    };
  }
};
