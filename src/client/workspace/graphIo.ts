// graphIo — the concept-graph read seam (PLAT-LAYER §2.5 Rule C). ConceptGraphView
// (CG-3, the lazy 图谱 chunk) previously called `entityClient.graph()` inline to load
// the CG-1 engine's derived read model; this thin facade relocates that IO edge out of
// the component so it imports no entityClient at runtime. The graph read has no ctx
// surface by design (WorkspaceContext holds only conceptsVersion — the refresh token —
// not the materialized graph), so a dedicated leaf Io is the correct home. It is a LEAF
// module: it imports ONLY entityClient (+ the graph record TYPES its caller re-exports),
// never a view/workspace module, so it can never cycle with the workspace/ dir.
//
// BYTE-EQUIVALENT call-time pass-through — `(...args) => entityClient.graph(...args)` —
// so any spy/mock on the entityClient seam still intercepts through this indirection.

import { entityClient } from "../data/entityClient";

// Graph record types re-exported so ConceptGraphView imports its shapes from the same
// seam it now calls (no direct entityClient TYPE edge needed either).
export type {
  ConceptGraphEdge,
  ConceptGraphNode,
  ConceptGraphResponse
} from "../data/entityClient";

export const graphIo = {
  graph: (...args: Parameters<typeof entityClient.graph>) => entityClient.graph(...args)
};
