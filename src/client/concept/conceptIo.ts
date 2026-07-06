// conceptIo — the concept family's data seam (PLAT-LAYER §2.5 Rule C). The concept
// view components (ConceptInspector, RelationInspector, the concept.list view, the
// ConceptChips saved-note host) previously called `entityClient.*` inline; this thin
// facade relocates those IO edges out of the components so no component imports
// entityClient at runtime. It is a LEAF module: it imports ONLY entityClient (+ the
// record TYPES its callers re-export), never a view/inspector/workspace module, so it
// can never cycle with either the inspectors/ or workspace/ dirs.
//
// Every method is a BYTE-EQUIVALENT pass-through (same args, same return type) that
// delegates at CALL TIME — `(...args) => entityClient.method(...args)` — NOT a captured
// binding. This matters for the tests: they `vi.spyOn(entityClient, "…")`, and a
// call-time lookup lets that spy still intercept through this indirection.

import { entityClient } from "../data/entityClient";

// Record types re-exported so the 4 concept views import their shapes from the same
// seam they now call (no direct entityClient TYPE edge needed either).
export type {
  ConceptRecord,
  NoteRecord,
  RelationRecord
} from "../data/entityClient";

export const conceptIo = {
  // —— Concepts ——
  concepts: (...args: Parameters<typeof entityClient.concepts>) => entityClient.concepts(...args),
  conceptDetail: (...args: Parameters<typeof entityClient.conceptDetail>) => entityClient.conceptDetail(...args),
  createConcept: (...args: Parameters<typeof entityClient.createConcept>) => entityClient.createConcept(...args),
  deleteConcept: (...args: Parameters<typeof entityClient.deleteConcept>) => entityClient.deleteConcept(...args),
  mergeConcept: (...args: Parameters<typeof entityClient.mergeConcept>) => entityClient.mergeConcept(...args),

  // —— Relations ——
  relations: (...args: Parameters<typeof entityClient.relations>) => entityClient.relations(...args),
  deleteRelation: (...args: Parameters<typeof entityClient.deleteRelation>) => entityClient.deleteRelation(...args),

  // —— Notes (the concept↔note link edges the concept surfaces touch) ——
  allNotes: (...args: Parameters<typeof entityClient.allNotes>) => entityClient.allNotes(...args),
  updateNote: (...args: Parameters<typeof entityClient.updateNote>) => entityClient.updateNote(...args)
};
