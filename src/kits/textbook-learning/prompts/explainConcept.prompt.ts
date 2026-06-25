// Prompt: explain a textbook passage as an Explanation Study Block. React-free.
import type { KitPrompt } from "../../types";
import type { ExplanationContent } from "../contentTypes";

type ExplainInput = { anchorText?: string; grade?: string; subject?: string };

const snippet = (text: string, n = 60) => {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  return clean.length > n ? `${clean.slice(0, n)}…` : clean || "this passage";
};

export const explainConceptPrompt: KitPrompt<ExplainInput> = {
  id: "textbook.explain-concept",
  outputType: "textbook.explanation",
  build: (input) =>
    [
      `You are an AI tutor for ${input.grade ?? "secondary-school"} students` +
        (input.subject ? ` studying ${input.subject}` : "") +
        ".",
      "Explain the following textbook passage clearly and vividly.",
      "Requirements: simple language; one real-life analogy; 3 key points;",
      "list common misunderstandings; stay within the textbook's scope.",
      "Return a JSON object with: title, level (simple|standard|advanced),",
      "explanation, analogy, keyPoints[], commonMisunderstandings[].",
      "",
      "Passage:",
      input.anchorText ?? ""
    ].join("\n"),
  mockContent: (input): ExplanationContent => ({
    title: `Explaining: ${snippet(input.anchorText ?? "", 40)}`,
    level: "standard",
    explanation: `In plain terms, ${snippet(input.anchorText ?? "", 80)} means the core idea broken down step by step.`,
    analogy: "Think of it like following a recipe: each step builds on the last.",
    keyPoints: ["The main concept and why it matters", "How it connects to what you already know", "A worked example"],
    commonMisunderstandings: ["Confusing the cause with the effect"]
  })
};
