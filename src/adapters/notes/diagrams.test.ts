import { describe, expect, it } from "vitest";
import { getDiagramRenderer, isDiagramType } from "./diagrams";

// Only the registry dispatch is unit-tested here; the actual SVG rendering is
// async + DOM-bound (heavy libs) and is covered by the browser e2e.
describe("diagram renderer registry", () => {
  it("resolves mermaid and markmap renderers", () => {
    expect(typeof getDiagramRenderer("mermaid")).toBe("function");
    expect(typeof getDiagramRenderer("markmap")).toBe("function");
    expect(isDiagramType("mermaid")).toBe(true);
    expect(isDiagramType("markmap")).toBe(true);
  });

  it("returns undefined for non-diagram / sync types", () => {
    expect(getDiagramRenderer("markdown")).toBeUndefined();
    expect(getDiagramRenderer(undefined)).toBeUndefined();
    expect(isDiagramType("flashcard")).toBe(false);
  });
});
