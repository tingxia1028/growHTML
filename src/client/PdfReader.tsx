import { useEffect, useRef, useState } from "react";
import { ScanLine, TextCursor } from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";
import { applyHighlight, clearAnnotations, ensureAnnotationLayer } from "./annotationLayer";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export type PdfSelection = { page: number; exact: string; prefix: string; suffix: string };
// A geometric region marked over a page: normalized [x, y, w, h] (0..1).
export type PdfRegion = { page: number; rect: [number, number, number, number] };
export type PdfAnchorMark = {
  id?: string;
  page: number;
  quote: string;
  note?: string;
  // When present, this anchor is a region (figure/scan) and is drawn as a box
  // rather than a text highlight.
  rect?: [number, number, number, number];
};

type PdfReaderProps = {
  fileUrl: string;
  anchors: PdfAnchorMark[];
  onSelection: (selection: PdfSelection) => void;
  /** Called when the user rubber-bands a region (Region mode). */
  onRegion?: (region: PdfRegion) => void;
};

const CONTEXT = 32;

// Renders a PDF with PDF.js (canvas + selectable text layer) so PDFs can be
// annotated like HTML: select text → page + TextQuoteSelector → pdf_selection
// anchor; stored anchors are highlighted by matching their quote in the layer.
export function PdfReader({ fileUrl, anchors, onSelection, onRegion }: PdfReaderProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onSelectionRef = useRef(onSelection);
  onSelectionRef.current = onSelection;
  const onRegionRef = useRef(onRegion);
  onRegionRef.current = onRegion;
  const anchorsRef = useRef(anchors);
  anchorsRef.current = anchors;

  // Region (rubber-band) mode: while on, the text layer is click-through and a
  // drag draws a selection rectangle that becomes an image-style region anchor.
  const [regionMode, setRegionMode] = useState(false);
  const regionModeRef = useRef(regionMode);
  regionModeRef.current = regionMode;

  function highlightAnchors() {
    const container = containerRef.current;
    if (!container) return;
    ensureAnnotationLayer(document);
    container.querySelectorAll(".pdf-anchor-hit").forEach((el) => el.classList.remove("pdf-anchor-hit"));
    container.querySelectorAll(".pdf-region-box").forEach((el) => el.remove());
    clearAnnotations(container);
    for (const anchor of anchorsRef.current) {
      const pageEl = container.querySelector(`.pdf-page[data-page="${anchor.page}"]`) as HTMLElement | null;
      if (!pageEl) continue;

      // Region anchor: draw a box at its normalized rect (no text to highlight).
      if (anchor.rect) {
        const [x, y, w, h] = anchor.rect;
        const box = document.createElement("div");
        box.className = "pdf-region-box";
        box.style.left = `${x * 100}%`;
        box.style.top = `${y * 100}%`;
        box.style.width = `${w * 100}%`;
        box.style.height = `${h * 100}%`;
        if (anchor.id) box.setAttribute("data-anchor-id", anchor.id);
        applyHighlight(box, anchor.note ?? "", anchor.id);
        pageEl.appendChild(box);
        continue;
      }

      const textLayer = pageEl.querySelector(".textLayer");
      if (!textLayer) continue;
      for (const span of Array.from(textLayer.querySelectorAll("span"))) {
        const text = span.textContent ?? "";
        if (text && anchor.quote.includes(text.trim()) && text.trim().length > 1) {
          // Keep .pdf-anchor-hit for the visual; add the shared highlight + note
          // card (same layer the HTML reader and webview guest use).
          span.classList.add("pdf-anchor-hit");
          applyHighlight(span, anchor.note ?? "", anchor.id);
        }
      }
    }
  }

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container || !fileUrl) return;
    container.innerHTML = "";

    void (async () => {
      const pdf = await pdfjsLib.getDocument({ url: fileUrl }).promise;
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
        if (cancelled) return;
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1.3 });

        const pageDiv = document.createElement("div");
        pageDiv.className = "pdf-page";
        pageDiv.dataset.page = String(pageNum);
        pageDiv.style.width = `${viewport.width}px`;
        pageDiv.style.height = `${viewport.height}px`;

        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const context = canvas.getContext("2d");
        pageDiv.appendChild(canvas);

        const textLayerDiv = document.createElement("div");
        textLayerDiv.className = "textLayer";
        pageDiv.appendChild(textLayerDiv);
        container.appendChild(pageDiv);

        if (context) await page.render({ canvasContext: context, viewport, canvas }).promise;
        const textContent = await page.getTextContent();
        const textLayer = new pdfjsLib.TextLayer({ textContentSource: textContent, container: textLayerDiv, viewport });
        await textLayer.render();
      }
      if (!cancelled) highlightAnchors();
    })();

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
      const pageEl = startEl?.closest(".pdf-page") as HTMLElement | null;
      const page = pageEl ? Number(pageEl.dataset.page) : 1;
      const pageText = (pageEl?.querySelector(".textLayer")?.textContent ?? "").replace(/\s+/g, " ");
      const index = pageText.indexOf(exact);
      const prefix = index >= 0 ? pageText.slice(Math.max(0, index - CONTEXT), index) : "";
      const suffix = index >= 0 ? pageText.slice(index + exact.length, index + exact.length + CONTEXT) : "";

      onSelectionRef.current({ page, exact, prefix, suffix });
    };
    container.addEventListener("mouseup", onMouseUp);

    // —— Region (rubber-band) gesture ——
    // While in region mode, dragging on a page draws a marquee; on release the
    // normalized rect (0..1 within that page) + page number become a region.
    let dragPage: HTMLElement | null = null;
    let startX = 0;
    let startY = 0;
    let marquee: HTMLDivElement | null = null;

    const pageMetrics = (pageEl: HTMLElement) => {
      const rect = pageEl.getBoundingClientRect();
      return rect;
    };

    const onMouseDown = (event: MouseEvent) => {
      if (!regionModeRef.current || event.button !== 0) return;
      const target = event.target as Element | null;
      const pageEl = target?.closest(".pdf-page") as HTMLElement | null;
      if (!pageEl) return;
      event.preventDefault();
      dragPage = pageEl;
      const rect = pageMetrics(pageEl);
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
      const rect = pageMetrics(dragPage);
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
      const rect = pageMetrics(pageEl);
      const curX = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
      const curY = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
      const x0 = Math.min(startX, curX);
      const y0 = Math.min(startY, curY);
      const w = Math.abs(curX - startX);
      const h = Math.abs(curY - startY);
      marquee.remove();
      marquee = null;
      dragPage = null;
      // Ignore stray clicks (too small to be a real region).
      if (w < 6 || h < 6 || rect.width === 0 || rect.height === 0) return;
      const page = Number(pageEl.dataset.page) || 1;
      const norm: [number, number, number, number] = [
        x0 / rect.width,
        y0 / rect.height,
        w / rect.width,
        h / rect.height
      ];
      onRegionRef.current?.({ page, rect: norm });
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
    };
  }, [fileUrl]);

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
      <div
        ref={containerRef}
        className={`pdf-reader-canvas${regionMode ? " region-mode" : ""}`}
      />
    </div>
  );
}
