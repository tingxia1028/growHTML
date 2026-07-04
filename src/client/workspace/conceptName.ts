// Concept-name normalization (CONCEPT-UX-1 选中即建概念) — the ONE place the
// "same concept?" decision lives, shared by the concept.mark-selection command, the
// concept autocomplete (chips ＋ / 关联到…), and the list filter, so create-vs-link
// agrees everywhere: names are compared case-insensitively with whitespace collapsed.
// React-free on purpose (the command registry imports it).

/** Cap for a concept name derived from a raw text selection (~40 chars). */
export const CONCEPT_NAME_MAX = 40;

/** Collapse runs of whitespace to single spaces and trim the ends. */
export function collapseConceptText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** A concept name derived from selected text: collapsed, capped, re-trimmed. */
export function conceptNameFromSelection(text: string): string {
  return collapseConceptText(text).slice(0, CONCEPT_NAME_MAX).trim();
}

/** The dedupe key: collapsed + lowercased (case/whitespace-insensitive identity). */
export function normalizeConceptName(name: string): string {
  return collapseConceptText(name).toLocaleLowerCase();
}

/** Find an existing concept whose name normalizes to the same key (else undefined). */
export function matchConceptByName<T extends { name: string }>(
  concepts: readonly T[],
  name: string
): T | undefined {
  const normalized = normalizeConceptName(name);
  if (!normalized) return undefined;
  return concepts.find((concept) => normalizeConceptName(concept.name) === normalized);
}
