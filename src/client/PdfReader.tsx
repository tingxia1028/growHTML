import { useEffect, useRef } from "react";
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";
import { applyHighlight, clearAnnotations, ensureAnnotationLayer } from "./annotationLayer";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export type PdfSelection = { page: number; exact: string; prefix: string; suffix: string };
export type PdfAnchorMark = { id?: string; page: number; quote: string; note?: string };

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

  function highlightAnchors() {
    const container = containerRef.current;
    if (!container) return;
    ensureAnnotationLayer(document);
    container.querySelectorAll(".pdf-anchor-hit").forEach((el) => el.classList.remove("pdf-anchor-hit"));
    clearAnnotations(container);
    for (const anchor of anchorsRef.current) {
      const pageEl = container.querySelector(`.pdf-page[data-page="${anchor.page}"] .textLayer`);
      if (!pageEl) continue;
      for (const span of Array.from(pageEl.querySelectorAll("span"))) {
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

    return () => {
      cancelled = true;
      container.removeEventListener("mouseup", onMouseUp);
    };
  }, [fileUrl]);

  useEffect(() => {
    highlightAnchors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchors]);

  return <div ref={containerRef} className="pdf-reader-canvas" />;
}
