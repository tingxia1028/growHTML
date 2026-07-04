// GraphLens contribution point (CG-1/CG-3) — the registry contract: core default
// always present, register/dispose round-trip, unknown-id fallback, default-first
// ordering. Style-only by TYPE: a lens has no seam to add nodes/edges.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_GRAPH_LENS_ID,
  getGraphLens,
  listGraphLenses,
  registerGraphLens,
  type GraphLens
} from "./graphLens";

const fixtureLens: GraphLens = {
  id: "test.red",
  title: { zh: "红色", en: "Red" },
  nodeStyle: () => ({ fill: "red" }),
  filter: (node) => node.noteCount > 0
};

describe("graph lens registry", () => {
  it("ships the core default lens through the same seam plugins use", () => {
    const lens = getGraphLens(DEFAULT_GRAPH_LENS_ID);
    expect(lens.id).toBe(DEFAULT_GRAPH_LENS_ID);
    expect(lens.legend?.length).toBeGreaterThan(0);
    expect(listGraphLenses().some((entry) => entry.id === DEFAULT_GRAPH_LENS_ID)).toBe(true);
  });

  it("registers a plugin lens, resolves it, and falls back after dispose", () => {
    const dispose = registerGraphLens(fixtureLens);
    try {
      expect(getGraphLens("test.red")).toBe(fixtureLens);
      // Default lens sorts FIRST regardless of registration order.
      expect(listGraphLenses()[0].id).toBe(DEFAULT_GRAPH_LENS_ID);
      const node = { id: "c1", name: "n", noteCount: 2, degree: 0 };
      expect(fixtureLens.nodeStyle!(node, { focusedConceptId: null })).toEqual({ fill: "red" });
    } finally {
      dispose();
    }
    // Unregistered / unknown ids FALL BACK to the default — a vanished kit lens
    // can never blank the graph.
    expect(getGraphLens("test.red").id).toBe(DEFAULT_GRAPH_LENS_ID);
    expect(getGraphLens(null).id).toBe(DEFAULT_GRAPH_LENS_ID);
  });

  it("disposer is identity-safe (re-registration is not clobbered by an old disposer)", () => {
    const first = registerGraphLens(fixtureLens);
    const replacement: GraphLens = { id: "test.red", title: "Red v2" };
    const second = registerGraphLens(replacement);
    first(); // stale disposer — must NOT remove the replacement
    expect(getGraphLens("test.red")).toBe(replacement);
    second();
    expect(getGraphLens("test.red").id).toBe(DEFAULT_GRAPH_LENS_ID);
  });
});
