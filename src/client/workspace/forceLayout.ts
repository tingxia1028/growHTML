// Hand-rolled force-directed layout (CG-3) — ZERO new dependencies, on purpose:
// the doc allowed "small dep or hand-rolled", and a ~80-line Fruchterman–Reingold
// over the CAPPED node set (≤ GRAPH_RENDER_CAP after top-N) needs no d3. Pure +
// DETERMINISTIC (seeded PRNG, fixed iteration count, no rAF): the same graph always
// lays out identically, so jsdom tests and screenshots are stable.

export type ForceLayoutNode = {
  id: string;
  /** Relative mass — heavier nodes claim more space (noteCount feeds this). */
  weight?: number;
};

export type ForceLayoutEdge = {
  source: string;
  target: string;
  /** Spring strength multiplier (edge weight feeds this; clamped internally). */
  weight?: number;
};

export type ForceLayoutOptions = {
  width: number;
  height: number;
  /** Simulation steps (default 150 — settles small graphs; still <1ms per 60 nodes). */
  iterations?: number;
  /** PRNG seed for the initial placement (default 42). */
  seed?: number;
};

/** mulberry32 — tiny deterministic PRNG (no Math.random anywhere in the layout). */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PADDING = 24;

/**
 * Compute static positions for every node id. Fruchterman–Reingold shape:
 * repulsion k²/d between all pairs, spring d²/k along edges, linear cooling,
 * bounds-clamp each step. O(iterations · n²) — fine for the capped render set.
 */
export function runForceLayout(
  nodes: readonly ForceLayoutNode[],
  edges: readonly ForceLayoutEdge[],
  options: ForceLayoutOptions
): Map<string, { x: number; y: number }> {
  const { width, height } = options;
  const iterations = options.iterations ?? 150;
  const random = mulberry32(options.seed ?? 42);
  const positions = new Map<string, { x: number; y: number }>();
  if (nodes.length === 0) return positions;

  // Seeded initial scatter (kept off the exact borders).
  for (const node of nodes) {
    positions.set(node.id, {
      x: PADDING + random() * Math.max(1, width - PADDING * 2),
      y: PADDING + random() * Math.max(1, height - PADDING * 2)
    });
  }
  if (nodes.length === 1) {
    positions.set(nodes[0].id, { x: width / 2, y: height / 2 });
    return positions;
  }

  // 0.6·√(area/n): the classic FR spacing shrunk so spring equilibrium for linked
  // pairs lands well inside the box — linked nodes end visibly closer than
  // strangers even on tiny graphs (see forceLayout.test.ts).
  const area = width * height;
  const k = 0.6 * Math.sqrt(area / nodes.length);
  const weightOf = new Map(nodes.map((node) => [node.id, Math.max(1, node.weight ?? 1)]));
  // Springs only between ids we actually laid out (defensive against stray edges).
  const springs = edges.filter((edge) => positions.has(edge.source) && positions.has(edge.target));

  let temperature = Math.max(width, height) / 8;
  const cooling = temperature / (iterations + 1);

  for (let step = 0; step < iterations; step += 1) {
    const forces = new Map(nodes.map((node) => [node.id, { x: 0, y: 0 }]));

    // Repulsion between every pair (heavier nodes push a bit harder).
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = positions.get(nodes[i].id)!;
        const b = positions.get(nodes[j].id)!;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 0.01) {
          // Coincident points: nudge apart deterministically.
          dx = 0.01 * (i - j);
          dy = 0.01;
          dist = Math.sqrt(dx * dx + dy * dy);
        }
        const mass = Math.sqrt(weightOf.get(nodes[i].id)! * weightOf.get(nodes[j].id)!);
        const repulse = ((k * k) / dist) * Math.min(2, mass);
        const fx = (dx / dist) * repulse;
        const fy = (dy / dist) * repulse;
        const fa = forces.get(nodes[i].id)!;
        const fb = forces.get(nodes[j].id)!;
        fa.x += fx;
        fa.y += fy;
        fb.x -= fx;
        fb.y -= fy;
      }
    }

    // Spring attraction along edges (weight-scaled, clamped).
    for (const edge of springs) {
      const a = positions.get(edge.source)!;
      const b = positions.get(edge.target)!;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dist = Math.max(0.01, Math.sqrt(dx * dx + dy * dy));
      const strength = Math.min(3, Math.max(0.5, edge.weight ?? 1));
      const attract = ((dist * dist) / k) * strength;
      const fx = (dx / dist) * attract;
      const fy = (dy / dist) * attract;
      const fa = forces.get(edge.source)!;
      const fb = forces.get(edge.target)!;
      fa.x -= fx;
      fa.y -= fy;
      fb.x += fx;
      fb.y += fy;
    }

    // Mild center gravity so disconnected nodes drift inward instead of pinning
    // to the clamped walls (keeps sparse graphs readable).
    for (const node of nodes) {
      const position = positions.get(node.id)!;
      const force = forces.get(node.id)!;
      force.x += (width / 2 - position.x) * 0.06;
      force.y += (height / 2 - position.y) * 0.06;
    }

    // Move by force, capped by temperature; clamp into the padded bounds; cool.
    for (const node of nodes) {
      const position = positions.get(node.id)!;
      const force = forces.get(node.id)!;
      const magnitude = Math.max(0.01, Math.sqrt(force.x * force.x + force.y * force.y));
      const step_ = Math.min(magnitude, temperature);
      position.x += (force.x / magnitude) * step_;
      position.y += (force.y / magnitude) * step_;
      position.x = Math.min(width - PADDING, Math.max(PADDING, position.x));
      position.y = Math.min(height - PADDING, Math.max(PADDING, position.y));
    }
    temperature = Math.max(0.1, temperature - cooling);
  }

  return positions;
}
