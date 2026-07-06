import { useEffect, useRef, useState } from "react";
import { MoveHorizontal, ZoomIn, ZoomOut } from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";
import { EventBus, PDFLinkService, PDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs";
import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";
import {
  applyHighlight,
  applyPaintStyle,
  buildAnchorSlotHtml,
  buildNoteSlotHtml,
  clearAnnotations,
  ensureAnnotationLayer,
  type HighlightPayload,
  revealAnchorInDoc,
  setSelectedAnchorInDoc
} from "./annotationLayer";
import { MarkerOverlay, type MarkerItem } from "./markerOverlay";
import type { AnchorDraft } from "./focus/FocusContext";
import {
  collectAnchorRects,
  injectCssIntoRealm,
  type ReaderAnnotationAdapter
} from "./surfaces/readerAnnotationAdapter";
import { anchorsOfKind, type PaintAnchor, type SurfaceReaderProps } from "./surfaces/types";
import { registerSourceRealmDoc, unregisterSourceRealmDoc } from "./workspace/sourceRealmDoc";
import { isRealRegion, isRegionGesture, normalizeDragRect, placeRegionBox } from "./surfaces/overlay";
import { formatZoomPct, nextZoom } from "./surfaces/pdfZoom";
import { selectorFromPdfRange, spansForPdfQuote } from "./surfaces/pdfTextLayer";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

type PdfReaderProps = SurfaceReaderProps & {
  fileUrl: string;
  // The active source id — stamped onto emitted drafts.
  sourceId: string;
};

const CONTEXT = 32;

function annotationPayload(anchor: PaintAnchor, showBadge = true): HighlightPayload {
  const noteHtml = anchor.notePreviews?.map((preview) => preview.html).join("") || undefined;
  const fallbackCount = anchor.note ? 1 : 0;
  const noteCount = anchor.notePreviews ? anchor.notePreviews.length : fallbackCount;
  const noteTypes = anchor.notePreviews?.map((p) => p.contentType) ?? [];
  return { noteHtml, noteCount: showBadge ? noteCount : 0, noteTypes };
}

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
export function PdfReader({
  fileUrl,
  sourceId,
  anchors,
  revealAnchors,
  onSelect,
  onMarkerAction,
  activeAnchorId,
  revealSeq
}: PdfReaderProps) {
  // container = the absolutely-positioned scroll root PDFViewer requires; viewer =
  // the inner `.pdfViewer` div PDFViewer fills with pages.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<HTMLDivElement | null>(null);
  // The official PDFViewer instance + its eventBus, lifted to refs so the reveal
  // effect can scrollPageIntoView for anchors on virtualized (not-yet-rendered)
  // pages and re-reveal once that page's text layer renders.
  const pdfViewerRef = useRef<PDFViewer | null>(null);
  const eventBusRef = useRef<EventBus | null>(null);
  // The view-layer marker overlay, mounted on the (absolutely-positioned) canvas so
  // its chips escape the PDF.js text-layer transform. One per reader instance.
  const markerOverlayRef = useRef<MarkerOverlay | null>(null);
  // This reader's D1 ReaderAnnotationAdapter (built with the viewer in the mount
  // effect); the anchors-changed repaint routes through adapter.paint.
  const adapterRef = useRef<ReaderAnnotationAdapter | null>(null);

  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onMarkerActionRef = useRef(onMarkerAction);
  onMarkerActionRef.current = onMarkerAction;
  const sourceIdRef = useRef(sourceId);
  sourceIdRef.current = sourceId;
  // Only the pdf_selection anchors are ours to paint; keep the live subset in a ref
  // so the post-render repaint always sees the latest.
  const anchorsRef = useRef(anchorsOfKind(anchors, "pdf_selection"));
  anchorsRef.current = anchorsOfKind(anchors, "pdf_selection");
  const revealAnchorsRef = useRef(anchorsOfKind(revealAnchors ?? anchors, "pdf_selection"));
  revealAnchorsRef.current = anchorsOfKind(revealAnchors ?? anchors, "pdf_selection");

  // Live zoom scale (pdf.js `currentScale`, 1 = 100%) for the % indicator. null
  // until the first `scalechanging` fires (i.e. before the initial page-width fit),
  // so the indicator renders a placeholder rather than a bogus 0%. This is the ONE
  // bit of zoom state — it mirrors what pdf.js owns, it does not drive it: every
  // control writes to the PDFViewer and the indicator updates from the event it
  // dispatches back (which also covers re-fits on container resize). Per-session
  // only; never persisted to the vault.
  const [scale, setScale] = useState<number | null>(null);

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
    // One pair of D2 slot chips per anchor (keyed by data-sv-key on its painted
    // element(s) — the adapter measures first/last spans for the two slots).
    const markers: MarkerItem[] = [];
    for (const anchor of anchorsRef.current) {
      const pageEl = viewer.querySelector(`.page[data-page-number="${anchor.page}"]`) as HTMLElement | null;
      if (!pageEl) continue;

      // Region anchor: draw a box at its normalized rect (no text to highlight).
      // Percent-sized so it tracks the page box across any rescale.
      if (anchor.rect) {
        const box = document.createElement("div");
        box.className = "pdf-region-box";
        placeRegionBox(box, anchor.rect, anchor.note, anchor.id, annotationPayload(anchor));
        // D3a: tint the region box from the anchor's resolved layer style (the box CSS
        // reads --sv-anchor-color; the deco class is inert for a box but kept uniform).
        applyPaintStyle(box, anchor.style);
        pageEl.appendChild(box);
        markers.push({
          anchorId: anchor.id,
          anchorSlotHtml: buildAnchorSlotHtml(),
          noteSlotHtml: buildNoteSlotHtml(annotationPayload(anchor))
        });
        continue;
      }

      const textLayer = pageEl.querySelector(".textLayer");
      const quote = anchor.quote;
      if (!textLayer || !quote) continue;
      const matches = spansForPdfQuote(textLayer, {
        exact: quote,
        prefix: anchor.contextBefore ?? "",
        suffix: anchor.contextAfter ?? ""
      });
      matches.forEach((span, index) => {
        // Keep .pdf-anchor-hit for the visual; add the shared highlight + note
        // card (same layer the HTML reader and webview guest use).
        span.classList.add("pdf-anchor-hit");
        applyHighlight(span, anchor.note, anchor.id, annotationPayload(anchor, index === 0));
        // D3a: paint the span with the anchor's resolved layer color/decoration.
        applyPaintStyle(span, anchor.style);
      });
      if (matches.length)
        markers.push({
          anchorId: anchor.id,
          anchorSlotHtml: buildAnchorSlotHtml(),
          noteSlotHtml: buildNoteSlotHtml(annotationPayload(anchor)),
          // Cluster mini-list snippet (D2 same-line clustering).
          quote: anchor.quote
        });
    }
    markerOverlayRef.current?.setMarkers(markers);
  }

  function flashElement(el: Element & { scrollIntoView?: Element["scrollIntoView"] }) {
    try {
      el.scrollIntoView?.({ block: "center", inline: "nearest" });
    } catch {
      // no scrollIntoView in some test/realm environments
    }
    el.classList.add("sv-active");
    window.setTimeout(() => el.classList.remove("sv-active"), 1000);
  }

  function revealPdfAnchor(anchorId: string | undefined): boolean {
    const viewer = viewerRef.current;
    if (!viewer || !anchorId) return false;
    if (revealAnchorInDoc(viewer, anchorId)) return true;

    const target = revealAnchorsRef.current.find((anchor) => anchor.id === anchorId);
    if (!target?.page) return false;
    const pageEl = viewer.querySelector(`.page[data-page-number="${target.page}"]`) as HTMLElement | null;
    if (!pageEl) return false;

    if (target.rect) {
      flashElement(pageEl);
      return true;
    }

    if (target.quote) {
      const textLayer = pageEl.querySelector(".textLayer");
      const span = textLayer
        ? (spansForPdfQuote(textLayer, {
            exact: target.quote,
            prefix: target.contextBefore ?? "",
            suffix: target.contextAfter ?? ""
          })[0] as (HTMLElement & { scrollIntoView?: Element["scrollIntoView"] }) | undefined)
        : undefined;
      if (span) {
        flashElement(span);
        return true;
      }
    }

    flashElement(pageEl);
    return true;
  }

  // Build the official PDFViewer (once per fileUrl) + bind selection / region gestures.
  useEffect(() => {
    const container = containerRef.current;
    const viewer = viewerRef.current;
    if (!container || !viewer || !fileUrl) return;
    let cancelled = false;

    const eventBus = new EventBus();
    eventBusRef.current = eventBus;
    const linkService = new PDFLinkService({ eventBus });
    const pdfViewer = new PDFViewer({ container, viewer, eventBus, linkService });
    pdfViewerRef.current = pdfViewer;
    linkService.setViewer(pdfViewer);

    // This realm's D1 ReaderAnnotationAdapter: rects come from every data-sv-key
    // element in the viewer (a multi-span quote reports ALL its spans), layout
    // changes are the pdf.js signals (textlayerrendered + zoom, emitted below), and
    // paint/reveal delegate to the existing highlightAnchors/revealPdfAnchor.
    const layoutListeners = new Set<() => void>();
    const emitLayoutChange = () => {
      for (const listener of [...layoutListeners]) listener();
    };
    const adapter: ReaderAnnotationAdapter = {
      rectsFor: (anchorId) => collectAnchorRects(viewerRef.current, anchorId),
      onLayoutChange: (cb) => {
        layoutListeners.add(cb);
        return () => layoutListeners.delete(cb);
      },
      injectRealmCss: (css) => injectCssIntoRealm(document, css),
      paint: (paintList) => {
        anchorsRef.current = anchorsOfKind(paintList, "pdf_selection");
        highlightAnchors();
      },
      reveal: (anchorId) => revealPdfAnchor(anchorId)
    };
    adapterRef.current = adapter;

    // Mount the view-layer marker overlay on the pdf.js CONTENT layer, not the scroll
    // viewport. Long PDFs may have their first anchor several pages down; an overlay
    // attached to the viewport top scrolls away before those anchors enter view.
    const markerOverlay = new MarkerOverlay(viewer, {
      onAction: ({ anchorId, role }) => onMarkerActionRef.current?.(anchorId, role),
      adapter
    });
    markerOverlayRef.current = markerOverlay;
    // The PDF reader paints into the HOST document, so its realm IS the host document —
    // register it for the host controls' sourceId → realm-doc lookup (F-1 follow-up).
    registerSourceRealmDoc(sourceIdRef.current, document);

    // Fit each page to the container width; 'page-width' is a dynamic value, so
    // pdf.js keeps it fit as the pane is resized.
    eventBus.on("pagesinit", () => {
      pdfViewer.currentScaleValue = "page-width";
    });
    // Pages (and their text layers) render lazily as they scroll into view —
    // (re)paint anchors each time one renders. A zoom re-lays-out and re-renders
    // every visible page, so these same events fire after a rescale → highlights
    // and region boxes are repainted at the new scale (region boxes are percent-
    // sized so they track the page box regardless; text highlights re-match the
    // freshly-rebuilt text-layer spans). No zoom-specific repaint path needed.
    eventBus.on("pagerendered", () => highlightAnchors());
    eventBus.on("textlayerrendered", () => {
      highlightAnchors();
      // A freshly rendered text layer changes anchor geometry — the adapter's
      // layout signal repositions the overlay chips.
      emitLayoutChange();
    });
    // Keep the % indicator in sync with whatever scale pdf.js settles on — explicit
    // zoom, the initial page-width fit, AND automatic re-fits when the pane resizes
    // (page-width is dynamic, so resizing re-dispatches scalechanging).
    eventBus.on("scalechanging", (evt: { scale: number }) => {
      setScale(evt.scale);
      // Zoom re-lays out the pages; the adapter's layout signal nudges the marker
      // chips to the new geometry (the subsequent page re-render also repaints,
      // but this keeps them tight meanwhile).
      emitLayoutChange();
    });

    // Keep the PDF fitted when the Source Viewer pane or desktop window is resized.
    // Window dragging can report one stale intermediate width, so fit once on the
    // next frame and once again after layout has settled.
    const resizeFrames = new Set<number>();
    const queueFrame = (callback: FrameRequestCallback) => {
      const id = requestAnimationFrame((time) => {
        resizeFrames.delete(id);
        callback(time);
      });
      resizeFrames.add(id);
    };
    const fitToContainer = () => {
      queueFrame(() => {
        pdfViewer.currentScaleValue = "page-width";
        queueFrame(() => {
          pdfViewer.currentScaleValue = "page-width";
          emitLayoutChange();
        });
      });
    };
    const resizeObserver = new ResizeObserver(fitToContainer);
    resizeObserver.observe(container);
    resizeObserver.observe(container.closest(".pdf-reader-viewport") ?? container);
    resizeObserver.observe(container.closest(".reader-panel") ?? container);
    window.addEventListener("resize", fitToContainer);

    // —— Ctrl/Cmd + wheel zoom —— mirror the browser/native convention: a plain
    // wheel scrolls (let it through), but with the zoom modifier held it zooms and
    // we preventDefault so the page/container doesn't also scroll for that gesture.
    // Bound non-passive (addEventListener default here is passive:false via the
    // explicit option) so preventDefault is honored.
    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      const pdfViewer = pdfViewerRef.current;
      if (!pdfViewer) return;
      pdfViewer.currentScale = nextZoom(pdfViewer.currentScale, event.deltaY < 0 ? 1 : -1);
    };
    container.addEventListener("wheel", onWheel, { passive: false });

    // —— Alt-held crosshair (D4a) —— stamp data-alt on the canvas while Alt is held so
    // the page shows a crosshair cursor, signaling the explicit region-drag intent. Purely
    // cosmetic; the actual region/quote classification lives in onMouseDown (isRegionGesture).
    const syncAltCursor = (event: KeyboardEvent) => {
      if (event.key === "Alt") container.toggleAttribute("data-alt", event.type === "keydown");
    };
    const clearAltCursor = () => container.removeAttribute("data-alt");
    window.addEventListener("keydown", syncAltCursor);
    window.addEventListener("keyup", syncAltCursor);
    window.addEventListener("blur", clearAltCursor);

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
    // Modeless (D4a): a plain drag STARTING on text is a quote; an Alt-drag or a drag
    // starting off-text is a region (see onMouseDown). `regionDragActive` is set by a
    // region mousedown so this mouseup doesn't ALSO emit a stray quote for that drag.
    let regionDragActive = false;
    const onMouseUp = () => {
      if (regionDragActive) return; // a region gesture owns this pointer stroke
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
      const textLayer = pageEl.querySelector(".textLayer");
      const selector = textLayer ? selectorFromPdfRange(textLayer, range, CONTEXT) : null;

      const draft: AnchorDraft = {
        mode: "quote",
        sourceId: sourceIdRef.current,
        kind: "pdf",
        quote: selector?.exact ?? exact,
        prefix: selector?.prefix ?? "",
        suffix: selector?.suffix ?? "",
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
      regionDragActive = false; // fresh stroke — reclassify below
      if (event.button !== 0) return;
      const target = event.target as Element | null;
      const pageEl = target?.closest(".page") as HTMLElement | null;
      if (!pageEl || !viewer.contains(pageEl)) return;
      // Modeless region classification (D4a): Alt held = region (primary/explicit); a
      // gesture NOT starting on a `.textLayer` span = region (best-effort convenience,
      // guarded by isRealRegion in finishDrag). A plain drag on text stays a quote —
      // let the browser build the selection and onMouseUp emit the quote draft.
      const overText = !!target?.closest(".textLayer");
      if (!isRegionGesture(event, overText)) return; // plain text drag — quote path
      regionDragActive = true;
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
      // Release the pointer-stroke ownership so the NEXT plain click/selection emits a
      // quote again (reset regardless of whether this drag produced a region).
      const wasRegion = regionDragActive;
      regionDragActive = false;
      if (!dragPage || !marquee) return;
      const pageEl = dragPage;
      const rect = pageEl.getBoundingClientRect();
      const start = { x: startX, y: startY };
      const current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      marquee.remove();
      marquee = null;
      dragPage = null;
      if (!wasRegion || !isRealRegion(rect, start, current)) return; // ignore stray clicks
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
      container.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", syncAltCursor);
      window.removeEventListener("keyup", syncAltCursor);
      window.removeEventListener("blur", clearAltCursor);
      container.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", finishDrag);
      resizeObserver.disconnect();
      window.removeEventListener("resize", fitToContainer);
      resizeFrames.forEach((id) => cancelAnimationFrame(id));
      resizeFrames.clear();
      markerOverlay.destroy();
      unregisterSourceRealmDoc(sourceIdRef.current, document);
      layoutListeners.clear();
      if (markerOverlayRef.current === markerOverlay) markerOverlayRef.current = null;
      if (adapterRef.current === adapter) adapterRef.current = null;
      loadingTask.destroy().catch(() => {});
      try {
        pdfViewer.setDocument(null as never);
      } catch {
        /* already torn down */
      }
      if (pdfViewerRef.current === pdfViewer) pdfViewerRef.current = null;
      if (eventBusRef.current === eventBus) eventBusRef.current = null;
    };
  }, [fileUrl]);

  // Repaint when the anchors prop changes — through the adapter (the D1 paint
  // duty); before the viewer mounts there is no adapter and nothing to paint onto.
  useEffect(() => {
    if (adapterRef.current) adapterRef.current.paint(anchors);
    else highlightAnchors();
    // Re-apply the persistent blue "selected" highlight after a repaint clears it.
    setSelectedAnchorInDoc(viewerRef.current, activeAnchorId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchors]);

  // REVEAL: scroll the focused pdf_selection anchor into view via the one shared
  // helper (text hits + region boxes both carry data-sv-key in the host document).
  // If its page is virtualized (no painted element yet), scroll that page into view
  // first, then reveal again on the next textlayerrendered. Keyed on revealSeq so
  // re-selecting the same anchor re-fires. Prop-driven (no useFocus).
  useEffect(() => {
    // Paint/clear the persistent blue "selected" highlight on the focused anchor.
    setSelectedAnchorInDoc(viewerRef.current, activeAnchorId);
    if (!activeAnchorId) return;
    if (revealPdfAnchor(activeAnchorId)) return;
    const target = revealAnchorsRef.current.find((a) => a.id === activeAnchorId);
    const pdfViewer = pdfViewerRef.current;
    if (!target?.page || !pdfViewer) return;
    try {
      pdfViewer.scrollPageIntoView({ pageNumber: target.page });
    } catch {
      // viewer not ready (no document yet) — ignore.
    }
    // Reveal once the page's text layer (and our repaint) has rendered.
    const eventBus = eventBusRef.current;
    if (!eventBus) return;
    const onRendered = () => {
      setSelectedAnchorInDoc(viewerRef.current, activeAnchorId);
      if (revealPdfAnchor(activeAnchorId)) {
        eventBus.off("textlayerrendered", onRendered);
      }
    };
    eventBus.on("textlayerrendered", onRendered);
    return () => eventBus.off("textlayerrendered", onRendered);
  }, [activeAnchorId, revealSeq]);

  // Zoom commands — each just writes to the PDFViewer; the indicator follows via the
  // scalechanging event above (single source of truth). `currentScale` is numeric
  // (explicit, fixed zoom); `currentScaleValue = "page-width"` is the dynamic fit
  // value that stays responsive on pane resize. No-ops until the document is set.
  const zoomBy = (direction: 1 | -1) => {
    const pdfViewer = pdfViewerRef.current;
    if (!pdfViewer) return;
    pdfViewer.currentScale = nextZoom(pdfViewer.currentScale, direction);
  };
  const fitWidth = () => {
    const pdfViewer = pdfViewerRef.current;
    if (!pdfViewer) return;
    pdfViewer.currentScaleValue = "page-width";
  };

  return (
    <div className="pdf-reader-shell">
      <div className="pdf-reader-toolbar">
        {/* Modeless region selection (D4a): no Text|Region mode tabs. A plain drag on
            text quotes; Alt+drag (or a drag starting off-text) marks a region. The zoom
            cluster is the only toolbar control; Ctrl/Cmd + wheel mirrors the +/- buttons. */}
        <div className="pdf-zoom-controls">
          <button type="button" className="pdf-zoom-button" onClick={() => zoomBy(-1)} title="Zoom out">
            <ZoomOut size={14} />
          </button>
          <span className="pdf-zoom-indicator" title="Current zoom">
            {scale == null ? "—" : formatZoomPct(scale)}
          </span>
          <button type="button" className="pdf-zoom-button" onClick={() => zoomBy(1)} title="Zoom in">
            <ZoomIn size={14} />
          </button>
          <button type="button" className="pdf-zoom-button" onClick={fitWidth} title="Fit width">
            <MoveHorizontal size={14} />
          </button>
        </div>
      </div>
      {/* The viewport is the relatively-positioned flex item; the container fills it
          absolutely (PDFViewer requires an absolutely-positioned scroll root). */}
      <div className="pdf-reader-viewport">
        <div ref={containerRef} className="pdf-reader-canvas">
          <div ref={viewerRef} className="pdfViewer" />
        </div>
      </div>
    </div>
  );
}
