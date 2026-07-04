// ConceptGraphView (CG-3) — the ONE core graph view over the CG-1 engine's read
// model (GET /api/graph via entityClient). Rendering is hand-rolled SVG + the
// deterministic force layout (zero new deps); style flows through the ACTIVE
// GraphLens (the only plugin seam — style, never structure).
//
// Interaction contract (concept-light-and-graph §2): click a node → focus the
// concept (its ConceptInspector opens in the pane below, exactly like a list row);
// search narrows by the shared normalized-name rule; the top-N cap + 展开全部
// keeps a 94MB vault from melting the SVG. Data refreshes on conceptsVersion —
// the same token every concept/relation mutation bumps.
//
// This module is the LAZY CHUNK boundary: conceptViews.tsx imports it only via
// React.lazy(() => import("./ConceptGraphView")), so the shell pays nothing until
// the 图谱 mode is first opened (default export required by React.lazy).

import { useEffect, useMemo, useState } from "react";
import {
  entityClient,
  type ConceptGraphEdge,
  type ConceptGraphNode,
  type ConceptGraphResponse
} from "../data/entityClient";
import { capConceptGraph, GRAPH_RENDER_CAP } from "../../core/graph/conceptGraph";
import { normalizeConceptName } from "./conceptName";
import { runForceLayout } from "./forceLayout";
import { getGraphLens, listGraphLenses, type GraphLensContext } from "./graphLens";
import { fillMessage, graphMessages } from "./graphMessages";
import { resolveText, t } from "../i18n";
import type { WorkspaceContext } from "./viewRegistry";
import "./conceptGraph.css";

const VIEW_W = 640;
const VIEW_H = 480;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Size-by-noteCount radius (doc §2), lens-scalable, clamped so labels stay legible. */
function nodeRadius(node: ConceptGraphNode, radiusScale = 1): number {
  return clamp((6 + Math.sqrt(node.noteCount) * 4) * clamp(radiusScale, 0.5, 2), 4, 24);
}

/** Weight-driven edge width, lens-scalable, clamped. */
function edgeWidth(edge: ConceptGraphEdge, widthScale = 1): number {
  return clamp((1 + edge.weight / 4) * clamp(widthScale, 0.25, 3), 0.75, 4);
}

export default function ConceptGraphView({ ctx }: { ctx: WorkspaceContext }) {
  const { focus, conceptsVersion } = ctx;
  const [data, setData] = useState<ConceptGraphResponse | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [lensId, setLensId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  // Load the derived graph; re-fetch whenever a command mutated concept/relation
  // data (conceptsVersion — the same token the list watches).
  useEffect(() => {
    let cancelled = false;
    setError("");
    entityClient
      .graph()
      .then((response) => {
        if (!cancelled) setData(response);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load graph");
      });
    return () => {
      cancelled = true;
    };
  }, [conceptsVersion]);

  const focusedConceptId = focus.focus?.type === "concept" ? focus.focus.conceptId : null;
  const lensCtx: GraphLensContext = useMemo(() => ({ focusedConceptId }), [focusedConceptId]);
  const lens = getGraphLens(lensId);
  const lenses = listGraphLenses();

  // search filter (shared normalized-name rule) → lens filter → top-N cap.
  const { graph, truncated } = useMemo(() => {
    if (!data) return { graph: { nodes: [], edges: [] }, truncated: false };
    const query = normalizeConceptName(search);
    let nodes = query
      ? data.nodes.filter((node) => normalizeConceptName(node.name).includes(query))
      : data.nodes;
    if (lens.filter) nodes = nodes.filter((node) => lens.filter!(node, lensCtx));
    const kept = new Set(nodes.map((node) => node.id));
    const edges = data.edges.filter((edge) => kept.has(edge.source) && kept.has(edge.target));
    return capConceptGraph({ nodes, edges }, expanded ? Number.POSITIVE_INFINITY : GRAPH_RENDER_CAP);
  }, [data, search, lens, lensCtx, expanded]);

  // Deterministic static layout (seeded; no animation loop) over the capped set.
  const layout = useMemo(
    () =>
      runForceLayout(
        graph.nodes.map((node) => ({ id: node.id, weight: 1 + node.noteCount })),
        graph.edges.map((edge) => ({ source: edge.source, target: edge.target, weight: edge.weight })),
        { width: VIEW_W, height: VIEW_H, seed: 7 }
      ),
    [graph]
  );

  const hasAnyConcepts = (data?.meta.conceptCount ?? 0) > 0;

  return (
    <div className="concept-graph" data-lens={lens.id}>
      <div className="concept-graph-toolbar">
        <input
          className="concept-graph-search"
          type="search"
          value={search}
          placeholder={t(graphMessages.searchPlaceholder)}
          aria-label={t(graphMessages.searchPlaceholder)}
          onChange={(event) => setSearch(event.target.value)}
        />
        {/* Lens picker only when a plugin actually registered one (core alone = 1). */}
        {lenses.length > 1 ? (
          <select
            className="concept-graph-lens"
            aria-label={t(graphMessages.lensPicker)}
            value={lens.id}
            onChange={(event) => setLensId(event.target.value)}
          >
            {lenses.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {resolveText(entry.title)}
              </option>
            ))}
          </select>
        ) : null}
        <span className="concept-graph-stats">
          {fillMessage(t(graphMessages.stats), { nodes: graph.nodes.length, edges: graph.edges.length })}
        </span>
        {truncated ? (
          <button type="button" className="link-button concept-graph-expand" onClick={() => setExpanded(true)}>
            {fillMessage(t(graphMessages.cappedNotice), { n: GRAPH_RENDER_CAP })} · {t(graphMessages.expandAll)}
          </button>
        ) : null}
      </div>

      {error ? <div className="error-box">{error}</div> : null}

      {!data && !error ? (
        <div className="empty-state">{t(graphMessages.loading)}</div>
      ) : data && !hasAnyConcepts ? (
        <div className="empty-state concept-graph-empty">{t(graphMessages.empty)}</div>
      ) : data && graph.nodes.length === 0 ? (
        <div className="empty-state">{t(graphMessages.noMatches)}</div>
      ) : (
        <svg
          className="concept-graph-svg"
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          role="img"
          aria-label={t(graphMessages.graphMode)}
        >
          <g className="concept-graph-edges">
            {graph.edges.map((edge) => {
              const a = layout.get(edge.source);
              const b = layout.get(edge.target);
              if (!a || !b) return null;
              const style = lens.edgeStyle?.(edge, lensCtx);
              const dashed = style?.dashed ?? edge.kind === "cooccurrence";
              return (
                <line
                  key={edge.id}
                  className={`concept-graph-edge edge-${edge.kind}`}
                  data-edge-id={edge.id}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={style?.stroke}
                  strokeWidth={edgeWidth(edge, style?.widthScale)}
                  strokeDasharray={dashed ? "4 3" : undefined}
                  opacity={style?.opacity}
                />
              );
            })}
          </g>
          <g className="concept-graph-nodes">
            {graph.nodes.map((node) => {
              const position = layout.get(node.id);
              if (!position) return null;
              const style = lens.nodeStyle?.(node, lensCtx);
              const radius = nodeRadius(node, style?.radiusScale);
              return (
                <g
                  key={node.id}
                  className={`concept-graph-node${node.id === focusedConceptId ? " active" : ""}`}
                  data-concept-id={node.id}
                  transform={`translate(${position.x}, ${position.y})`}
                  role="button"
                  tabIndex={0}
                  aria-label={node.name}
                  onClick={() => focus.setFocus({ type: "concept", conceptId: node.id })}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      focus.setFocus({ type: "concept", conceptId: node.id });
                    }
                  }}
                >
                  <title>{`${node.name} · ${node.noteCount} / ${node.degree}`}</title>
                  <circle r={radius} fill={style?.fill} stroke={style?.stroke} />
                  <text className="concept-graph-label" y={radius + 12}>
                    {node.name}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      )}

      {/* The active lens's legend (the default lens names the two edge kinds). */}
      {lens.legend?.length ? (
        <div className="concept-graph-legend">
          {lens.legend.map((entry, index) => (
            <span key={index} className="concept-graph-legend-item">
              <span className="concept-graph-legend-swatch" style={{ background: entry.color }} />
              {resolveText(entry.label)}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
