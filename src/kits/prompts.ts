// React-free prompt registry. Product Kits register their prompt-pack entries here
// (server-side, like NoteContentSpecs) so the structured-generation endpoint can
// look a prompt up by id. Keeping it separate from the client keeps prompts usable
// on the server without pulling in any React.

import { coreReviewPrompts } from "../core/review/prompts";
import type { KitPrompt } from "./types";

const registry = new Map<string, KitPrompt>();

export function registerKitPrompt(prompt: KitPrompt): void {
  registry.set(prompt.id, prompt as KitPrompt);
}

export function getKitPrompt(id: string): KitPrompt | undefined {
  return registry.get(id);
}

export function listKitPrompts(): readonly KitPrompt[] {
  return Array.from(registry.values());
}

// —— core built-in prompts (REV-CORE) ————————————————————————————————————————
// The review loop's three operations are CORE (the mission loop, not a plugin):
// they register the moment this registry module loads — the same "available on
// import" seed the built-in note content specs use — never via a kit manifest.
for (const prompt of coreReviewPrompts) registerKitPrompt(prompt);
