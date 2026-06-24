// SourceViewer registry — the client-side plugin seam for source readers.
// Each source type resolves to a viewer that tells the reader how to display it
// and whether the HTML study pipeline (rendered HTML + study-id anchors + the
// note overlay) applies. New viewers (webview, PDF.js text layer, …) register
// here instead of adding `sourceType === "x"` branches throughout the UI.

export type SourceViewerKind = "html" | "file" | "webview" | "pdfjs";

export type SourceViewer = {
  id: string;
  sourceTypes: string[];
  kind: SourceViewerKind;
  /** Whether the HTML study pipeline applies (study-id anchors + note overlay). */
  htmlPipeline: boolean;
};

const viewers: SourceViewer[] = [
  { id: "html", sourceTypes: ["html", "webpage", "markdown"], kind: "html", htmlPipeline: true },
  { id: "pdf", sourceTypes: ["pdf"], kind: "pdfjs", htmlPipeline: false },
  { id: "web-live", sourceTypes: ["web_live"], kind: "webview", htmlPipeline: false }
];

// HTML is the safe default for any unknown/text-ish source.
const fallbackViewer: SourceViewer = viewers[0];

export function getSourceViewer(sourceType: string | undefined): SourceViewer {
  return viewers.find((viewer) => !!sourceType && viewer.sourceTypes.includes(sourceType)) ?? fallbackViewer;
}

// Plugins register earlier so they take priority over built-ins for a type.
export function registerSourceViewer(viewer: SourceViewer) {
  viewers.unshift(viewer);
}

export function listSourceViewers(): readonly SourceViewer[] {
  return viewers;
}
