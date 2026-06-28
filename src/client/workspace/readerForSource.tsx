// readerForSource — resolves an active source to its reader element. This is the
// per-surface reader branching that USED to live inline in App.tsx's `.reader-panel`
// (the `activeViewer.kind === "webview" | "pdfjs" | "image" | "file" | "html"`
// if/else). Moving it here means App has NO per-surface reader branching: the
// `source.viewer` view calls this resolver and renders whatever it returns.
//
// Every annotatable reader takes the SAME annotation contract — `anchors`
// (the host's one paintAnchors list; the reader filters to the kinds it paints),
// `onSelect` (the host's `focus.setDraft`; the reader emits a normalized
// AnchorDraft), and the REVEAL leg `activeAnchorId` + `revealSeq` (the host's
// focused anchor + reveal nonce; the reader scrolls it into view). The only
// per-reader prop is its source locator. Adding a viewer = mapping its surface
// here; no capture/paint/reveal logic lives in the host.

import type { ReactNode } from "react";
import type { AnchorDraft } from "../focus/FocusContext";
import type { PaintAnchor } from "../surfaces/types";
import type { SourceRecord } from "../data/entityClient";
import type { HtmlAnnotationMode } from "../annotations";
import { getSourceViewer } from "../viewers";
import { WebviewReader } from "../WebviewReader";
import { PdfReader } from "../PdfReader";
import { ImageReader } from "../ImageReader";
import { LocalHtmlReader } from "../LocalHtmlReader";
import { DomReader } from "../surfaces/DomReader";

// Build the /api/local URL for a local file, mirroring its absolute path so the
// page's relative assets resolve against its own directory.
function localFileUrl(absPath: string): string {
  const encoded = absPath
    .replace(/\\/g, "/")
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  return `/api/local/${encoded}`;
}

export type ReaderArgs = {
  source: SourceRecord | null;
  /** The host's single normalized paint list (the reader filters by anchorKind). */
  anchors: PaintAnchor[];
  /** The host's single draft sink (`focus.setDraft`). */
  onSelect: (draft: AnchorDraft) => void;
  /** REVEAL: the focused anchor id the reader should scroll into view (`focus.anchor?.id`). */
  activeAnchorId?: string;
  /** REVEAL: the reveal nonce (`focus.revealSeq`); a change re-fires the scroll, even for the same id. */
  revealSeq?: number;
  /** Rendered HTML for the imported-HTML pipeline (DomReader srcDoc). */
  renderedHtml: string;
  /** Note-presentation mode for the DOM HTML reader (floating ↔ margin gutter). */
  annotationMode: HtmlAnnotationMode;
};

// Resolve the reader for the active source. Returns the empty-state placeholder when
// there's nothing to show (no source, or an HTML-pipeline source whose render hasn't
// arrived yet) — the SAME fallbacks the old inline switch produced.
export function readerForSource({
  source,
  anchors,
  onSelect,
  activeAnchorId,
  revealSeq,
  renderedHtml,
  annotationMode
}: ReaderArgs): ReactNode {
  if (!source) {
    return <div className="empty-reader">Select a source to start.</div>;
  }

  const viewer = getSourceViewer(source.sourceType);

  // Unified Web viewer (live sub-mode): web_live opens straight into a live webview tab.
  if (viewer.kind === "webview") {
    return (
      <WebviewReader
        primaryMode="live"
        sourceUrl={(source.metadata?.sourceUrl as string) ?? ""}
        sourceId={source.id}
        anchors={anchors}
        onSelect={onSelect}
        activeAnchorId={activeAnchorId}
        revealSeq={revealSeq}
      />
    );
  }
  // Unified Web viewer (snapshot sub-mode): a webpage snapshot renders its study-id
  // HTML in a DomReader tab (html_selection anchors) and can be opened live. Wait for
  // the rendered HTML, like the HTML pipeline below.
  if (viewer.kind === "web") {
    if (!renderedHtml) {
      return <div className="empty-reader">Select a source to start.</div>;
    }
    return (
      <WebviewReader
        primaryMode="snapshot"
        sourceUrl={(source.metadata?.sourceUrl as string) ?? ""}
        snapshotHtml={renderedHtml}
        sourceId={source.id}
        anchors={anchors}
        onSelect={onSelect}
        activeAnchorId={activeAnchorId}
        revealSeq={revealSeq}
      />
    );
  }
  if (viewer.kind === "pdfjs") {
    return (
      <PdfReader
        fileUrl={`/api/sources/${source.id}/file`}
        sourceId={source.id}
        anchors={anchors}
        onSelect={onSelect}
        activeAnchorId={activeAnchorId}
        revealSeq={revealSeq}
      />
    );
  }
  if (viewer.kind === "image") {
    return (
      <ImageReader
        src={`/api/sources/${source.id}/file`}
        sourceId={source.id}
        anchors={anchors}
        onSelect={onSelect}
        activeAnchorId={activeAnchorId}
        revealSeq={revealSeq}
      />
    );
  }
  if (viewer.kind === "file") {
    return <iframe className="pdf-reader" title="PDF reader" src={`/api/sources/${source.id}/file`} />;
  }
  if (viewer.kind === "html" && source.metadata?.originalPath) {
    return (
      <LocalHtmlReader
        src={localFileUrl(source.metadata.originalPath as string)}
        sourceId={source.id}
        anchors={anchors}
        onSelect={onSelect}
        activeAnchorId={activeAnchorId}
        revealSeq={revealSeq}
      />
    );
  }
  if (viewer.htmlPipeline && renderedHtml) {
    return (
      <DomReader
        srcDoc={renderedHtml}
        sourceId={source.id}
        anchors={anchors}
        onSelect={onSelect}
        activeAnchorId={activeAnchorId}
        revealSeq={revealSeq}
        mode={annotationMode}
      />
    );
  }
  return <div className="empty-reader">Select a source to start.</div>;
}
