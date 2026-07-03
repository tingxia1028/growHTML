// View-layer anchor-marker overlay — framework-free, works in the app document, the
// reader iframe, and (potentially) the injected guest realm.
//
// WHY a separate overlay instead of injecting the marker chip into the annotated
// element: for PDF the anchor is a PDF.js `.textLayer` span scaled by a nested
// `transform: scale()`, so a child chip renders tiny (~6px) and inherits
// `color:transparent`. The correct approach (how PDF.js's own annotationLayer and
// Hypothesis work) is a SEPARATE overlay layer — a sibling of the transformed
// content, positioned in overlay/page coordinate space from each anchor's live rect,
// re-laid-out on zoom/scroll. Fixed CSS size, uniform for HTML / PDF / image.
//
// The overlay div is appended to the reader's positioned scroll/content container
// (`hostEl`); each chip is an absolutely-positioned `.sv-anchor-markers` whose
// left/top is computed from `rectToOverlayLocal(rects.first, overlayRect)`. The
// anchor's live rects come from the reader's D1 ReaderAnnotationAdapter
// (`adapter.rectsFor` — first/last/all; see surfaces/readerAnnotationAdapter.ts),
// falling back to the shared `[data-sv-key="…"]` collector. If the anchor is
// virtualized out (e.g. a PDF page not rendered), the chip hides itself.

import { rectToOverlayLocal, type MarkerRole } from "./annotationLayer";
import {
  collectAnchorRects,
  observeDomLayout,
  type AnchorRects,
  type AnnotationRectSource
} from "./surfaces/readerAnnotationAdapter";

export interface MarkerItem {
  anchorId: string;
  glyphHtml: string;
}

export type MarkerAction = {
  anchorId: string;
  role: MarkerRole;
};

export type MarkerOverlayOptions = {
  onAction?: (action: MarkerAction) => void;
  // The reader's D1 ReaderAnnotationAdapter (or just its measurement slice):
  // chip placement routes through adapter.rectsFor (the chip sits at `.first`,
  // preserving today's top-right visual), and the overlay also repositions on
  // the adapter's reader-specific layout signals (PDF zoom / textlayerrendered).
  // Omitted (legacy/tests): measurement falls back to collectAnchorRects over
  // the host element — same first-rect semantics.
  adapter?: AnnotationRectSource;
};

// Escape a double-quote in an anchor id the same way annotationLayer/DomReader do,
// so an exotic id can't break the attribute selector.
function escapeId(id: string): string {
  return id.replace(/"/g, '\\"');
}

function closestMarkerRole(node: EventTarget | null): HTMLElement | null {
  const el = node as (HTMLElement & { closest?: HTMLElement["closest"] }) | null;
  return el?.closest?.("[data-sv-marker-role]") as HTMLElement | null;
}

export class MarkerOverlay {
  private readonly hostEl: HTMLElement;
  private readonly onAction?: (action: MarkerAction) => void;
  private readonly adapter: AnnotationRectSource | null;
  private overlay: HTMLElement | null = null;
  private readonly chips = new Map<string, HTMLElement>();
  private rafId: number | null = null;
  private readonly unsubscribes: (() => void)[] = [];

  constructor(hostEl: HTMLElement, options: MarkerOverlayOptions = {}) {
    this.hostEl = hostEl;
    this.onAction = options.onAction;
    this.adapter = options.adapter ?? null;
    // Own the ambient reflow signals (shared DOM idiom: ResizeObserver on the host +
    // capture-phase scroll — see observeDomLayout). The adapter additionally feeds
    // reader-specific signals (PDF zoom / page render) through onLayoutChange. All
    // go through the rAF-throttled reposition().
    this.unsubscribes.push(observeDomLayout(hostEl, () => this.reposition()));
    if (this.adapter?.onLayoutChange) {
      this.unsubscribes.push(this.adapter.onLayoutChange(() => this.reposition()));
    }
  }

  // Lazily create the overlay div (appended to the host, which must be a positioning
  // context — PDF `.pdf-reader-canvas` is position:absolute, image
  // `.image-reader-stage` is position:relative — both OK). NOT inside `.textLayer`,
  // so it inherits no transform.
  private ensureOverlay(): HTMLElement {
    if (this.overlay && this.overlay.isConnected) return this.overlay;
    const doc = this.hostEl.ownerDocument;
    const overlay = doc.createElement("div");
    overlay.className = "sv-marker-overlay";
    overlay.setAttribute("data-sv", "1");
    this.hostEl.appendChild(overlay);
    this.overlay = overlay;
    return overlay;
  }

  // Replace all chips with one per item, then reposition.
  setMarkers(items: MarkerItem[]): void {
    const overlay = this.ensureOverlay();
    this.clear();
    const doc = this.hostEl.ownerDocument;
    for (const item of items) {
      const chip = doc.createElement("div");
      chip.className = "sv-anchor-markers";
      chip.setAttribute("data-sv", "1");
      chip.setAttribute("data-sv-marker-for", item.anchorId);
      chip.innerHTML = item.glyphHtml;
      chip.addEventListener("click", (event) => this.handleChipClick(item.anchorId, event));
      overlay.appendChild(chip);
      this.chips.set(item.anchorId, chip);
    }
    this.reposition();
  }

  private anchorFor(anchorId: string): HTMLElement | null {
    return this.hostEl.querySelector(`[data-sv-key="${escapeId(anchorId)}"]`) as HTMLElement | null;
  }

  // Measurement goes through the D1 adapter contract: first/last/all rects of every
  // element carrying the anchor's data-sv-key (a multi-span PDF anchor reports ALL
  // its spans, not just the first the old querySelector saw). Without an adapter,
  // fall back to the same shared collector over the host element.
  private rectsFor(anchorId: string): AnchorRects | null {
    if (this.adapter) return this.adapter.rectsFor(anchorId);
    return collectAnchorRects(this.hostEl, anchorId);
  }

  private handleChipClick(anchorId: string, event: MouseEvent): void {
    const roleEl = closestMarkerRole(event.target);
    const role = roleEl?.getAttribute("data-sv-marker-role") as MarkerRole | null;
    if (role !== "anchor" && role !== "note") return;
    event.preventDefault();
    event.stopPropagation();
    const anchor = this.anchorFor(anchorId);
    if (role === "note" && anchor) {
      const view = this.hostEl.ownerDocument.defaultView;
      const EventCtor = view?.MouseEvent ?? MouseEvent;
      anchor.dispatchEvent(new EventCtor("click", { bubbles: true, cancelable: true }));
    }
    this.onAction?.({ anchorId, role });
  }

  // rAF-throttled: read the host rect once, then place each chip at its live anchor's
  // top-right in overlay-local coords. A chip whose anchor element is gone (page
  // virtualized out) hides itself. Runs synchronously if there's no rAF (jsdom).
  reposition(): void {
    const view = this.hostEl.ownerDocument?.defaultView;
    const run = () => {
      this.rafId = null;
      this.layout();
    };
    if (view && typeof view.requestAnimationFrame === "function") {
      if (this.rafId != null) return;
      this.rafId = view.requestAnimationFrame(run);
    } else {
      run();
    }
  }

  private layout(): void {
    if (!this.overlay || !this.chips.size) return;
    // Reference the OVERLAY div's own rect, not hostEl's. Each chip is absolutely
    // positioned relative to the overlay (its offset parent); the overlay is
    // `position:absolute; inset:0` inside the reader's `overflow:auto` container, so it
    // SCROLLS WITH the content (its top = hostEl.top − scrollTop). Using hostEl's rect
    // as the reference would leave a constant scroll-offset error (chip drifts off by
    // scrollTop). Referencing the overlay makes chip placement self-consistent — and,
    // since overlay + anchors scroll together, chips track scroll even between repaints.
    const overlayRect = this.overlay.getBoundingClientRect();
    for (const [anchorId, chip] of this.chips) {
      const rects = this.rectsFor(anchorId);
      if (!rects) {
        chip.style.display = "none";
        continue;
      }
      // The single chip hangs at the FIRST rect's top-right (today's visual). D2's
      // two-slot markers will consume `.first`/`.last` from the same adapter call.
      const local = rectToOverlayLocal(rects.first, { left: overlayRect.left, top: overlayRect.top });
      chip.style.left = `${local.x}px`;
      chip.style.top = `${local.y}px`;
      chip.style.display = "";
    }
  }

  // Remove all chips (keeps the overlay div for reuse).
  clear(): void {
    for (const chip of this.chips.values()) chip.remove();
    this.chips.clear();
  }

  // Tear down: remove the overlay div and disconnect the observers/listeners
  // (including the adapter's onLayoutChange subscription).
  destroy(): void {
    if (this.rafId != null) {
      const view = this.hostEl.ownerDocument?.defaultView;
      view?.cancelAnimationFrame?.(this.rafId);
      this.rafId = null;
    }
    for (const unsubscribe of this.unsubscribes.splice(0)) unsubscribe();
    this.clear();
    this.overlay?.remove();
    this.overlay = null;
  }
}

// Mount a MarkerOverlay on a realm DOCUMENT's body — the shared mounting idiom for
// document-realm readers (the DomReader iframe and the Electron webview GUEST page;
// snapshot web inherits the DomReader path). The inset:0 overlay needs the body to
// be a positioning context so chips scroll with the content, so a static body is
// promoted to position:relative first (cross-realm-safe: getComputedStyle guarded).
export function mountRealmMarkerOverlay(doc: Document, options: MarkerOverlayOptions = {}): MarkerOverlay {
  const body = doc.body as HTMLElement | null;
  if (body) {
    const view = doc.defaultView;
    let pos = "";
    if (view && typeof view.getComputedStyle === "function") {
      try {
        pos = view.getComputedStyle(body).position;
      } catch {
        pos = "";
      }
    }
    if (pos === "static" || pos === "") body.style.position = "relative";
  }
  return new MarkerOverlay(body ?? doc.documentElement, options);
}
