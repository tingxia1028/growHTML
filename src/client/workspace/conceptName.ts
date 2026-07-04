// Concept-name normalization (CONCEPT-UX-1 选中即建概念) — shared by the
// concept.mark-selection command, the concept autocomplete (chips ＋ / 关联到…), and
// the list filter, so create-vs-link agrees everywhere. The IMPLEMENTATION was
// hoisted to src/core/concepts/conceptName.ts for CG-2 (the server's wiki-link /
// auto-tag create-or-match uses the SAME identity rule); this module re-exports it
// so every client import keeps its path.

export {
  CONCEPT_NAME_MAX,
  collapseConceptText,
  conceptNameFromSelection,
  normalizeConceptName,
  matchConceptByName
} from "../../core/concepts/conceptName";
