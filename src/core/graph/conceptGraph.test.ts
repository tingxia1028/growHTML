// CG-1 engine unit tests — graph derivation from a fixture vault (pure inputs):
// nodes/edges/degrees, stored-vs-derived split, co-occurrence bases + weights,
// dangling-relation hygiene, neighborhood BFS, and the top-N render cap.

import { describe, expect, it } from "vitest";
import {
  COOCCURRENCE_WEIGHTS,
  capConceptGraph,
  deriveConceptGraph,
  graphNeighborhood,
  type ConceptGraphInput
} from "./conceptGraph";

const concept = (id: string, name: string) => ({ id, name });
const note = (
  id: string,
  conceptIds: string[],
  opts: { sourceId?: string; anchorIds?: string[] } = {}
) => ({ id, conceptIds, sourceId: opts.sourceId, anchorIds: opts.anchorIds ?? [] });
const relation = (
  id: string,
  from: string,
  to: string,
  relationKind = "related",
  confidence?: number
) => ({
  id,
  from: { type: "concept", id: from },
  to: { type: "concept", id: to },
  relationKind,
  ...(confidence !== undefined ? { confidence } : {})
});

// Fixture vault: 4 concepts; A+B share a note (which sits on anchor an_1 and source
// src_1), B+C share only the source; D is isolated. One stored relation A→C.
const FIXTURE: ConceptGraphInput = {
  concepts: [
    concept("c_a", "Buoyancy"),
    concept("c_b", "Density"),
    concept("c_c", "Pressure"),
    concept("c_d", "Island")
  ],
  notes: [
    note("n_1", ["c_a", "c_b"], { sourceId: "src_1", anchorIds: ["an_1"] }),
    note("n_2", ["c_b"], { sourceId: "src_1" }),
    note("n_3", ["c_c"], { sourceId: "src_1" })
  ],
  relations: [relation("rel_1", "c_a", "c_c", "related", 0.8)]
};

describe("deriveConceptGraph", () => {
  it("emits one node per concept, sized by linked-note count, biggest first", () => {
    const graph = deriveConceptGraph(FIXTURE);
    expect(graph.nodes.map((n) => n.id)).toEqual(["c_b", "c_a", "c_c", "c_d"]);
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    expect(byId.get("c_b")!.noteCount).toBe(2);
    expect(byId.get("c_a")!.noteCount).toBe(1);
    expect(byId.get("c_d")!.noteCount).toBe(0);
  });

  it("emits stored edges for concept↔concept relations with confidence as weight", () => {
    const graph = deriveConceptGraph(FIXTURE);
    const stored = graph.edges.filter((e) => e.kind === "stored");
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      id: "rel_1",
      source: "c_a",
      target: "c_c",
      relationKind: "related",
      confidence: 0.8,
      weight: 0.8
    });
  });

  it("derives co-occurrence edges from shared note/anchor/source contexts", () => {
    const graph = deriveConceptGraph(FIXTURE);
    const co = graph.edges.filter((e) => e.kind === "cooccurrence");
    const ab = co.find((e) => e.id === "co:c_a~c_b");
    // A+B share the note, its anchor, and its source → all three bases count once.
    expect(ab?.basis).toEqual({ note: 1, anchor: 1, source: 1 });
    expect(ab?.weight).toBe(
      COOCCURRENCE_WEIGHTS.note + COOCCURRENCE_WEIGHTS.anchor + COOCCURRENCE_WEIGHTS.source
    );
    // B+C share only src_1 (via different notes) → source-basis only.
    const bc = co.find((e) => e.id === "co:c_b~c_c");
    expect(bc?.basis).toEqual({ note: 0, anchor: 0, source: 1 });
    expect(bc?.weight).toBe(COOCCURRENCE_WEIGHTS.source);
    // A+C co-occur through src_1 too — the derived edge coexists with the stored one.
    expect(co.some((e) => e.id === "co:c_a~c_c")).toBe(true);
  });

  it("computes degree as distinct neighbors across both edge kinds", () => {
    const graph = deriveConceptGraph(FIXTURE);
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    // A touches B (co) and C (stored + co, one neighbor).
    expect(byId.get("c_a")!.degree).toBe(2);
    expect(byId.get("c_d")!.degree).toBe(0);
  });

  it("drops relations with dangling or non-concept endpoints (delete/merge hygiene)", () => {
    const graph = deriveConceptGraph({
      concepts: [concept("c_a", "A")],
      notes: [],
      relations: [
        relation("rel_gone", "c_a", "c_deleted"),
        {
          id: "rel_note",
          from: { type: "concept", id: "c_a" },
          to: { type: "note", id: "n_9" },
          relationKind: "references"
        },
        relation("rel_self", "c_a", "c_a")
      ]
    });
    expect(graph.edges).toEqual([]);
    expect(graph.nodes[0].degree).toBe(0);
  });

  it("ignores conceptIds pointing at deleted concepts (merge/delete reflected)", () => {
    // The same notes, but concept c_b no longer exists (deleted): no ghost node, no
    // edges to it, and counts recomputed from truth.
    const graph = deriveConceptGraph({
      ...FIXTURE,
      concepts: FIXTURE.concepts.filter((c) => c.id !== "c_b")
    });
    expect(graph.nodes.some((n) => n.id === "c_b")).toBe(false);
    expect(graph.edges.some((e) => e.source === "c_b" || e.target === "c_b")).toBe(false);
  });
});

describe("graphNeighborhood", () => {
  it("returns the BFS subgraph up to depth hops", () => {
    const graph = deriveConceptGraph(FIXTURE);
    const hop1 = graphNeighborhood(graph, "c_a", 1);
    expect(new Set(hop1.nodes.map((n) => n.id))).toEqual(new Set(["c_a", "c_b", "c_c"]));
    // Every kept edge has both endpoints inside the neighborhood.
    expect(hop1.edges.every((e) => ["c_a", "c_b", "c_c"].includes(e.source))).toBe(true);
    // The isolated concept only appears in a neighborhood of itself.
    const island = graphNeighborhood(graph, "c_d", 2);
    expect(island.nodes.map((n) => n.id)).toEqual(["c_d"]);
    expect(island.edges).toEqual([]);
  });

  it("returns an empty graph for an unknown concept", () => {
    const graph = deriveConceptGraph(FIXTURE);
    expect(graphNeighborhood(graph, "c_nope", 1)).toEqual({ nodes: [], edges: [] });
  });
});

describe("capConceptGraph", () => {
  it("keeps the top-N nodes and only edges among them, flagging truncation", () => {
    const graph = deriveConceptGraph(FIXTURE);
    const { graph: capped, truncated } = capConceptGraph(graph, 2);
    expect(truncated).toBe(true);
    expect(capped.nodes.map((n) => n.id)).toEqual(["c_b", "c_a"]);
    expect(capped.edges.every((e) => ["c_a", "c_b"].includes(e.source) && ["c_a", "c_b"].includes(e.target))).toBe(
      true
    );
  });

  it("is a no-op below the cap", () => {
    const graph = deriveConceptGraph(FIXTURE);
    const { graph: same, truncated } = capConceptGraph(graph, 100);
    expect(truncated).toBe(false);
    expect(same).toBe(graph);
  });
});
