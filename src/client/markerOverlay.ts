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
// left/top is computed from `rectToOverlayLocal(anchorRect, overlayRect)`. The chip
// finds its live anchor via `[data-sv-key="…"]`; if the anchor is virtualized out
// (e.g. a PDF page not rendered), the chip hides itself.

import { rectToOverlayLocal } from "./annotationLayer";

export interface MarkerItem {
  anchorId: string;
  glyphHtml: string;
}

// Escape a double-quote in an anchor id the same way annotationLayer/DomReader do,
// so an exotic id can't break the attribute selector.
function escapeId(id: string): string {
  return id.replace(/"/g, '\\"');
}

export class MarkerOverlay {
  private readonly hostEl: HTMLElement;
  private overlay: HTMLElement | null = null;
  private readonly chips = new Map<string, HTMLElement>();
  private rafId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private view: (Window & typeof globalThis) | null = null;
  private readonly onScroll = () => this.reposition();

  constructor(hostEl: HTMLElement) {
    this.hostEl = hostEl;
    // Own our reflow signals: a ResizeObserver on the host (content reflow / image
    // resize) and scroll listeners. The reader additionally calls reposition() on
    // reader-specific signals (PDF zoom, page render). All go through the
    // rAF-throttled reposition().
    const view = hostEl.ownerDocument?.defaultView as
      | (Window & typeof globalThis & { ResizeObserver?: typeof ResizeObserver })
      | null
      | undefined;
    this.view = view ?? null;
    if (view && typeof view.ResizeObserver === "function") {
      this.resizeObserver = new view.ResizeObserver(() => this.reposition());
      this.resizeObserver.observe(hostEl);
    }
    // Scroll events don't bubble, so a listener on `hostEl` only catches scrolls of
    // that exact element — fragile when the real scroller is an ancestor/descendant or
    // the container is re-created on re-render. A CAPTURE-phase listener on the window
    // catches scrolls from ANY element on the way down, so the chips always track the
    // anchor. Cheap: reposition is rAF-throttled and no-ops when there are no chips.
    hostEl.addEventListener("scroll", this.onScroll, { passive: true });
    view?.addEventListener("scroll", this.onScroll, { passive: true, capture: true });
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
      overlay.appendChild(chip);
      this.chips.set(item.anchorId, chip);
    }
    this.reposition();
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
      const anchor = this.hostEl.querySelector(`[data-sv-key="${escapeId(anchorId)}"]`) as HTMLElement | null;
      if (!anchor || typeof anchor.getBoundingClientRect !== "function") {
        chip.style.display = "none";
        continue;
      }
      const anchorRect = anchor.getBoundingClientRect();
      const local = rectToOverlayLocal(anchorRect, { left: overlayRect.left, top: overlayRect.top });
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

  // Tear down: remove the overlay div and disconnect the observers/listeners.
  destroy(): void {
    if (this.rafId != null) {
      const view = this.hostEl.ownerDocument?.defaultView;
      view?.cancelAnimationFrame?.(this.rafId);
      this.rafId = null;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.hostEl.removeEventListener("scroll", this.onScroll);
    this.view?.removeEventListener("scroll", this.onScroll, { capture: true } as EventListenerOptions);
    this.view = null;
    this.clear();
    this.overlay?.remove();
    this.overlay = null;
  }
}
