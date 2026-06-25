// Kit language registry — React-free. Holds the domain vocabulary each installed
// kit contributes (Source→"Textbook", etc.) so the UI can show product-specific
// names without the core knowing about any kit. Each entry is tagged with its
// owning kitId so callers can optionally scope to a document's active kits; with no
// scope given the accessors stay global (content-type labels are used in rendering,
// which is never gated).

import type { KitLanguage } from "./types";

const languages: { kitId?: string; language: KitLanguage }[] = [];

export function registerKitLanguage(language: KitLanguage, kitId?: string): void {
  languages.push({ kitId, language });
}

/**
 * Display name a kit gave a note contentType (e.g. "Explanation"), if any. Global by
 * default (used for card labels everywhere); pass `kitIds` to scope to active kits.
 */
export function kitContentTypeLabel(contentType: string, kitIds?: readonly string[]): string | undefined {
  for (const { kitId, language } of languages) {
    if (kitIds && kitId && !kitIds.includes(kitId)) continue;
    const label = language.contentTypes?.[contentType];
    if (label) return label;
  }
  return undefined;
}

/**
 * Domain term a kit gave a core concept (newest registration wins), if any. Pass
 * `kitIds` to scope to a document's active kits (per-source activation).
 */
export function kitTerm(term: "source" | "anchor" | "note" | "layer", kitIds?: readonly string[]): string | undefined {
  for (let i = languages.length - 1; i >= 0; i -= 1) {
    const { kitId, language } = languages[i];
    if (kitIds && kitId && !kitIds.includes(kitId)) continue;
    const value = language[term];
    if (value) return value;
  }
  return undefined;
}

/** Test/reset hook — drops all registered languages. */
export function resetKitLanguages(): void {
  languages.length = 0;
}
