import { useEffect, useRef, useState } from "react";
import { applyHighlight } from "./annotationLayer";
import type { AnchorDraft } from "./focus/FocusContext";
import { anchorsOfKind, type PaintAnchor, type SurfaceReaderProps } from "./surfaces/types";
import { isRealRegion, normalizeDragRect, type NormalizedRect } from "./surfaces/overlay";

type ImageReaderProps = SurfaceReaderProps & {
  src: string;
  // The active source id — stamped onto emitted drafts.
  sourceId: string;
};

// Image surface adapter — the other OVERLAY reader. An image has no text to select,
// so its only annotation is a geometric REGION: the user rubber-bands a rectangle
// over the image → AnchorDraft { mode:"region", kind:"image", rect } (READ).
// Rendered as a host-page <img> (not the native `file` iframe) so an overlay can be
// drawn on top of it. Stored image_region anchors from the `anchors` prop are drawn
// back as boxes that share the same floating note card as every other surface
// (WRITE). It uses the shared overlay rubber-band helpers.
export function ImageReader({ src, sourceId, anchors, onSelect }: ImageReaderProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const sourceIdRef = useRef(sourceId);
  sourceIdRef.current = sourceId;
  const [drag, setDrag] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const regions = anchorsOfKind(anchors, "image_region");

  function metrics() {
    return frameRef.current?.getBoundingClientRect() ?? null;
  }

  // Bind the move/up listeners synchronously on mousedown (not via an effect) so the
  // gesture is captured even when the whole drag arrives in one tick (e.g. driven by
  // a test). Listeners live on window so the drag survives leaving the image.
  function onMouseDown(event: React.MouseEvent) {
    if (event.button !== 0) return;
    const rect = metrics();
    if (!rect) return;
    event.preventDefault();
    const start = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    setDrag({ x: start.x, y: start.y, w: 0, h: 0 });

    const onMove = (move: MouseEvent) => {
      const r = metrics();
      if (!r) return;
      const curX = Math.max(0, Math.min(r.width, move.clientX - r.left));
      const curY = Math.max(0, Math.min(r.height, move.clientY - r.top));
      setDrag({
        x: Math.min(start.x, curX),
        y: Math.min(start.y, curY),
        w: Math.abs(curX - start.x),
        h: Math.abs(curY - start.y)
      });
    };
    const onUp = (up: MouseEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setDrag(null);
      const r = metrics();
      if (!r) return;
      const current = { x: up.clientX - r.left, y: up.clientY - r.top };
      if (!isRealRegion(r, start, current)) return; // ignore stray clicks
      const draft: AnchorDraft = {
        mode: "region",
        sourceId: sourceIdRef.current,
        kind: "image",
        rect: normalizeDragRect(r, start, current)
      };
      onSelectRef.current(draft);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  return (
    <div className="image-reader">
      <div className="image-reader-stage" ref={frameRef} onMouseDown={onMouseDown}>
        <img className="image-reader-img" src={src} alt="" draggable={false} />
        {regions.map((anchor, index) => (
          <ImageRegionBox key={anchor.id ?? index} anchor={anchor} />
        ))}
        {drag ? (
          <div
            className="image-region-marquee"
            style={{ left: drag.x, top: drag.y, width: drag.w, height: drag.h }}
          />
        ) : null}
      </div>
    </div>
  );
}

// A saved region box. Wires the shared note card via applyHighlight so hovering it
// shows its note exactly like every other annotated surface.
function ImageRegionBox({ anchor }: { anchor: PaintAnchor }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (ref.current) applyHighlight(ref.current, anchor.note, anchor.id);
  }, [anchor.note, anchor.id]);
  const [x, y, w, h] = (anchor.rect ?? [0, 0, 0, 0]) as NormalizedRect;
  return (
    <div
      ref={ref}
      className="image-region-box"
      data-anchor-id={anchor.id}
      style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }}
    />
  );
}
