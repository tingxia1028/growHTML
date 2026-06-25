// Prompt: generate a practice Exercise Study Block from a passage. React-free.
import type { KitPrompt } from "../../types";
import type { ExerciseContent } from "../contentTypes";

type PracticeInput = { anchorText?: string; grade?: string; subject?: string; difficulty?: "easy" | "medium" | "hard" };

const snippet = (text: string, n = 60) => {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  return clean.length > n ? `${clean.slice(0, n)}…` : clean || "this passage";
};

export const generatePracticePrompt: KitPrompt<PracticeInput> = {
  id: "textbook.generate-practice",
  outputType: "textbook.exercise",
  build: (input) =>
    [
      `You are an AI tutor for ${input.grade ?? "secondary-school"} students` +
        (input.subject ? ` studying ${input.subject}` : "") +
        ".",
      `Write ONE ${input.difficulty ?? "medium"} practice question testing the passage below.`,
      "Return a JSON object with: question, type (single-choice|multiple-choice|fill-blank|short-answer),",
      "options[] (for choice types), answer, explanation, difficulty, relatedKnowledgePoints[].",
      "",
      "Passage:",
      input.anchorText ?? ""
    ].join("\n"),
  mockContent: (input): ExerciseContent => ({
    question: `Which statement best reflects: "${snippet(input.anchorText ?? "", 50)}"?`,
    type: "single-choice",
    options: ["The correct reading of the passage", "A common misreading", "An unrelated claim", "The opposite meaning"],
    answer: "The correct reading of the passage",
    explanation: "The first option restates the passage's main idea; the others distort or contradict it.",
    difficulty: input.difficulty ?? "medium",
    relatedKnowledgePoints: []
  })
};
