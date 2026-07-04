// [[双链]] wiki-links (CG-2, docs/design/concept-light-and-graph.md §1.2): typing
// `[[浮力]]` in a markdown note IS the link — the notes service parses the text on
// save and create-or-matches a concept per name (writing IS linking; the Obsidian
// lesson). This module is the pure parser half; the create-or-match half lives in
// the concepts service (ensureConceptsByName) so client and server share the same
// name-identity rule (normalizeConceptName).

import { collapseConceptText, normalizeConceptName } from "./conceptName";

/** `[[name]]` — no nesting, no newline inside, non-greedy per bracket pair. */
export const WIKI_LINK_PATTERN = /\[\[([^\[\]\n]+)\]\]/g;

/** Safety cap: at most this many DISTINCT wiki-linked names are honored per note. */
export const WIKI_LINK_MAX_PER_NOTE = 20;

/** The note contentTypes whose string content is scanned for wiki-links on save. */
export const WIKI_LINK_CONTENT_TYPES: ReadonlySet<string> = new Set(["markdown"]);

/**
 * Extract the distinct wiki-linked concept names from a text, in first-appearance
 * order. Names are whitespace-collapsed; duplicates (case/whitespace-insensitive,
 * the shared concept identity) are dropped; empty brackets are ignored.
 */
export function extractWikiLinks(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(WIKI_LINK_PATTERN)) {
    const name = collapseConceptText(match[1]);
    if (!name) continue;
    const key = normalizeConceptName(name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= WIKI_LINK_MAX_PER_NOTE) break;
  }
  return out;
}
