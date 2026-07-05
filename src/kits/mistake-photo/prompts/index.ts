// Mistake-Photo prompt pack — aggregated React-free list (the server registers these via
// installServerKits so the structured-generation endpoint resolves each by id). Mirrors
// teachback/prompts/index.ts.

import type { KitPrompt } from "../../types";
import { extractMistakePrompt } from "./extractMistake.prompt";

export const mistakePhotoPrompts: KitPrompt[] = [extractMistakePrompt as KitPrompt];

export { extractMistakePrompt };
