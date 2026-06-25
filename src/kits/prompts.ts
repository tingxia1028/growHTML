// React-free prompt registry. Product Kits register their prompt-pack entries here
// (server-side, like NoteContentSpecs) so the structured-generation endpoint can
// look a prompt up by id. Keeping it separate from the client keeps prompts usable
// on the server without pulling in any React.

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
