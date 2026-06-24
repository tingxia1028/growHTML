// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { FocusTarget } from "../focus/FocusContext";
import {
  getInspector,
  listInspectors,
  registerInspector,
  renderInspector,
  type InspectorContext
} from "./registry";

// Render a React node into a detached container and return its HTML.
function renderToHtml(node: React.ReactNode): string {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(node as React.ReactElement));
  const html = container.innerHTML;
  act(() => root.unmount());
  return html;
}

const fakeCtx = {} as InspectorContext;

describe("InspectorRegistry", () => {
  it("registers an inspector and resolves it by targetType", () => {
    const plugin = { targetType: "concept" as const, render: () => null };
    registerInspector(plugin);
    expect(getInspector("concept")).toBe(plugin);
  });

  it("renderInspector renders the matching inspector with the focus + ctx", () => {
    let seenFocus: FocusTarget | null = null;
    let seenCtx: InspectorContext | null = null;
    registerInspector({
      targetType: "concept",
      render: (focus, ctx) => {
        seenFocus = focus;
        seenCtx = ctx;
        return <div className="inspected">{focus.type === "concept" ? focus.conceptId : ""}</div>;
      }
    });
    const focus: FocusTarget = { type: "concept", conceptId: "concept_42" };
    const html = renderToHtml(renderInspector(focus, fakeCtx));
    expect(seenFocus).toBe(focus);
    expect(seenCtx).toBe(fakeCtx);
    expect(html).toContain("concept_42");
  });

  it("renders nothing for a null focus or an un-inspectable focus (no throw)", () => {
    expect(renderInspector(null, fakeCtx)).toBeNull();
    // A focus kind with no registered inspector resolves to null, not a throw.
    expect(renderInspector({ type: "patch", patchId: "patch_1" }, fakeCtx)).toBeNull();
  });

  it("a later registration for the same targetType wins", () => {
    registerInspector({ targetType: "relation", render: () => <span>first</span> });
    registerInspector({ targetType: "relation", render: () => <span>second</span> });
    const html = renderToHtml(renderInspector({ type: "relation", relationId: "r1" }, fakeCtx));
    expect(html).toContain("second");
    expect(html).not.toContain("first");
  });

  it("listInspectors includes the registered kinds", () => {
    registerInspector({ targetType: "concept", render: () => null });
    registerInspector({ targetType: "relation", render: () => null });
    const kinds = listInspectors().map((inspector) => inspector.targetType);
    expect(kinds).toContain("concept");
    expect(kinds).toContain("relation");
  });
});
