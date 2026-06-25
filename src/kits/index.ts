// Kit aggregation — REACT-FREE entry the server uses. Exposes every installed kit's
// core content specs so the server can register them for API validation WITHOUT
// importing any kit's React plugins. (The client list lives in ./clientKits.)

import type { NoteContentSpec } from "../core/notes/contentTypes";
import type { KitPrompt } from "./types";
import type { KitLayerPolicy } from "./policy";
import { textbookContentSpecs } from "./textbook-learning/contentTypes";
import { textbookPrompts } from "./textbook-learning/prompts";
import { textbookLayerPolicy } from "./textbook-learning/policy";

export const kitContentSpecs: NoteContentSpec[] = [...textbookContentSpecs];
export const kitPrompts: KitPrompt[] = [...textbookPrompts];
export const kitLayerPolicies: KitLayerPolicy[] = [textbookLayerPolicy];

export type { ProductKit, KitInstallContext, KitLanguage } from "./types";
export { kitContentTypeLabel, kitTerm } from "./language";
