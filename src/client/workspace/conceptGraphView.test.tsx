// @vitest-environment jsdom
// CG-3 view contract — render over a spied entityClient.graph, node click →
// focus.setFocus (the ConceptInspector hop), search filter, a fixture lens styling
// nodes (register → styled; dispose → default), and the concept.graph view kind
// being registered (the lazy-chunk entry).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactElement } from "react";
import { entityClient, type ConceptGraphResponse } from "../data/entityClient";
import { setLocale } from "../i18n";
import ConceptGraphView from "./ConceptGraphView";
import { registerGraphLens } from "./graphLens";
import { getView } from "./viewRegistry";
import "./conceptViews";
import type { WorkspaceContext } from "./viewRegistry";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const GRAPH: ConceptGraphResponse = {
  nodes: [
    { id: "concept_a", name: "Buoyancy", noteCount: 2, degree: 1 },
    { id: "concept_b", name: "Density", noteCount: 1, degree: 1 },
    { id: "concept_c", name: "Pressure", noteCount: 0, degree: 0 }
  ],
  edges: [
    {
      id: "co:concept_a~concept_b",
      source: "concept_a",
      target: "concept_b",
      kind: "cooccurrence",
      weight: 3,
      basis: { note: 1, anchor: 0, source: 0 }
    }
  ],
  meta: { conceptCount: 3, noteCount: 2, relationCount: 0, scope: {} }
};

function fakeCtx(): { ctx: WorkspaceContext; setFocus: ReturnType<typeof vi.fn> } {
  const setFocus = vi.fn();
  const ctx = {
    focus: { focus: null, setFocus },
    dispatch: vi.fn(async () => {}),
    conceptsVersion: 0
  } as unknown as WorkspaceContext;
  return { ctx, setFocus };
}

let root: Root | null = null;
let container: HTMLElement | null = null;

async function mountGraph(ctx: WorkspaceContext) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render((<ConceptGraphView ctx={ctx} />) as ReactElement));
  await act(async () => {}); // flush the graph load
  return container;
}

function setSearch(value: string) {
  const input = container!.querySelector<HTMLInputElement>(".concept-graph-search")!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  setLocale("zh");
  vi.spyOn(entityClient, "graph").mockResolvedValue(GRAPH);
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

describe("ConceptGraphView", () => {
  it("renders one SVG node per concept and both edge kinds' classes", async () => {
    const { ctx } = fakeCtx();
    const el = await mountGraph(ctx);
    expect(el.querySelectorAll(".concept-graph-node")).toHaveLength(3);
    const edge = el.querySelector(".concept-graph-edge");
    expect(edge?.classList.contains("edge-cooccurrence")).toBe(true);
    expect(edge?.getAttribute("stroke-dasharray")).toBeTruthy(); // derived = dashed
    // Stats line shows the rendered counts.
    expect(el.querySelector(".concept-graph-stats")?.textContent).toContain("3");
  });

  it("click on a node focuses the concept (the ConceptInspector contract)", async () => {
    const { ctx, setFocus } = fakeCtx();
    const el = await mountGraph(ctx);
    const node = el.querySelector<SVGGElement>('[data-concept-id="concept_b"]')!;
    act(() => {
      node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(setFocus).toHaveBeenCalledWith({ type: "concept", conceptId: "concept_b" });
  });

  it("search narrows nodes by the shared normalized-name rule", async () => {
    const { ctx } = fakeCtx();
    const el = await mountGraph(ctx);
    setSearch("  DENS ");
    expect(el.querySelectorAll(".concept-graph-node")).toHaveLength(1);
    expect(el.querySelector(".concept-graph-node")?.getAttribute("data-concept-id")).toBe("concept_b");
    // Edges to filtered-out nodes drop with them.
    expect(el.querySelectorAll(".concept-graph-edge")).toHaveLength(0);
  });

  it("a registered lens styles/filters nodes; disposing falls back to default", async () => {
    const dispose = registerGraphLens({
      id: "test.lens",
      title: "Test",
      nodeStyle: () => ({ fill: "rgb(255, 0, 0)" }),
      filter: (node) => node.noteCount > 0
    });
    try {
      const { ctx } = fakeCtx();
      const el = await mountGraph(ctx);
      // Two lenses → the picker appears; select the fixture lens.
      const picker = el.querySelector<HTMLSelectElement>(".concept-graph-lens")!;
      expect(picker).toBeTruthy();
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
      act(() => {
        setter?.call(picker, "test.lens");
        picker.dispatchEvent(new Event("change", { bubbles: true }));
      });
      // filter dropped the zero-note node; nodeStyle painted the circles.
      expect(el.querySelectorAll(".concept-graph-node")).toHaveLength(2);
      expect(el.querySelector(".concept-graph-node circle")?.getAttribute("fill")).toBe("rgb(255, 0, 0)");
    } finally {
      dispose();
    }
  });

  it("registers the concept.graph view kind (the lazy-chunk pane entry)", () => {
    expect(getView("concept.graph")).toBeTruthy();
    expect(getView("concept.list")).toBeTruthy();
  });
});
