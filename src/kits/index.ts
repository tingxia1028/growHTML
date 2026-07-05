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
import { subjectContentSpecs } from "./subject/contentTypes";
import { subjectPrompts } from "./subject/prompts";
import { subjectDetectionTables } from "./subject/detection";
import { teachbackContentSpecs } from "./teachback/contentTypes";
import { teachbackPrompts } from "./teachback/prompts";
import { mistakePhotoPrompts } from "./mistake-photo/prompts";

// REV-CORE: the review loop is CORE now — its grade spec registers with the core
// built-ins (src/core/review/contentTypes) and its prompts seed the prompt registry
// on load (src/kits/prompts.ts); nothing review-shaped rides the kit aggregation.
export const kitContentSpecs: NoteContentSpec[] = [
  ...textbookContentSpecs,
  ...subjectContentSpecs,
  // PRO-2 teach-back kit: teachback.summary + teachback.turn (server validates them).
  ...teachbackContentSpecs
];
export const kitPrompts: KitPrompt[] = [
  ...textbookPrompts,
  ...subjectPrompts,
  ...teachbackPrompts,
  // V-2 拍错题 kit: the VLM extract prompt (mistake-photo.extract → core `mistake`). The
  // kit registers NO content spec (mistake is CORE); only this prompt joins the registry.
  ...mistakePhotoPrompts
];
export const kitLayerPolicies: KitLayerPolicy[] = [textbookLayerPolicy];
// Subject Auto-Switch tables (M-A) — one per kit; M-B adds 英语/数学/史地, M-C adds
// 语文/理化生 (subject-kits.md §3.3). All five ride `subjectDetectionTables`.
export const kitDetectionTables: KitDetectionTable[] = [textbookDetection, ...subjectDetectionTables];

export type { ProductKit, KitInstallContext, KitLanguage } from "./types";
export { kitContentTypeLabel, kitTerm } from "./language";
