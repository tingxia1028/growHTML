// GraphLens contribution point (CG-1/CG-3; concept-light-and-graph §2) — the ONE
// plugin seam on the core concept graph. User law (2026-07-04, product kernel):
// the 关联图 is a CORE engine; plugins modify VISUALIZATION STYLE, never the graph
// itself. A lens may restyle nodes/edges, filter which nodes show, and contribute a
// legend — it can NOT register a second graph, add nodes/edges, or change assembly
// (there is no seam for that, by design).
//
// Registry idiom = librarySections: register returns a disposer, idempotent by id,
// core seeds the built-in default lens through the SAME seam (shell-primitive rule).
// Examples the seam is built for (CG-3+): Textbook Kit subject coloring, 弱项
// profile-driven red scale, 复习 due-card highlighting.

import type { ConceptGraphEdge, ConceptGraphNode } from "../data/entityClient";
import type { LocalizedText } from "../i18n";
import { graphMessages } from "./graphMessages";

/** What a lens styles against (kept small; grows additively). */
export type GraphLensContext = {
  /** The concept currently focused in the workspace, if any. */
  focusedConceptId: string | null;
};

/** Node style overrides — everything optional; unset falls back to core defaults. */
export type GraphNodeStyle = {
  fill?: string;
  stroke?: string;
  /** Multiplies the size-derived radius (clamped by the renderer). */
  radiusScale?: number;
};

/** Edge style overrides — everything optional; unset falls back to core defaults. */
export type GraphEdgeStyle = {
  stroke?: string;
  /** Overrides the kind-derived dashing (stored=solid / cooccurrence=dashed). */
  dashed?: boolean;
  opacity?: number;
  /** Multiplies the weight-derived stroke width (clamped by the renderer). */
  widthScale?: number;
};

export type GraphLensLegendEntry = { color: string; label: LocalizedText };

export type GraphLens = {
  id: string;
  title: LocalizedText;
  /** Style one node (undefined = core default styling). */
  nodeStyle?(node: ConceptGraphNode, ctx: GraphLensContext): GraphNodeStyle | undefined;
  /** Style one edge (undefined = core default styling). */
  edgeStyle?(edge: ConceptGraphEdge, ctx: GraphLensContext): GraphEdgeStyle | undefined;
  /** Hide nodes the lens doesn't care about (edges to hidden nodes drop with them). */
  filter?(node: ConceptGraphNode, ctx: GraphLensContext): boolean;
  legend?: readonly GraphLensLegendEntry[];
};

export const DEFAULT_GRAPH_LENS_ID = "core.default";

const lenses = new Map<string, GraphLens>();

export function registerGraphLens(lens: GraphLens): () => void {
  lenses.set(lens.id, lens);
  return () => {
    if (lenses.get(lens.id) === lens) lenses.delete(lens.id);
  };
}

/** Default lens first, then registration-independent alphabetical order. */
export function listGraphLenses(): GraphLens[] {
  return [...lenses.values()].sort((a, b) => {
    if (a.id === DEFAULT_GRAPH_LENS_ID) return -1;
    if (b.id === DEFAULT_GRAPH_LENS_ID) return 1;
    return a.id.localeCompare(b.id);
  });
}

/** Resolve a lens by id; an unknown/unregistered id FALLS BACK to the default. */
export function getGraphLens(id?: string | null): GraphLens {
  return (id ? lenses.get(id) : undefined) ?? lenses.get(DEFAULT_GRAPH_LENS_ID) ?? DEFAULT_GRAPH_LENS;
}

// —— The built-in default lens (core ships one; kits ship skins) ————————————————
// Neutral styling: everything rides the renderer's kind/size defaults; the legend
// names the two edge kinds. Registered through the SAME seam plugins use.
const DEFAULT_GRAPH_LENS: GraphLens = {
  id: DEFAULT_GRAPH_LENS_ID,
  title: graphMessages.defaultLens,
  legend: [
    { color: "var(--graph-edge-stored, #6b7280)", label: graphMessages.legendStored },
    { color: "var(--graph-edge-derived, #9ca3af)", label: graphMessages.legendDerived }
  ]
};

registerGraphLens(DEFAULT_GRAPH_LENS);
