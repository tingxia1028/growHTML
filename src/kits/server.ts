// Server-side kit install — registers every kit's REACT-FREE content specs into the
// core NoteContentSpec registry so the API can validate `<kit>.<type>` note content.
// Called from createApp (the server composition root); core itself never imports a kit.

import { registerNoteContentSpec } from "../core/notes/contentTypes";
import { registerKitPrompt } from "./prompts";
import { registerKitLayerPolicy } from "./policy";
import { registerKitDetection } from "../core/subject/detectSubject";
import { kitContentSpecs, kitDetectionTables, kitLayerPolicies, kitPrompts } from "./index";

let installed = false;

export function installServerKits(): void {
  if (installed) return;
  for (const spec of kitContentSpecs) registerNoteContentSpec(spec);
  for (const prompt of kitPrompts) registerKitPrompt(prompt);
  for (const policy of kitLayerPolicies) registerKitLayerPolicy(policy);
  // Subject Auto-Switch tables (M-A): the server resolves the same auto-foreground as
  // the client (activeKitIdsForSource seeds the stage axis in services/layers.ts).
  for (const table of kitDetectionTables) registerKitDetection(table);
  installed = true;
}
