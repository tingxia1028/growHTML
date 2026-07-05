// Study Report prompt pack — aggregated React-free list (the server registers these via
// installServerKits so the structured-generation endpoint resolves each by id). Mirrors
// mistake-photo/prompts/index.ts.

import type { KitPrompt } from "../../types";
import { generateReportPrompt } from "./generateReport.prompt";

export const studyReportPrompts: KitPrompt[] = [generateReportPrompt as KitPrompt];

export { generateReportPrompt };
