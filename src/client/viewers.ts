// SourceViewer registry — the client-side plugin seam for source readers.
// Each source type resolves to a viewer that tells the reader how to display it
// and whether the HTML study pipeline (rendered HTML + study-id anchors + the
// note overlay) applies. New viewers (webview, PDF.js text layer, …) register
// here instead of adding `sourceType === "x"` branches throughout the UI.

export type SourceViewerKind = "html" | "web" | "file" | "webview" | "pdfjs" | "image";

export type SourceViewer = {
  id: string;
  sourceTypes: string[];
  kind: SourceViewerKind;
  /** Whether the HTML study pipeline applies (study-id anchors + note overlay). */
  htmlPipeline: boolean;
};

const viewers: SourceViewer[] = [
  { id: "html", sourceTypes: ["html", "markdown"], kind: "html", htmlPipeline: true },
  // A saved webpage snapshot shares the HTML study pipeline (study-id anchors), but
  // renders in the UNIFIED Web viewer's snapshot tab — the same tabbed shell as live
  // web, so a snapshot can be opened live (and links open as live tabs) without a
  // separate viewer. Both sub-modes keep their own anchor path (snapshot →
  // html_selection on the DomReader; live → web_text_quote in the webview guest).
  { id: "web", sourceTypes: ["webpage"], kind: "web", htmlPipeline: true },
  // Live web opens straight into the unified Web viewer in its live sub-mode.
  { id: "web-live", sourceTypes: ["web_live"], kind: "webview", htmlPipeline: false },
  // PDFs render via PDF.js (canvas + a selectable text layer) so they can be
  // annotated like HTML — text-quote selections AND rubber-band region marks over
  // figures/scanned pages. (A native Chromium iframe can't be overlaid for region
  // capture, so we render PDFs in the host page instead.)
  { id: "pdf", sourceTypes: ["pdf"], kind: "pdfjs", htmlPipeline: false },
  // Images render as a host-page <img> with a rubber-band overlay so an area of
  // the image can be marked as an image_region anchor.
  { id: "image", sourceTypes: ["image"], kind: "image", htmlPipeline: false },
  // Everything else is served as-is and rendered natively in an iframe (code/word/
  // transcript) — these can't be selected/overlaid, which is expected.
  { id: "file", sourceTypes: ["word", "code", "transcript"], kind: "file", htmlPipeline: false }
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
