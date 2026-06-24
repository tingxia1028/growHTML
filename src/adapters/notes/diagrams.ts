// Diagram note renderers — the async/DOM tier of the note-renderer plugin set.
// Unlike the pure string renderers in render.ts (markdown/mindmap/flashcard),
// these mount interactive SVG via heavy libs, so they are async and operate on a
// container element. The libs are dynamically imported so they only load when a
// diagram note is actually shown (the main bundle stays lean), and this module
// stays importable under Node (vitest) for the registry dispatch test.

export type DiagramRenderer = (container: HTMLElement, content: string) => Promise<void>;

let mermaidReady = false;
let mermaidSeq = 0;

export const renderMermaid: DiagramRenderer = async (container, content) => {
  const mermaid = (await import("mermaid")).default;
  if (!mermaidReady) {
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
    mermaidReady = true;
  }
  mermaidSeq += 1;
  const { svg } = await mermaid.render(`sv-mermaid-${mermaidSeq}`, content);
  container.innerHTML = svg;
};

export const renderMarkmap: DiagramRenderer = async (container, content) => {
  const [{ Transformer }, { Markmap }] = await Promise.all([import("markmap-lib"), import("markmap-view")]);
  const { root } = new Transformer().transform(content);
  container.innerHTML = "";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.style.width = "100%";
  svg.style.height = "260px";
  container.appendChild(svg);
  Markmap.create(svg, undefined, root);
};

const diagramRenderers: Record<string, DiagramRenderer> = {
  mermaid: renderMermaid,
  markmap: renderMarkmap
};

export function getDiagramRenderer(contentType: string | undefined): DiagramRenderer | undefined {
  return contentType ? diagramRenderers[contentType] : undefined;
}

export function isDiagramType(contentType: string | undefined): boolean {
  return !!getDiagramRenderer(contentType);
}
