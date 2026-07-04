// Core review prompt pack — the three review operations (review-loop.md §3), now
// CORE built-ins (REV-CORE, kit-flatten-and-core-review.md §1): the review loop is
// the mission loop, so its operations register at core seed time — the kit-prompt
// registry (src/kits/prompts.ts) seeds them the moment it loads, exactly like the
// built-in note content specs — NOT via any plugin manifest. Ids are UNCHANGED
// (review.generate-check / review.grade-answer / review.explain): the REV-2 server
// profileContext gate and stored operation prefs key on them. React-free.

import type { KitPrompt } from "../../../kits/types";
import { generateCheckPrompt } from "./generateCheck.prompt";
import { gradeAnswerPrompt } from "./gradeAnswer.prompt";
import { explainPrompt } from "./explain.prompt";

export const coreReviewPrompts: KitPrompt[] = [
  generateCheckPrompt as KitPrompt,
  gradeAnswerPrompt as KitPrompt,
  explainPrompt as KitPrompt
];

export { generateCheckPrompt, gradeAnswerPrompt, explainPrompt };
