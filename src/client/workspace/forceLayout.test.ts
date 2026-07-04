// CG-3 layout — the hand-rolled force sim must be deterministic (seeded), bounded,
// and actually pull linked nodes together (the one property a force layout owes us).

import { describe, expect, it } from "vitest";
import { runForceLayout } from "./forceLayout";

const NODES = [
  { id: "a", weight: 3 },
  { id: "b", weight: 1 },
  { id: "c", weight: 1 },
  { id: "d", weight: 2 }
];
const EDGES = [{ source: "a", target: "b", weight: 2 }];
const OPTS = { width: 640, height: 480, seed: 7 };

const dist = (p: { x: number; y: number }, q: { x: number; y: number }) =>
  Math.hypot(p.x - q.x, p.y - q.y);

describe("runForceLayout", () => {
  it("is deterministic for the same seed (jsdom tests + screenshots stay stable)", () => {
    const one = runForceLayout(NODES, EDGES, OPTS);
    const two = runForceLayout(NODES, EDGES, OPTS);
    expect([...two.entries()]).toEqual([...one.entries()]);
  });

  it("keeps every node inside the padded bounds", () => {
    const layout = runForceLayout(NODES, EDGES, OPTS);
    for (const point of layout.values()) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(OPTS.width);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(OPTS.height);
    }
  });

  it("pulls linked nodes closer than unlinked ones", () => {
    const layout = runForceLayout(NODES, EDGES, OPTS);
    const a = layout.get("a")!;
    const b = layout.get("b")!;
    const c = layout.get("c")!;
    // a—b share the only edge; a…c are strangers.
    expect(dist(a, b)).toBeLessThan(dist(a, c));
  });

  it("handles the degenerate sizes (empty / single node)", () => {
    expect(runForceLayout([], [], OPTS).size).toBe(0);
    const single = runForceLayout([{ id: "only" }], [], OPTS);
    expect(single.get("only")).toEqual({ x: OPTS.width / 2, y: OPTS.height / 2 });
  });
});
