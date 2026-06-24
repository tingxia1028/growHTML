import { describe, expect, it, vi } from "vitest";
import {
  decorateAnnotations,
  groupForRenderer,
  listAnnotationRenderers,
  registerAnnotationRenderer,
  type AnnotationAnchor,
  type AnnotationNote,
  type AnnotationRenderer
} from "./annotations";

const htmlAnchor = (id: string, studyId: string): AnnotationAnchor => ({
  id,
  anchorKind: "html_selection",
  studyId
});
const pdfAnchor = (id: string): AnnotationAnchor => ({ id, anchorKind: "pdf_selection" });
const note = (anchorId: string, content: string): AnnotationNote => ({ anchorId, content });

function anchorMap(...anchors: AnnotationAnchor[]) {
  return new Map(anchors.map((a) => [a.id, a]));
}

const claimHtml: AnnotationRenderer = {
  id: "test",
  anchorKinds: ["html_selection"],
  styleId: "x",
  css: "",
  paint: () => undefined,
  clear: () => undefined
};

describe("groupForRenderer", () => {
  it("groups notes under their anchor, keeping only claimed kinds", () => {
    const a1 = htmlAnchor("a1", "s1");
    const a2 = pdfAnchor("a2");
    const groups = groupForRenderer(
      claimHtml,
      [note("a1", "first"), note("a1", "second"), note("a2", "pdf note")],
      anchorMap(a1, a2)
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].anchor.id).toBe("a1");
    expect(groups[0].notes.map((n) => n.content)).toEqual(["first", "second"]);
  });

  it("ignores notes with no anchor or a missing anchor", () => {
    const a1 = htmlAnchor("a1", "s1");
    const groups = groupForRenderer(
      claimHtml,
      [{ content: "orphan" }, note("ghost", "missing"), note("a1", "kept")],
      anchorMap(a1)
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].notes).toHaveLength(1);
  });
});

describe("decorateAnnotations", () => {
  // Minimal Document stand-in: only the members the driver touches.
  function fakeDoc() {
    const appended: { id: string }[] = [];
    const existing = new Set<string>();
    return {
      appended,
      head: {
        appendChild: (el: { id: string }) => {
          appended.push(el);
          existing.add(el.id);
        }
      },
      getElementById: (id: string) => (existing.has(id) ? { id } : null),
      createElement: () => ({ id: "", textContent: "" }),
      querySelector: () => null,
      querySelectorAll: () => [] as unknown[]
    };
  }

  it("injects each renderer's stylesheet exactly once across repaints", () => {
    const doc = fakeDoc();
    const ctx = { anchors: [], notes: [] };
    decorateAnnotations(doc as unknown as Document, ctx);
    decorateAnnotations(doc as unknown as Document, ctx);
    // Built-in html renderer's style injected once, not twice.
    expect(doc.appended.filter((el) => el.id === "sv-annot-style")).toHaveLength(1);
  });

  it("clears then paints each renderer with only the anchors it claims", () => {
    const seen: { items: number } = { items: -1 };
    const spy: AnnotationRenderer = {
      id: "spy",
      anchorKinds: ["pdf_selection"],
      styleId: "spy-style",
      css: "",
      clear: vi.fn(),
      paint: vi.fn((_doc, items) => {
        seen.items = items.length;
      })
    };
    registerAnnotationRenderer(spy);
    const doc = fakeDoc();
    decorateAnnotations(doc as unknown as Document, {
      anchors: [htmlAnchor("a1", "s1"), pdfAnchor("a2")],
      notes: [note("a1", "html"), note("a2", "pdf-1"), note("a2", "pdf-2")]
    });
    expect(spy.clear).toHaveBeenCalledOnce();
    expect(spy.paint).toHaveBeenCalledOnce();
    // Only the pdf anchor (1) is handed to the pdf-claiming renderer.
    expect(seen.items).toBe(1);
  });

  it("registers plugins ahead of built-ins", () => {
    const before = listAnnotationRenderers()[0]?.id;
    const plugin: AnnotationRenderer = {
      id: "plugin-first",
      anchorKinds: [],
      styleId: "p",
      css: "",
      paint: () => undefined,
      clear: () => undefined
    };
    registerAnnotationRenderer(plugin);
    expect(listAnnotationRenderers()[0].id).toBe("plugin-first");
    expect(listAnnotationRenderers()[0].id).not.toBe(before);
  });
});
