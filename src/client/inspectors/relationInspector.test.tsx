// @vitest-environment jsdom
// RelationInspector characterization (PLAT-LAYER §2.5 Slice 8a) — pins the IO move
// off inline entityClient onto conceptIo. The component now calls conceptIo.relations /
// conceptIo.concepts (load) and conceptIo.deleteRelation (delete); conceptIo is a
// call-time pass-through to entityClient, so spying entityClient still intercepts.
// Covers: it finds the focused relation in the full list (no GET /:id), renders both
// concept names, and 删除 fires deleteRelation → clears focus + refreshConcepts.

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactElement, ReactNode } from "react";
import { entityClient, type ConceptRecord, type RelationRecord } from "../data/entityClient";
import { RelationInspector } from "./RelationInspector";
import type { InspectorContext } from "./registry";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function concept(id: string, name: string): ConceptRecord {
  return { id, name, aliases: [], description: "", tags: [] };
}

const CONCEPT_A = concept("concept_a", "Render Thread");
const CONCEPT_B = concept("concept_b", "Game Thread");

const RELATION: RelationRecord = {
  id: "relation_1",
  from: { type: "concept", id: "concept_a" },
  to: { type: "concept", id: "concept_b" },
  relationKind: "related"
};

function fakeCtx() {
  const setFocus = vi.fn();
  const refreshConcepts = vi.fn();
  const ctx = {
    focus: { focus: { type: "relation", relationId: "relation_1" }, setFocus },
    conceptsVersion: 0,
    refreshConcepts
  } as unknown as InspectorContext;
  return { ctx, setFocus, refreshConcepts };
}

function mount(node: ReactNode): { container: HTMLElement; root: Root; cleanup: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node as ReactElement));
  return {
    container,
    root,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    }
  };
}

async function renderRelationInspector(ctx: InspectorContext) {
  const mounted = mount(<RelationInspector relationId="relation_1" ctx={ctx} />);
  await act(async () => {}); // flush relations + concepts
  return mounted;
}

beforeEach(() => {
  document.body.innerHTML = "";
  vi.spyOn(entityClient, "relations").mockResolvedValue({ relations: [RELATION] });
  vi.spyOn(entityClient, "concepts").mockResolvedValue({ concepts: [CONCEPT_A, CONCEPT_B] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("RelationInspector — load + delete (through conceptIo)", () => {
  it("finds the focused relation in the full list and renders both concept names", async () => {
    const { ctx } = fakeCtx();
    const { container, cleanup } = await renderRelationInspector(ctx);

    const head = container.querySelector(".relation-inspector .concept-inspector-name");
    expect(head?.textContent).toContain("Render Thread");
    expect(head?.textContent).toContain("Game Thread");
    expect(container.querySelector(".concept-relation-kind")?.textContent).toBe("related");
    cleanup();
  });

  it("删除 fires deleteRelation, clears focus, and refreshes concepts", async () => {
    const { ctx, setFocus, refreshConcepts } = fakeCtx();
    const deleteRelation = vi.spyOn(entityClient, "deleteRelation").mockResolvedValue({ ok: true });
    const { container, cleanup } = await renderRelationInspector(ctx);

    await act(async () => {
      (container.querySelector(".relation-delete") as HTMLButtonElement).click();
    });

    expect(deleteRelation).toHaveBeenCalledWith("relation_1");
    expect(setFocus).toHaveBeenCalledWith(null);
    expect(refreshConcepts).toHaveBeenCalled();
    cleanup();
  });

  it("an unknown relation id renders the not-found empty state (no crash)", async () => {
    const { ctx } = fakeCtx();
    const mounted = mount(<RelationInspector relationId="relation_missing" ctx={ctx} />);
    await act(async () => {});
    expect(mounted.container.querySelector(".relation-inspector .empty-state")?.textContent).toBe(
      "Relation not found."
    );
    mounted.cleanup();
  });
});
