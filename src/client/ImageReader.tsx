import { useEffect, useRef, useState } from "react";
import {
  applyHighlight,
  buildAnchorSlotHtml,
  buildNoteSlotHtml,
  ensureAnnotationLayer,
  type HighlightPayload,
  revealAnchorInDoc,
  setSelectedAnchorInDoc
} from "./annotationLayer";
import { MarkerOverlay } from "./markerOverlay";
import type { AnchorDraft } from "./focus/FocusContext";
import { createDomRealmAdapter, type ReaderAnnotationAdapter } from "./surfaces/readerAnnotationAdapter";
import { anchorsOfKind, type PaintAnchor, type SurfaceReaderProps } from "./surfaces/types";
import { registerSourceRealmDoc, unregisterSourceRealmDoc } from "./workspace/sourceRealmDoc";
import { isRealRegion, normalizeDragRect, type NormalizedRect } from "./surfaces/overlay";

type ImageReaderProps = SurfaceReaderProps & {
  src: string;
  // The active source id — stamped onto emitted drafts.
  sourceId: string;
};

function annotationPayload(anchor: PaintAnchor): HighlightPayload {
  const noteHtml = anchor.notePreviews?.map((preview) => preview.html).join("") || undefined;
  const fallbackCount = anchor.note ? 1 : 0;
  const noteCount = anchor.notePreviews ? anchor.notePreviews.length : fallbackCount;
  const noteTypes = anchor.notePreviews?.map((p) => p.contentType) ?? [];
  return { noteHtml, noteCount, noteTypes };
}

// Image surface adapter — the other OVERLAY reader. An image has no text to select,
// so its only annotation is a geometric REGION: the user rubber-bands a rectangle
// over the image → AnchorDraft { mode:"region", kind:"image", rect } (READ).
// Rendered as a host-page <img> (not the native `file` iframe) so an overlay can be
// drawn on top of it. Stored image_region anchors from the `anchors` prop are drawn
// back as boxes that share the same floating note card as every other surface
// (WRITE). It uses the shared overlay rubber-band helpers.
export function ImageReader({ src, sourceId, anchors, onSelect, onMarkerAction, activeAnchorId, revealSeq }: ImageReaderProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  // The view-layer marker overlay, mounted on the (position:relative) stage so each
  // region's chip sits in stage coordinate space, uniform with the PDF reader; plus
  // this reader's D1 ReaderAnnotationAdapter (a region is one box, so first=last).
  const markerOverlayRef = useRef<MarkerOverlay | null>(null);
  const adapterRef = useRef<ReaderAnnotationAdapter | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onMarkerActionRef = useRef(onMarkerAction);
  onMarkerActionRef.current = onMarkerAction;
  const sourceIdRef = useRef(sourceId);
  sourceIdRef.current = sourceId;
  const [drag, setDrag] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const regions = anchorsOfKind(anchors, "image_region");

  function metrics() {
    return frameRef.current?.getBoundingClientRect() ?? null;
  }

  // Mount this reader's D1 surface — adapter + MarkerOverlay — on the stage for the
  // reader's lifetime. The adapter's default onLayoutChange (ResizeObserver +
  // capture scroll) handles image reflow; region boxes are React-rendered, so the
  // adapter's paint duty is driving the overlay chips (boxes get their data-sv-key
  // via applyHighlight on mount). The card lives in the HOST document — ensure the
  // shared annotation layer (CSS + #sv-note-card) is wired there, like PDF does.
  useEffect(() => {
    const stage = frameRef.current;
    if (!stage) return;
    ensureAnnotationLayer(document);
    const adapter = createDomRealmAdapter({
      root: () => frameRef.current,
      paint: (paintList) => {
        markerOverlayRef.current?.setMarkers(
          anchorsOfKind(paintList, "image_region").map((anchor) => ({
            anchorId: anchor.id,
            // Single box ⇒ first === last: both D2 slots hang off the same rect.
            anchorSlotHtml: buildAnchorSlotHtml(),
            noteSlotHtml: buildNoteSlotHtml(annotationPayload(anchor)),
            // A region has no quote — the cluster mini-list rows fall back to the id.
            quote: anchor.quote
          }))
        );
      }
    });
    adapterRef.current = adapter;
    const overlay = new MarkerOverlay(stage, {
      onAction: ({ anchorId, role }) => onMarkerActionRef.current?.(anchorId, role),
      adapter
    });
    markerOverlayRef.current = overlay;
    // The image reader paints into the HOST document — register the host document as this
    // source's realm for the host controls' sourceId → realm-doc lookup (F-1 follow-up).
    registerSourceRealmDoc(sourceIdRef.current, document);
    return () => {
      overlay.destroy();
      unregisterSourceRealmDoc(sourceIdRef.current, document);
      if (markerOverlayRef.current === overlay) markerOverlayRef.current = null;
      if (adapterRef.current === adapter) adapterRef.current = null;
    };
  }, []);

  // Drive the overlay chips from the current regions through the adapter's paint.
  // ImageRegionBox paints the highlight (data-sv-key) on mount; the chip then finds
  // it by that key.
  useEffect(() => {
    adapterRef.current?.paint(anchors);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchors]);

  // REVEAL: scroll the focused region box into view (+ flash) via the one shared
  // helper — each ImageRegionBox carries data-sv-key (applyHighlight). Keyed on
  // revealSeq so re-selecting the same region re-fires. Prop-driven (no useFocus).
  useEffect(() => {
    setSelectedAnchorInDoc(frameRef.current, activeAnchorId);
    if (activeAnchorId) revealAnchorInDoc(frameRef.current, activeAnchorId);
  }, [activeAnchorId, revealSeq]);

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
    if (ref.current) applyHighlight(ref.current, anchor.note, anchor.id, annotationPayload(anchor));
  }, [anchor]);
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
