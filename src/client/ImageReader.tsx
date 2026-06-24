import { useEffect, useRef, useState } from "react";
import { applyHighlight, clearAnnotations, ensureAnnotationLayer } from "./annotationLayer";
import { isMeaningfulRegion, normalizeRect, type NormRect } from "./regionSelect";

export type ImageAnchorMark = { id?: string; rect: NormRect; note?: string };

type ImageReaderProps = {
  fileUrl: string;
  anchors: ImageAnchorMark[];
  onRegion: (rect: NormRect) => void;
};

type LiveRect = { left: number; top: number; width: number; height: number } | null;

// Renders an image and lets you draw a rectangular region on it; the region is
// stored as a normalized rect (resolution-independent) → an image_region anchor.
// Stored regions are drawn as boxes that reuse the SAME shared note card the HTML
// reader and PDF reader use (decoupled annotation presentation layer).
export function ImageReader({ fileUrl, anchors, onRegion }: ImageReaderProps) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const boxesRef = useRef<HTMLDivElement | null>(null);
  const [live, setLive] = useState<LiveRect>(null);

  // Paint the stored regions as positioned boxes (percentages so they track any
  // rendered size), wiring each into the shared hover card via applyHighlight.
  useEffect(() => {
    const layer = boxesRef.current;
    if (!layer) return;
    ensureAnnotationLayer(document);
    clearAnnotations(layer);
    layer.innerHTML = "";
    for (const anchor of anchors) {
      const box = document.createElement("div");
      box.className = "sv-image-region";
      box.style.left = `${anchor.rect[0] * 100}%`;
      box.style.top = `${anchor.rect[1] * 100}%`;
      box.style.width = `${anchor.rect[2] * 100}%`;
      box.style.height = `${anchor.rect[3] * 100}%`;
      applyHighlight(box, anchor.note ?? "", anchor.id);
      layer.appendChild(box);
    }
  }, [anchors, fileUrl]);

  function pointerToImage(event: React.MouseEvent) {
    const img = imgRef.current;
    if (!img) return null;
    const rect = img.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top, width: rect.width, height: rect.height };
  }

  function onMouseDown(event: React.MouseEvent) {
    // A mousedown on an existing region is a card interaction, not a new drag.
    if ((event.target as Element)?.closest?.(".sv-image-region")) return;
    const start = pointerToImage(event);
    if (!start) return;
    event.preventDefault();
    const startX = start.x;
    const startY = start.y;

    const move = (e: MouseEvent) => {
      const img = imgRef.current;
      if (!img) return;
      const r = img.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      setLive({
        left: Math.min(startX, x),
        top: Math.min(startY, y),
        width: Math.abs(x - startX),
        height: Math.abs(y - startY)
      });
    };
    const up = (e: MouseEvent) => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      setLive(null);
      const img = imgRef.current;
      if (!img) return;
      const r = img.getBoundingClientRect();
      const rect = normalizeRect(startX, startY, e.clientX - r.left, e.clientY - r.top, r.width, r.height);
      if (isMeaningfulRegion(rect)) onRegion(rect);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }

  return (
    <div className="image-reader">
      <div className="image-reader-stage" onMouseDown={onMouseDown}>
        <img ref={imgRef} src={fileUrl} alt="" draggable={false} />
        <div ref={boxesRef} className="image-region-layer" />
        {live ? (
          <div
            className="image-region-live"
            style={{ left: live.left, top: live.top, width: live.width, height: live.height }}
          />
        ) : null}
      </div>
      <p className="image-reader-hint">Drag on the image to annotate a region.</p>
    </div>
  );
}
