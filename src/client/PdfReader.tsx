import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";
import { applyHighlight, clearAnnotations, ensureAnnotationLayer } from "./annotationLayer";
import { denormalizeRect, isMeaningfulRegion, normalizeRect, type NormRect } from "./regionSelect";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export type PdfSelection = { page: number; exact: string; prefix: string; suffix: string; rect?: NormRect };
export type PdfAnchorMark = { id?: string; page: number; quote: string; note?: string; rect?: NormRect };

type PdfReaderProps = {
  fileUrl: string;
  anchors: PdfAnchorMark[];
  onSelection: (selection: PdfSelection) => void;
};

const CONTEXT = 32;

// Renders a PDF with PDF.js (canvas + selectable text layer) so PDFs can be
// annotated like HTML: select text → page + TextQuoteSelector → pdf_selection
// anchor; stored anchors are highlighted by matching their quote in the layer.
export function PdfReader({ fileUrl, anchors, onSelection }: PdfReaderProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onSelectionRef = useRef(onSelection);
  onSelectionRef.current = onSelection;
  const anchorsRef = useRef(anchors);
  anchorsRef.current = anchors;
  // Region mode: drag a box on a figure (no selectable text) → a rect-only
  // pdf_selection anchor. The reliable route for images/figures inside a PDF.
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
      const pageDiv = container.querySelector<HTMLElement>(`.pdf-page[data-page="${anchor.page}"]`);
      const pageEl = pageDiv?.querySelector(".textLayer");
      let matchedText = false;
      if (pageEl && anchor.quote) {
        for (const span of Array.from(pageEl.querySelectorAll("span"))) {
          const text = span.textContent ?? "";
          if (text && anchor.quote.includes(text.trim()) && text.trim().length > 1) {
            // Keep .pdf-anchor-hit for the visual; add the shared highlight + note
            // card (same layer the HTML reader and webview guest use).
            span.classList.add("pdf-anchor-hit");
            applyHighlight(span, anchor.note ?? "", anchor.id);
            matchedText = true;
          }
        }
      }
      // Geometric fallback: if the text couldn't be re-found (or this is a
      // figure anchor with no text), draw the stored rect as a box. This is the
      // "more reliable route" — a box doesn't depend on the text layer matching.
      if (!matchedText && anchor.rect && pageDiv) {
        const box = document.createElement("div");
        box.className = "pdf-region-box";
        const px = denormalizeRect(anchor.rect, pageDiv.clientWidth, pageDiv.clientHeight);
        box.style.left = `${px.left}px`;
        box.style.top = `${px.top}px`;
        box.style.width = `${px.width}px`;
        box.style.height = `${px.height}px`;
        applyHighlight(box, anchor.note ?? "", anchor.id);
        pageDiv.appendChild(box);
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
        pageDiv.style.position = "relative";
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
      if (regionModeRef.current) return; // region drags don't make a text selection
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

      // Hybrid: also capture the selection's geometric box (normalized to the
      // page) so the anchor can be re-found by rect if the text match fails.
      let rect: NormRect | undefined;
      const pageRect = pageEl?.getBoundingClientRect();
      if (pageRect && pageRect.width > 0 && pageRect.height > 0) {
        const sel = range.getBoundingClientRect();
        rect = normalizeRect(
          sel.left - pageRect.left,
          sel.top - pageRect.top,
          sel.right - pageRect.left,
          sel.bottom - pageRect.top,
          pageRect.width,
          pageRect.height
        );
      }

      onSelectionRef.current({ page, exact, prefix, suffix, rect });
    };
    container.addEventListener("mouseup", onMouseUp);

    // Region drag: only active while regionMode is on. Drag a box over a page →
    // normalized rect → rect-only selection (empty quote).
    const onMouseDown = (event: MouseEvent) => {
      if (!regionModeRef.current) return;
      const pageDiv = (event.target as Element)?.closest?.(".pdf-page") as HTMLElement | null;
      if (!pageDiv || !container.contains(pageDiv)) return;
      event.preventDefault();
      const pageRect = pageDiv.getBoundingClientRect();
      const startX = event.clientX - pageRect.left;
      const startY = event.clientY - pageRect.top;
      const liveBox = document.createElement("div");
      liveBox.className = "pdf-region-live";
      liveBox.style.left = `${startX}px`;
      liveBox.style.top = `${startY}px`;
      pageDiv.appendChild(liveBox);

      const move = (e: MouseEvent) => {
        const x = e.clientX - pageRect.left;
        const y = e.clientY - pageRect.top;
        liveBox.style.left = `${Math.min(startX, x)}px`;
        liveBox.style.top = `${Math.min(startY, y)}px`;
        liveBox.style.width = `${Math.abs(x - startX)}px`;
        liveBox.style.height = `${Math.abs(y - startY)}px`;
      };
      const up = (e: MouseEvent) => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        liveBox.remove();
        const rect = normalizeRect(
          startX,
          startY,
          e.clientX - pageRect.left,
          e.clientY - pageRect.top,
          pageRect.width,
          pageRect.height
        );
        if (isMeaningfulRegion(rect)) {
          const page = Number(pageDiv.dataset.page) || 1;
          onSelectionRef.current({ page, exact: "", prefix: "", suffix: "", rect });
        }
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    };
    container.addEventListener("mousedown", onMouseDown);

    return () => {
      cancelled = true;
      container.removeEventListener("mouseup", onMouseUp);
      container.removeEventListener("mousedown", onMouseDown);
    };
  }, [fileUrl]);

  useEffect(() => {
    highlightAnchors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchors]);

  return (
    <div className="pdf-reader-wrap">
      <div className="pdf-reader-toolbar">
        <button
          type="button"
          className={`pdf-region-toggle${regionMode ? " is-active" : ""}`}
          onClick={() => setRegionMode((on) => !on)}
          title="Region mode: drag a box on a figure to annotate it (no text needed)"
        >
          {regionMode ? "Region: on" : "Region: off"}
        </button>
      </div>
      <div ref={containerRef} className={`pdf-reader-canvas${regionMode ? " region-mode" : ""}`} />
    </div>
  );
}
