// Concept graph — the ONE core engine (CG-1, docs/design/concept-light-and-graph.md
// §2; user law 2026-07-04: the 关联图 lives in CORE, plugins may only change
// visualization style through GraphLens, never structure).
//
// The graph is DERIVED from vault truth at read time — no new persisted entity:
//   nodes  = concepts, sized by linked-note count (links live ONLY on
//            note.conceptIds — the one storage path since CONCEPT-UX-1).
//   edges  = • "stored": explicit relations concept↔concept (关联到…, AI same_topic
//              tags) — solid, carrying relationKind + confidence.
//            • "cooccurrence": concepts sharing a NOTE / ANCHOR / SOURCE — dashed,
//              computed here, NEVER stored (zero data debt; the graph is alive from
//              day one). Weight = 3·note + 2·anchor + 1·source shared contexts.
//
// Pure functions over plain record shapes (no store/IO imports): the server service
// feeds it store lists, tests feed it fixtures, and delete/merge are reflected for
// free because derivation always re-reads truth.

export type ConceptGraphNode = {
  id: string;
  name: string;
  /** Linked-note count (the node-size driver — doc §2 "nodes sized by…"). */
  noteCount: number;
  /** Distinct neighbors across BOTH edge kinds (the inspector/filter degree). */
  degree: number;
};

export type ConceptGraphEdgeKind = "stored" | "cooccurrence";

export type CooccurrenceBasis = {
  /** Shared notes (both concepts on one note's conceptIds). */
  note: number;
  /** Shared anchors (linked from notes referencing the same anchor). */
  anchor: number;
  /** Shared sources (linked from notes attached to the same source). */
  source: number;
};

export type ConceptGraphEdge = {
  /** The relation id for stored edges; `co:<a>~<b>` for derived ones. */
  id: string;
  source: string;
  target: string;
  kind: ConceptGraphEdgeKind;
  /** Stored edges only: the relation's kind (related/same_topic/…). */
  relationKind?: string;
  /** Stored edges only: the relation's confidence (AI-emitted edges carry one). */
  confidence?: number;
  /** Stored: confidence ?? 1. Derived: the basis-weighted co-occurrence count. */
  weight: number;
  /** Derived edges only: the per-context breakdown behind `weight`. */
  basis?: CooccurrenceBasis;
};

export type ConceptGraph = {
  nodes: ConceptGraphNode[];
  edges: ConceptGraphEdge[];
};

/** The minimal record shapes derivation reads (schema records satisfy these). */
export type ConceptGraphInput = {
  concepts: ReadonlyArray<{ id: string; name: string }>;
  notes: ReadonlyArray<{
    id: string;
    sourceId?: string;
    anchorIds: readonly string[];
    conceptIds: readonly string[];
  }>;
  relations: ReadonlyArray<{
    id: string;
    from: { type: string; id: string };
    to: { type: string; id: string };
    relationKind: string;
    confidence?: number;
  }>;
};

/** Basis weights for derived co-occurrence (a shared note is the strongest signal). */
export const COOCCURRENCE_WEIGHTS = { note: 3, anchor: 2, source: 1 } as const;

/** Default render cap (doc §2: "top-N + expand" before the big vault melts it). */
export const GRAPH_RENDER_CAP = 60;

const pairKey = (a: string, b: string): string => (a < b ? `${a}~${b}` : `${b}~${a}`);

// Count one co-occurrence context: every unordered pair among `conceptIds` gains +1
// on `basisKey`. Sets are small (one note/anchor/source's concepts), so O(k²) is fine.
function countPairs(
  counts: Map<string, CooccurrenceBasis>,
  conceptIds: ReadonlySet<string>,
  basisKey: keyof CooccurrenceBasis
): void {
  const ids = [...conceptIds];
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const key = pairKey(ids[i], ids[j]);
      const basis = counts.get(key) ?? { note: 0, anchor: 0, source: 0 };
      basis[basisKey] += 1;
      counts.set(key, basis);
    }
  }
}

/** Derive the full concept graph from vault truth (see module header). */
export function deriveConceptGraph(input: ConceptGraphInput): ConceptGraph {
  const known = new Set(input.concepts.map((concept) => concept.id));

  // —— node size: linked-note count over note.conceptIds ——
  const noteCounts = new Map<string, number>();
  for (const note of input.notes) {
    for (const id of note.conceptIds) {
      if (known.has(id)) noteCounts.set(id, (noteCounts.get(id) ?? 0) + 1);
    }
  }

  // —— stored edges: concept↔concept relations (dangling endpoints are skipped —
  // a deleted/merged concept's leftover edge never renders a ghost node) ——
  const edges: ConceptGraphEdge[] = [];
  for (const relation of input.relations) {
    if (relation.from.type !== "concept" || relation.to.type !== "concept") continue;
    if (!known.has(relation.from.id) || !known.has(relation.to.id)) continue;
    if (relation.from.id === relation.to.id) continue;
    edges.push({
      id: relation.id,
      source: relation.from.id,
      target: relation.to.id,
      kind: "stored",
      relationKind: relation.relationKind,
      ...(relation.confidence !== undefined ? { confidence: relation.confidence } : {}),
      weight: relation.confidence ?? 1
    });
  }

  // —— derived co-occurrence: shared note / anchor / source contexts ——
  const pairCounts = new Map<string, CooccurrenceBasis>();
  const byAnchor = new Map<string, Set<string>>();
  const bySource = new Map<string, Set<string>>();
  for (const note of input.notes) {
    const linked = new Set(note.conceptIds.filter((id) => known.has(id)));
    if (linked.size === 0) continue;
    countPairs(pairCounts, linked, "note");
    for (const anchorId of note.anchorIds) {
      const set = byAnchor.get(anchorId) ?? new Set<string>();
      for (const id of linked) set.add(id);
      byAnchor.set(anchorId, set);
    }
    if (note.sourceId) {
      const set = bySource.get(note.sourceId) ?? new Set<string>();
      for (const id of linked) set.add(id);
      bySource.set(note.sourceId, set);
    }
  }
  for (const set of byAnchor.values()) countPairs(pairCounts, set, "anchor");
  for (const set of bySource.values()) countPairs(pairCounts, set, "source");

  for (const [key, basis] of pairCounts) {
    const [a, b] = key.split("~");
    edges.push({
      id: `co:${key}`,
      source: a,
      target: b,
      kind: "cooccurrence",
      weight:
        basis.note * COOCCURRENCE_WEIGHTS.note +
        basis.anchor * COOCCURRENCE_WEIGHTS.anchor +
        basis.source * COOCCURRENCE_WEIGHTS.source,
      basis
    });
  }

  // —— degree: distinct neighbors across both edge kinds ——
  const neighbors = new Map<string, Set<string>>();
  for (const edge of edges) {
    (neighbors.get(edge.source) ?? neighbors.set(edge.source, new Set()).get(edge.source)!).add(edge.target);
    (neighbors.get(edge.target) ?? neighbors.set(edge.target, new Set()).get(edge.target)!).add(edge.source);
  }

  const nodes: ConceptGraphNode[] = input.concepts
    .map((concept) => ({
      id: concept.id,
      name: concept.name,
      noteCount: noteCounts.get(concept.id) ?? 0,
      degree: neighbors.get(concept.id)?.size ?? 0
    }))
    // Deterministic order: biggest first (the same order the render cap keeps).
    .sort((a, b) => b.noteCount - a.noteCount || b.degree - a.degree || a.name.localeCompare(b.name));

  edges.sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));
  return { nodes, edges };
}

/**
 * The neighborhood subgraph around one concept (BFS over both edge kinds, up to
 * `depth` hops) — the inspector's "what's near this?" query (`GET /api/graph?
 * conceptId=…&depth=…`). Unknown id ⇒ empty graph.
 */
export function graphNeighborhood(graph: ConceptGraph, conceptId: string, depth = 1): ConceptGraph {
  if (!graph.nodes.some((node) => node.id === conceptId)) return { nodes: [], edges: [] };
  const kept = new Set([conceptId]);
  let frontier = new Set([conceptId]);
  for (let hop = 0; hop < depth; hop += 1) {
    const next = new Set<string>();
    for (const edge of graph.edges) {
      if (frontier.has(edge.source) && !kept.has(edge.target)) next.add(edge.target);
      if (frontier.has(edge.target) && !kept.has(edge.source)) next.add(edge.source);
    }
    for (const id of next) kept.add(id);
    if (next.size === 0) break;
    frontier = next;
  }
  return {
    nodes: graph.nodes.filter((node) => kept.has(node.id)),
    edges: graph.edges.filter((edge) => kept.has(edge.source) && kept.has(edge.target))
  };
}

/**
 * The render cap (doc §2 "top-N + expand"): keep the top `maxNodes` nodes (nodes are
 * already sorted biggest-first) + the edges among them. `truncated` drives the view's
 * 展开 affordance.
 */
export function capConceptGraph(
  graph: ConceptGraph,
  maxNodes = GRAPH_RENDER_CAP
): { graph: ConceptGraph; truncated: boolean } {
  if (graph.nodes.length <= maxNodes) return { graph, truncated: false };
  const kept = new Set(graph.nodes.slice(0, maxNodes).map((node) => node.id));
  return {
    graph: {
      nodes: graph.nodes.filter((node) => kept.has(node.id)),
      edges: graph.edges.filter((edge) => kept.has(edge.source) && kept.has(edge.target))
    },
    truncated: true
  };
}
