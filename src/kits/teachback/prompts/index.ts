// Teach-back prompt pack — aggregated React-free list (the server registers these via
// installServerKits so the structured-generation endpoint resolves each by id).

import type { KitPrompt } from "../../types";
import { posePrompt } from "./pose.prompt";
import { probePrompt } from "./probe.prompt";
import { wrapupPrompt } from "./wrapup.prompt";

export const teachbackPrompts: KitPrompt[] = [
  posePrompt as KitPrompt,
  probePrompt as KitPrompt,
  wrapupPrompt as KitPrompt
];

export { posePrompt, probePrompt, wrapupPrompt };
export { FEYNMAN_PERSONA } from "./persona";
