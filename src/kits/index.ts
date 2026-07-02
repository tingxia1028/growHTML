// Kit aggregation — REACT-FREE entry the server uses. Exposes every installed kit's
// core content specs so the server can register them for API validation WITHOUT
// importing any kit's React plugins. (The client list lives in ./clientKits.)

import type { NoteContentSpec } from "../core/notes/contentTypes";
import type { KitPrompt } from "./types";
import type { KitLayerPolicy } from "./policy";
import type { KitDetectionTable } from "../core/subject/detectSubject";
import { textbookContentSpecs } from "./textbook-learning/contentTypes";
import { textbookPrompts } from "./textbook-learning/prompts";
import { textbookLayerPolicy } from "./textbook-learning/policy";
import { textbookDetection } from "./textbook-learning/detection";
import { reviewContentSpecs } from "./review/contentTypes";
import { reviewPrompts } from "./review/prompts";

export const kitContentSpecs: NoteContentSpec[] = [...textbookContentSpecs, ...reviewContentSpecs];
export const kitPrompts: KitPrompt[] = [...textbookPrompts, ...reviewPrompts];
export const kitLayerPolicies: KitLayerPolicy[] = [textbookLayerPolicy];
// Subject Auto-Switch tables (M-A) — one per kit; M-B appends the five subject kits'.
export const kitDetectionTables: KitDetectionTable[] = [textbookDetection];

export type { ProductKit, KitInstallContext, KitLanguage } from "./types";
export { kitContentTypeLabel, kitTerm } from "./language";
