// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { WorkspaceNode } from "../data/entityClient";
import {
  getView,
  listViews,
  registerView,
  renderNode,
  type WorkspaceContext
} from "./viewRegistry";

// Stub the surface reader modules so importing `./views` (which pulls readerForSource
// → PdfReader → pdfjs-dist) doesn't evaluate pdf.js in jsdom (it needs DOMMatrix /
// canvas). These views only need to register; their reader internals aren't exercised
// here. This is test-only isolation — production imports the real readers.
vi.mock("../PdfReader", () => ({ PdfReader: () => null }));
vi.mock("../ImageReader", () => ({ ImageReader: () => null }));
vi.mock("../WebviewReader", () => ({ WebviewReader: () => null }));
vi.mock("../LocalHtmlReader", () => ({ LocalHtmlReader: () => null }));

// Importing the built-in views registers them (library / source.viewer / study), so
// listViews() below sees them — same side-effect import the shell uses.
import "./views";

// Render a React node into a fresh detached container and return its HTML.
function renderToHtml(node: React.ReactNode): string {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => {
    root.render(node as React.ReactElement);
  });
  const html = container.innerHTML;
  act(() => root.unmount());
  return html;
}

// A throwaway context — the fake views below don't read it, they just prove the
// registry passes node + ctx through to the right plugin.
const fakeCtx = {} as WorkspaceContext;

describe("ViewRegistry", () => {
  it("registers a view and resolves it by kind", () => {
    const plugin = { kind: "test.echo", render: () => null };
    registerView(plugin);
    expect(getView("test.echo")).toBe(plugin);
  });

  it("getView returns undefined for an unregistered kind", () => {
    expect(getView("test.never-registered")).toBeUndefined();
  });

  it("renderNode invokes the registered plugin's render with the node + ctx", () => {
    let seenNode: WorkspaceNode | null = null;
    let seenCtx: WorkspaceContext | null = null;
    registerView({
      kind: "test.capture",
      render: (node, ctx) => {
        seenNode = node;
        seenCtx = ctx;
        return <div className="captured">{node.id}</div>;
      }
    });

    const node: WorkspaceNode = { id: "n1", kind: "test.capture", params: { foo: "bar" } };
    const html = renderToHtml(renderNode(node, fakeCtx));

    expect(seenNode).toBe(node);
    expect(seenCtx).toBe(fakeCtx);
    expect(html).toContain('class="captured"');
    expect(html).toContain("n1");
  });

  it("renderNode handles an unknown kind gracefully (no throw, inert placeholder)", () => {
    const node: WorkspaceNode = { id: "x", kind: "test.unknown-kind" };
    const html = renderToHtml(renderNode(node, fakeCtx));
    expect(html).toContain("workspace-node-missing");
    expect(html).toContain("test.unknown-kind");
  });

  it("listViews includes the registered built-in panel views", () => {
    const kinds = listViews().map((view) => view.kind);
    expect(kinds).toContain("library");
    expect(kinds).toContain("source.viewer");
    expect(kinds).toContain("study");
  });

  it("a later registration for the same kind takes priority", () => {
    registerView({ kind: "test.dup", render: () => <span>first</span> });
    registerView({ kind: "test.dup", render: () => <span>second</span> });
    const html = renderToHtml(renderNode({ id: "d", kind: "test.dup" }, fakeCtx));
    expect(html).toContain("second");
    expect(html).not.toContain("first");
  });
});
