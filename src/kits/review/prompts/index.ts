// Review prompt pack — the three review operations as kit-prompt records
// (review-loop.md §3: "operation/kit-prompt records + one grade schema").
// Aggregated React-free so the server registers them exactly like the textbook pack.
import type { KitPrompt } from "../../types";
import { generateCheckPrompt } from "./generateCheck.prompt";
import { gradeAnswerPrompt } from "./gradeAnswer.prompt";
import { explainPrompt } from "./explain.prompt";

export const reviewPrompts: KitPrompt[] = [
  generateCheckPrompt as KitPrompt,
  gradeAnswerPrompt as KitPrompt,
  explainPrompt as KitPrompt
];

export { generateCheckPrompt, gradeAnswerPrompt, explainPrompt };
