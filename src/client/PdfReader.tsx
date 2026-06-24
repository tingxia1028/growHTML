import { useEffect, useRef, useState } from "react";
import { ScanLine, TextCursor } from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";
import { EventBus, PDFLinkService, PDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs";
import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";
import { applyHighlight, clearAnnotations, ensureAnnotationLayer } from "./annotationLayer";
import type { AnchorDraft } from "./focus/FocusContext";
import { anchorsOfKind, type SurfaceReaderProps } from "./surfaces/types";
import { isRealRegion, normalizeDragRect, placeRegionBox } from "./surfaces/overlay";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

type PdfReaderProps = SurfaceReaderProps & {
  fileUrl: string;
  // The active source id — stamped onto emitted drafts.
  sourceId: string;
};

const CONTEXT = 32;

// PDF surface adapter — one of the two OVERLAY readers. Renders a PDF with pdf.js's
// own ready-made `PDFViewer` component (virtualized scrolling + zoom + search + a
// selectable text layer) so PDFs can be annotated like HTML, while the viewer owns
// scrolling/paging (the previous hand-rolled eager-render loop had lost its scroll):
//   READ : select text → AnchorDraft { mode:"quote", kind:"pdf", page, quote, … }
//          OR rubber-band a region → AnchorDraft { mode:"region", kind:"pdf", rect }.
//   WRITE: paint pdf_selection anchors from the `anchors` prop — a text highlight
//          (match the quote in the text layer) or, when the anchor carries a rect,
//          a region box. Both hook the shared note card via applyHighlight.
//
// PDFViewer VIRTUALIZES pages: a `.page[data-page-number="N"]` (with its `.textLayer`)
// only exists in the DOM once that page has scrolled into view and rendered. So we
// (re)paint anchors on every `pagerendered`, after `scalechanging` (zoom re-lays-out
// the text layer), and whenever the `anchors` prop changes — painting only onto the
// pages currently present; pages repaint themselves as they render.
export function PdfReader({ fileUrl, sourceId, anchors, onSelect }: PdfReaderProps) {
  // The outer scroll root PDFViewer drives (must be absolutely positioned — PDFViewer
  // asserts this) and the inner `.pdfViewer` it fills with pages.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerElRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<PDFViewer | null>(null);

  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const sourceIdRef = useRef(sourceId);
  sourceIdRef.current = sourceId;
  // Only the pdf_selection anchors are ours to paint; keep the live subset in a ref
  // so the event-driven repaint handlers always see the latest.
  const anchorsRef = useRef(anchorsOfKind(anchors, "pdf_selection"));
  anchorsRef.current = anchorsOfKind(anchors, "pdf_selection");

  // Region (rubber-band) mode: while on, the text layer is click-through and a
  // drag draws a selection rectangle that becomes a pdf_selection region anchor.
  const [regionMode, setRegionMode] = useState(false);
  const regionModeRef = useRef(regionMode);
  regionModeRef.current = regionMode;

  // Paint every pdf_selection anchor onto whichever pages are CURRENTLY rendered.
  // Idempotent: it first clears its own marks so repaints (page render, zoom, anchor
  // change) don't stack. Pages not yet virtualized in get painted when they render.
  function highlightAnchors() {
    const viewerEl = viewerElRef.current;
    if (!viewerEl) return;
    ensureAnnotationLayer(document);
    viewerEl.querySelectorAll(".pdf-anchor-hit").forEach((el) => el.classList.remove("pdf-anchor-hit"));
    viewerEl.querySelectorAll(".pdf-region-box").forEach((el) => el.remove());
    clearAnnotations(viewerEl);
    for (const anchor of anchorsRef.current) {
      const pageEl = viewerEl.querySelector(`.page[data-page-number="${anchor.page}"]`) as HTMLElement | null;
      if (!pageEl) continue; // page not rendered yet — repainted on its pagerendered

      // Region anchor: draw a box at its normalized rect (no text to highlight).
      // Normalized 0..1 coords survive zoom because the box is sized in percentages.
      if (anchor.rect) {
        const box = document.createElement("div");
        box.className = "pdf-region-box";
        placeRegionBox(box, anchor.rect, anchor.note, anchor.id);
        pageEl.appendChild(box);
        continue;
      }

      const textLayer = pageEl.querySelector(".textLayer");
      if (!textLayer || !anchor.quote) continue;
      for (const span of Array.from(textLayer.querySelectorAll("span"))) {
        const text = span.textContent ?? "";
        if (text && anchor.quote.includes(text.trim()) && text.trim().length > 1) {
          // Keep .pdf-anchor-hit for the visual; add the shared highlight + note
          // card (same layer the HTML reader and webview guest use).
          span.classList.add("pdf-anchor-hit");
          applyHighlight(span, anchor.note, anchor.id);
        }
      }
    }
  }

  // Build the PDFViewer once per document, wire its events, and bind the
  // selection / region gestures onto the scroll root.
  useEffect(() => {
    const container = containerRef.current;
    const viewerEl = viewerElRef.current;
    if (!container || !viewerEl || !fileUrl) return;

    const eventBus = new EventBus();
    const linkService = new PDFLinkService({ eventBus });
    const viewer = new PDFViewer({ container, viewer: viewerEl, eventBus, linkService });
    linkService.setViewer(viewer);
    viewerRef.current = viewer;

    // Fit the page width once the viewer knows the page geometry, so it scrolls.
    eventBus.on("pagesinit", () => {
      viewer.currentScaleValue = "page-width";
    });
    // Pages are virtualized — (re)paint anchors as each page renders, and after a
    // zoom re-lays-out the text layer. Both fire often; highlightAnchors is idempotent.
    eventBus.on("pagerendered", () => highlightAnchors());
    eventBus.on("scalechanging", () => highlightAnchors());

    const loadingTask = pdfjsLib.getDocument({ url: fileUrl });
    let cancelled = false;
    loadingTask.promise.then(
      (pdf) => {
        if (cancelled) return;
        viewer.setDocument(pdf);
        linkService.setDocument(pdf, null);
      },
      () => {
        /* load error — leave the viewer empty */
      }
    );

    // —— Text selection → quote draft ——
    // Read the live selection, find the enclosing rendered page, and emit a quote
    // draft with surrounding context taken from that page's text layer.
    const onMouseUp = () => {
      if (regionModeRef.current) return; // region mode handles its own gesture
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
      const exact = selection.toString().replace(/\s+/g, " ").trim();
      if (!exact) return;

      const range = selection.getRangeAt(0);
      const startEl =
        range.startContainer.nodeType === Node.ELEMENT_NODE
          ? (range.startContainer as Element)
          : range.startContainer.parentElement;
      const pageEl = startEl?.closest(".page") as HTMLElement | null;
      if (!pageEl || !viewerEl.contains(pageEl)) return; // selection outside the viewer
      const page = Number(pageEl.dataset.pageNumber) || 1;
      const pageText = (pageEl.querySelector(".textLayer")?.textContent ?? "").replace(/\s+/g, " ");
      const index = pageText.indexOf(exact);
      const prefix = index >= 0 ? pageText.slice(Math.max(0, index - CONTEXT), index) : "";
      const suffix = index >= 0 ? pageText.slice(index + exact.length, index + exact.length + CONTEXT) : "";

      const draft: AnchorDraft = {
        mode: "quote",
        sourceId: sourceIdRef.current,
        kind: "pdf",
        quote: exact,
        prefix,
        suffix,
        page
      };
      onSelectRef.current(draft);
    };
    container.addEventListener("mouseup", onMouseUp);

    // —— Region (rubber-band) gesture ——
    // While in region mode, dragging on a rendered page draws a marquee; on release
    // the normalized rect (0..1 within that page) + page number become a region draft.
    // Rect is normalized to the page box so it stays correct across zoom.
    let dragPage: HTMLElement | null = null;
    let startX = 0;
    let startY = 0;
    let marquee: HTMLDivElement | null = null;

    const onMouseDown = (event: MouseEvent) => {
      if (!regionModeRef.current || event.button !== 0) return;
      const target = event.target as Element | null;
      const pageEl = target?.closest(".page") as HTMLElement | null;
      if (!pageEl || !viewerEl.contains(pageEl)) return;
      event.preventDefault();
      dragPage = pageEl;
      const rect = pageEl.getBoundingClientRect();
      startX = event.clientX - rect.left;
      startY = event.clientY - rect.top;
      marquee = document.createElement("div");
      marquee.className = "pdf-region-marquee";
      marquee.style.left = `${startX}px`;
      marquee.style.top = `${startY}px`;
      pageEl.appendChild(marquee);
    };

    const onMouseMove = (event: MouseEvent) => {
      if (!dragPage || !marquee) return;
      const rect = dragPage.getBoundingClientRect();
      const curX = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
      const curY = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
      marquee.style.left = `${Math.min(startX, curX)}px`;
      marquee.style.top = `${Math.min(startY, curY)}px`;
      marquee.style.width = `${Math.abs(curX - startX)}px`;
      marquee.style.height = `${Math.abs(curY - startY)}px`;
    };

    const finishDrag = (event: MouseEvent) => {
      if (!dragPage || !marquee) return;
      const pageEl = dragPage;
      const rect = pageEl.getBoundingClientRect();
      const start = { x: startX, y: startY };
      const current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      marquee.remove();
      marquee = null;
      dragPage = null;
      if (!isRealRegion(rect, start, current)) return; // ignore stray clicks
      const page = Number(pageEl.dataset.pageNumber) || 1;
      const draft: AnchorDraft = {
        mode: "region",
        sourceId: sourceIdRef.current,
        kind: "pdf",
        rect: normalizeDragRect(rect, start, current),
        page
      };
      onSelectRef.current(draft);
    };

    container.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", finishDrag);

    return () => {
      cancelled = true;
      loadingTask.destroy().catch(() => {});
      container.removeEventListener("mouseup", onMouseUp);
      container.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", finishDrag);
      viewer.cleanup();
      // Release the document (runtime accepts null to clear; the .d.ts omits it).
      viewer.setDocument(null as unknown as Parameters<typeof viewer.setDocument>[0]);
      linkService.setDocument(null);
      viewerRef.current = null;
    };
  }, [fileUrl]);

  // Repaint when the anchors prop changes (the per-page handlers cover virtualization).
  useEffect(() => {
    highlightAnchors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchors]);

  return (
    <div className="pdf-reader-shell">
      <div className="pdf-reader-toolbar">
        <button
          type="button"
          className={`mode-tab${regionMode ? "" : " active"}`}
          onClick={() => setRegionMode(false)}
          title="Select text to quote"
        >
          <TextCursor size={14} />
          Text
        </button>
        <button
          type="button"
          className={`mode-tab${regionMode ? " active" : ""}`}
          onClick={() => setRegionMode(true)}
          title="Drag to mark a region (figure / formula / scan)"
        >
          <ScanLine size={14} />
          Region
        </button>
      </div>
      {/* PDFViewer requires its scroll container to be absolutely positioned, so it
          fills this relatively-positioned viewport. The inner `.pdfViewer` is the
          element PDFViewer appends `.page`s into. */}
      <div className="pdf-reader-viewport">
        <div ref={containerRef} className={`pdf-reader-canvas${regionMode ? " region-mode" : ""}`}>
          <div ref={viewerElRef} className="pdfViewer" />
        </div>
      </div>
    </div>
  );
}
