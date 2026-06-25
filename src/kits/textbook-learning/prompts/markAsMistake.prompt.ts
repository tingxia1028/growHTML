// Prompt: turn a missed question/passage into a Mistake Study Block. React-free.
import type { KitPrompt } from "../../types";
import type { MistakeContent } from "../contentTypes";

type MistakeInput = {
  anchorText?: string;
  question?: string;
  wrongAnswer?: string;
  correctAnswer?: string;
};

const snippet = (text: string, n = 80) => {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  return clean.length > n ? `${clean.slice(0, n)}…` : clean;
};

export const markAsMistakePrompt: KitPrompt<MistakeInput> = {
  id: "textbook.mark-as-mistake",
  outputType: "textbook.mistake",
  build: (input) =>
    [
      "Create a study Mistake card from the student's error below.",
      "Diagnose WHY it was wrong and how to correct it.",
      "Return a JSON object with: question, wrongAnswer, correctAnswer, mistakeReason,",
      "correction, retryCount (0), mastery (unknown|weak|improving|mastered).",
      "",
      `Passage/Question: ${input.question ?? input.anchorText ?? ""}`,
      input.wrongAnswer ? `Student answered: ${input.wrongAnswer}` : "",
      input.correctAnswer ? `Correct answer: ${input.correctAnswer}` : ""
    ].join("\n"),
  mockContent: (input): MistakeContent => ({
    question: input.question ?? snippet(input.anchorText ?? "") ?? "Recorded mistake",
    wrongAnswer: input.wrongAnswer ?? "(student's answer)",
    correctAnswer: input.correctAnswer ?? "(correct answer)",
    mistakeReason: "Misapplied the key rule from this passage.",
    correction: "Re-read the passage and identify the rule before answering.",
    retryCount: 0,
    mastery: "weak"
  })
};
