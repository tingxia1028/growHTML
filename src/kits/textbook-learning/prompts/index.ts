// Textbook prompt pack — aggregated React-free list (server registers these).
import type { KitPrompt } from "../../types";
import { explainConceptPrompt } from "./explainConcept.prompt";
import { generatePracticePrompt } from "./generatePractice.prompt";
import { markAsMistakePrompt } from "./markAsMistake.prompt";
import { generateReviewPackPrompt } from "./generateReviewPack.prompt";

export const textbookPrompts: KitPrompt[] = [
  explainConceptPrompt as KitPrompt,
  generatePracticePrompt as KitPrompt,
  markAsMistakePrompt as KitPrompt,
  generateReviewPackPrompt as KitPrompt
];

export { explainConceptPrompt, generatePracticePrompt, markAsMistakePrompt, generateReviewPackPrompt };
