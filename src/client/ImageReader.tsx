import { useEffect, useRef, useState } from "react";
import { applyHighlight } from "./annotationLayer";

// An image has no text to select, so its only annotation is a geometric REGION:
// the user rubber-bands a rectangle over the image → a normalized rect [x,y,w,h]
// (0..1) → an image_region anchor. Rendered as a host-page <img> (not the native
// `file` iframe) so an overlay can be drawn on top of it. Stored regions are drawn
// back as boxes that share the same floating note card as every other surface.

export type ImageRegion = { rect: [number, number, number, number] };
export type ImageAnchorMark = { id?: string; rect: [number, number, number, number]; note?: string };

type ImageReaderProps = {
  src: string;
  anchors: ImageAnchorMark[];
  onRegion: (region: ImageRegion) => void;
};

export function ImageReader({ src, anchors, onRegion }: ImageReaderProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const onRegionRef = useRef(onRegion);
  onRegionRef.current = onRegion;
  const [drag, setDrag] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

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
      if (!r || r.width === 0 || r.height === 0) return;
      const curX = Math.max(0, Math.min(r.width, up.clientX - r.left));
      const curY = Math.max(0, Math.min(r.height, up.clientY - r.top));
      const w = Math.abs(curX - start.x);
      const h = Math.abs(curY - start.y);
      if (w < 6 || h < 6) return; // ignore stray clicks
      const norm: [number, number, number, number] = [
        Math.min(start.x, curX) / r.width,
        Math.min(start.y, curY) / r.height,
        w / r.width,
        h / r.height
      ];
      onRegionRef.current({ rect: norm });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  return (
    <div className="image-reader">
      <div className="image-reader-stage" ref={frameRef} onMouseDown={onMouseDown}>
        <img className="image-reader-img" src={src} alt="" draggable={false} />
        {anchors.map((anchor, index) => (
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
function ImageRegionBox({ anchor }: { anchor: ImageAnchorMark }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (ref.current) applyHighlight(ref.current, anchor.note ?? "", anchor.id);
  }, [anchor.note, anchor.id]);
  const [x, y, w, h] = anchor.rect;
  return (
    <div
      ref={ref}
      className="image-region-box"
      data-anchor-id={anchor.id}
      style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }}
    />
  );
}
