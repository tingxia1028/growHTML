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

// PDF surface adapter — one of the two OVERLAY readers. Renders a PDF with the
// OFFICIAL pdf.js `PDFViewer` (the `.pdfViewer` container, virtualized `.page`
// elements, each with a canvas + a selectable text layer) so PDFs can be
// annotated like HTML. Using the stock viewer (instead of a hand-rolled renderer)
// means pdf.js owns text-layer sizing/positioning + scaling — so text is actually
// mouse-selectable (a bare custom `.pdf-page` misses pdf_viewer.css's
// `--user-unit`/`--total-scale-factor`, collapsing span font-size to 0).
//   READ : select text → AnchorDraft { mode:"quote", kind:"pdf", page, quote, … }
//          OR rubber-band a region → AnchorDraft { mode:"region", kind:"pdf", rect }.
//   WRITE: paint pdf_selection anchors from the `anchors` prop — a text highlight
//          (match the quote in the text layer) or, when the anchor carries a rect,
//          a region box. Both hook the shared note card via applyHighlight.
export function PdfReader({ fileUrl, sourceId, anchors, onSelect }: PdfReaderProps) {
  // container = the absolutely-positioned scroll root PDFViewer requires; viewer =
  // the inner `.pdfViewer` div PDFViewer fills with pages.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<HTMLDivElement | null>(null);

  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const sourceIdRef = useRef(sourceId);
  sourceIdRef.current = sourceId;
  // Only the pdf_selection anchors are ours to paint; keep the live subset in a ref
  // so the post-render repaint always sees the latest.
  const anchorsRef = useRef(anchorsOfKind(anchors, "pdf_selection"));
  anchorsRef.current = anchorsOfKind(anchors, "pdf_selection");

  // Region (rubber-band) mode: while on, the text layer is click-through and a
  // drag draws a selection rectangle that becomes a pdf_selection region anchor.
  const [regionMode, setRegionMode] = useState(false);
  const regionModeRef = useRef(regionMode);
  regionModeRef.current = regionMode;

  // (Re)paint every pdf_selection anchor onto whichever pages are currently
  // rendered. Idempotent: clears its own marks first so repaints (page render,
  // anchor change, scroll) don't stack. Pages are virtualized, so anchors on
  // not-yet-rendered pages paint when their page later fires textlayerrendered.
  function highlightAnchors() {
    const viewer = viewerRef.current;
    if (!viewer) return;
    ensureAnnotationLayer(document);
    viewer.querySelectorAll(".pdf-anchor-hit").forEach((el) => el.classList.remove("pdf-anchor-hit"));
    viewer.querySelectorAll(".pdf-region-box").forEach((el) => el.remove());
    clearAnnotations(viewer);
    for (const anchor of anchorsRef.current) {
      const pageEl = viewer.querySelector(`.page[data-page-number="${anchor.page}"]`) as HTMLElement | null;
      if (!pageEl) continue;

      // Region anchor: draw a box at its normalized rect (no text to highlight).
      // Percent-sized so it tracks the page box across any rescale.
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

  // Build the official PDFViewer (once per fileUrl) + bind selection / region gestures.
  useEffect(() => {
    const container = containerRef.current;
    const viewer = viewerRef.current;
    if (!container || !viewer || !fileUrl) return;
    let cancelled = false;

    const eventBus = new EventBus();
    const linkService = new PDFLinkService({ eventBus });
    const pdfViewer = new PDFViewer({ container, viewer, eventBus, linkService });
    linkService.setViewer(pdfViewer);

    // Fit each page to the container width; 'page-width' is a dynamic value, so
    // pdf.js keeps it fit as the pane is resized.
    eventBus.on("pagesinit", () => {
      pdfViewer.currentScaleValue = "page-width";
    });
    // Pages (and their text layers) render lazily as they scroll into view —
    // (re)paint anchors each time one renders.
    eventBus.on("pagerendered", () => highlightAnchors());
    eventBus.on("textlayerrendered", () => highlightAnchors());

    const loadingTask = pdfjsLib.getDocument({ url: fileUrl });
    loadingTask.promise.then(
      (pdf) => {
        if (cancelled) return;
        pdfViewer.setDocument(pdf);
        linkService.setDocument(pdf, null);
      },
      () => {
        /* load error — leave the viewer empty */
      }
    );

    // —— Text selection → quote draft ——
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
      if (!pageEl || !viewer.contains(pageEl)) return;
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
    let dragPage: HTMLElement | null = null;
    let startX = 0;
    let startY = 0;
    let marquee: HTMLDivElement | null = null;

    const onMouseDown = (event: MouseEvent) => {
      if (!regionModeRef.current || event.button !== 0) return;
      const target = event.target as Element | null;
      const pageEl = target?.closest(".page") as HTMLElement | null;
      if (!pageEl || !viewer.contains(pageEl)) return;
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
      container.removeEventListener("mouseup", onMouseUp);
      container.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", finishDrag);
      loadingTask.destroy().catch(() => {});
      try {
        pdfViewer.setDocument(null as never);
      } catch {
        /* already torn down */
      }
    };
  }, [fileUrl]);

  // Repaint when the anchors prop changes.
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
      {/* The viewport is the relatively-positioned flex item; the container fills it
          absolutely (PDFViewer requires an absolutely-positioned scroll root). */}
      <div className="pdf-reader-viewport">
        <div ref={containerRef} className={`pdf-reader-canvas${regionMode ? " region-mode" : ""}`}>
          <div ref={viewerRef} className="pdfViewer" />
        </div>
      </div>
    </div>
  );
}
