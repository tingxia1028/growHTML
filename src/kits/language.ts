// Kit language registry — React-free. Holds the domain vocabulary each installed
// kit contributes (Source→"Textbook", etc.) so the UI can show product-specific
// names without the core knowing about any kit. Phase 1 surfaces the per-contentType
// labels (used as the note-type picker / card labels); the term map (anchor/note/…)
// is registered now and consumed more widely in later phases.

import type { KitLanguage } from "./types";

const languages: KitLanguage[] = [];

export function registerKitLanguage(language: KitLanguage): void {
  languages.push(language);
}

/** Display name a kit gave a note contentType (e.g. "Explanation"), if any. */
export function kitContentTypeLabel(contentType: string): string | undefined {
  for (const language of languages) {
    const label = language.contentTypes?.[contentType];
    if (label) return label;
  }
  return undefined;
}

/** Domain term a kit gave a core concept (newest registration wins), if any. */
export function kitTerm(term: "source" | "anchor" | "note" | "layer"): string | undefined {
  for (let i = languages.length - 1; i >= 0; i -= 1) {
    const value = languages[i][term];
    if (value) return value;
  }
  return undefined;
}

/** Test/reset hook — drops all registered languages. */
export function resetKitLanguages(): void {
  languages.length = 0;
}
