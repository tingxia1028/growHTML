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

// F1 (P-A2, host-realm gate — delta 3): whether a viewer paints into the HOST document
// (the main app DOM) rather than an isolated iframe/webview realm. Only `pdfjs` and
// `image` do (PdfReader / ImageReader render + annotate in the host page). Two host-realm
// bodies mounted at once would share the ONE `#sv-note-card` + the module-level
// `notesHiddenAll` / `anchorGlyphsVisible` singletons + HideAllNotesToggle's per-source
// seeding effect, so V1 allows at most ONE host-realm body concurrently; a split is
// iframe/webview-backed only. (Per-paneId scoping of those singletons is the proper fix,
// deferred — annotationLayer.ts/markerOverlay.ts are hot.)
export function isHostRealmViewerKind(kind: SourceViewerKind): boolean {
  return kind === "pdfjs" || kind === "image";
}

// Convenience: is a source (by its sourceType) a host-realm surface?
export function isHostRealmSource(sourceType: string | undefined): boolean {
  return isHostRealmViewerKind(getSourceViewer(sourceType).kind);
}

// Plugins register earlier so they take priority over built-ins for a type.
export function registerSourceViewer(viewer: SourceViewer) {
  viewers.unshift(viewer);
}

export function listSourceViewers(): readonly SourceViewer[] {
  return viewers;
}
