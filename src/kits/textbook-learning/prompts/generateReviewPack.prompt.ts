// Prompt: synthesize a chapter Review Pack from a source's Explanation + Mistake
// Study Blocks (user spec §4/§16 step 4). React-free. Source-level (no single anchor).
import type { KitPrompt } from "../../types";
import type { ReviewPackContent } from "../contentTypes";

type ReviewPackInput = {
  sourceId?: string;
  sourceTitle?: string;
  // The note `content` objects gathered for this source, by kind.
  explanations?: unknown[];
  mistakes?: unknown[];
};

// Pull a short label out of an explanation/mistake content object for the mock.
function titleOf(item: unknown): string {
  const c = (item ?? {}) as { title?: unknown; question?: unknown };
  return String(c.title ?? c.question ?? "").replace(/\s+/g, " ").trim();
}

export const generateReviewPackPrompt: KitPrompt<ReviewPackInput> = {
  id: "textbook.generate-review-pack",
  outputType: "textbook.review-pack",
  build: (input) =>
    [
      "You are an AI tutor building a revision pack for a student.",
      "Using the Explanations and Mistakes below, produce a concise review pack.",
      "Requirements: a short summary; 3-6 key points; weak points drawn from the",
      "mistakes; a few flashcards (front/back). Stay within the material's scope.",
      "Return a JSON object with: title, scope { sourceId }, summary, keyPoints[],",
      "weakPoints[], flashcards[ {front, back} ], exercises[].",
      `scope.sourceId MUST be ${JSON.stringify(input.sourceId ?? "")}.`,
      "",
      "Explanations:",
      JSON.stringify(input.explanations ?? [], null, 2),
      "",
      "Mistakes:",
      JSON.stringify(input.mistakes ?? [], null, 2)
    ].join("\n"),
  mockContent: (input): ReviewPackContent => {
    const explanations = Array.isArray(input.explanations) ? input.explanations : [];
    const mistakes = Array.isArray(input.mistakes) ? input.mistakes : [];
    return {
      title: `Review Pack: ${input.sourceTitle ?? "this chapter"}`,
      scope: { sourceId: String(input.sourceId ?? "") },
      summary: `A revision pack synthesized from ${explanations.length} explanation(s) and ${mistakes.length} mistake(s).`,
      keyPoints: explanations.map((e) => titleOf(e) || "Key idea").slice(0, 6),
      weakPoints: mistakes.map((m) => titleOf(m) || "Revisit this").slice(0, 6),
      flashcards: explanations.slice(0, 3).map((e) => ({
        front: titleOf(e) || "Concept",
        back: "Review the explanation block for this concept."
      })),
      exercises: []
    };
  }
};
