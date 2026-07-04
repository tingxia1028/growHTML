// View-layer anchor-marker overlay — framework-free, works in the app document, the
// reader iframe, and the injected guest realm.
//
// WHY a separate overlay instead of injecting the marker chip into the annotated
// element: for PDF the anchor is a PDF.js `.textLayer` span scaled by a nested
// `transform: scale()`, so a child chip renders tiny (~6px) and inherits
// `color:transparent`. The correct approach (how PDF.js's own annotationLayer and
// Hypothesis work) is a SEPARATE overlay layer — a sibling of the transformed
// content, positioned in overlay/page coordinate space from each anchor's live rect,
// re-laid-out on zoom/scroll. Fixed CSS size, uniform for HTML / PDF / image.
//
// D2 two-slot markers (user-amended 2026-07-04): each anchor renders as TWO chips —
// the LEFT slot (one anchor glyph, buildAnchorSlotHtml) at the passage's FIRST line
// and the RIGHT slot (note-type icons, buildNoteSlotHtml) at its LAST line. The
// anchor's live rects come from the reader's D1 ReaderAnnotationAdapter
// (`adapter.rectsFor` — first/last/all; see surfaces/readerAnnotationAdapter.ts),
// falling back to the shared `[data-sv-key="…"]` collector (single-rect degenerate:
// first === last, both slots hang off the same line). If the anchor is virtualized
// out (e.g. a PDF page not rendered), both chips hide themselves.
//
// Clicking the LEFT slot TOGGLES that anchor's notes (note chip + hover/pinned/
// margin cards — state lives in annotationLayer's per-document store, session-
// scoped); clicking the RIGHT slot keeps today's behavior (synthesizes the anchor
// click that opens the shared grouped note card). Both still report through
// onAction (the host focus bridge / the guest's sv:marker-action channel).

import {
  isAnchorNotesHidden,
  rectToOverlayLocal,
  setAnchorNotesHidden,
  type MarkerRole
} from "./annotationLayer";
import { readStoredAnchorGlyphVisibility } from "./annotations";
import {
  collectAnchorRects,
  observeDomLayout,
  type AnchorRects,
  type AnnotationRectSource
} from "./surfaces/readerAnnotationAdapter";

// One anchor's two D2 slots. An empty noteSlotHtml means "no notes" — no right
// chip is created at all.
export interface MarkerItem {
  anchorId: string;
  /** LEFT slot content — buildAnchorSlotHtml() (the "有锚点" indicator). */
  anchorSlotHtml: string;
  /** RIGHT slot content — buildNoteSlotHtml(payload); "" ⇒ no note chip. */
  noteSlotHtml: string;
}

export type MarkerAction = {
  anchorId: string;
  role: MarkerRole;
};

export type MarkerOverlayOptions = {
  onAction?: (action: MarkerAction) => void;
  // The reader's D1 ReaderAnnotationAdapter (or just its measurement slice):
  // slot placement routes through adapter.rectsFor (anchor chip at `.first`,
  // note chip at `.last`), and the overlay also repositions on the adapter's
  // reader-specific layout signals (PDF zoom / textlayerrendered).
  // Omitted (legacy/tests): measurement falls back to collectAnchorRects over
  // the host element — same first/last semantics.
  adapter?: AnnotationRectSource;
};

// --- Global anchor-glyph visibility (the Anchor panel's 显示锚点标记 switch) -----
// Module-level store, REALM-LOCAL: every overlay constructed in this JS realm
// (the host document's PDF/image overlays AND the DomReader iframe overlays —
// they're built by host code) shares it and re-lays-out when it flips. The
// Electron webview guest is a separate bundle/realm: its copy lazily seeds from
// the guest page's storage (practically always the "visible" default) and is then
// driven by the host over the sv:anchors payload (electron/webview-preload.ts).
// Persistence lives in annotations.ts (readStored/persistAnchorGlyphVisibility —
// the annotation-mode localStorage idiom); this store is only the live value.
let anchorGlyphsVisible: boolean | null = null;
const anchorGlyphListeners = new Set<() => void>();

export function getAnchorGlyphVisibility(): boolean {
  if (anchorGlyphsVisible === null) anchorGlyphsVisible = readStoredAnchorGlyphVisibility();
  return anchorGlyphsVisible;
}

export function setAnchorGlyphVisibility(visible: boolean): void {
  if (getAnchorGlyphVisibility() === visible) return;
  anchorGlyphsVisible = visible;
  for (const listener of [...anchorGlyphListeners]) listener();
}

export function subscribeAnchorGlyphVisibility(listener: () => void): () => void {
  anchorGlyphListeners.add(listener);
  return () => {
    anchorGlyphListeners.delete(listener);
  };
}

// Escape a double-quote in an anchor id the same way annotationLayer/DomReader do,
// so an exotic id can't break the attribute selector.
function escapeId(id: string): string {
  return id.replace(/"/g, '\\"');
}

function closestMarkerRole(node: EventTarget | null): HTMLElement | null {
  const el = node as (HTMLElement & { closest?: HTMLElement["closest"] }) | null;
  return el?.closest?.("[data-sv-marker-role]") as HTMLElement | null;
}

type AnchorChips = { anchor: HTMLElement; note: HTMLElement | null };

export class MarkerOverlay {
  private readonly hostEl: HTMLElement;
  private readonly onAction?: (action: MarkerAction) => void;
  private readonly adapter: AnnotationRectSource | null;
  private overlay: HTMLElement | null = null;
  private readonly chips = new Map<string, AnchorChips>();
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
    // The global anchor-glyph switch re-runs layout (anchor chips hide/show).
    this.unsubscribes.push(subscribeAnchorGlyphVisibility(() => this.reposition()));
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

  // Replace all chips with (up to) two per anchor — the D2 slots — then reposition.
  setMarkers(items: MarkerItem[]): void {
    const overlay = this.ensureOverlay();
    this.clear();
    for (const item of items) {
      const anchor = this.createChip(overlay, item.anchorId, "anchor", item.anchorSlotHtml);
      const note = item.noteSlotHtml ? this.createChip(overlay, item.anchorId, "note", item.noteSlotHtml) : null;
      this.chips.set(item.anchorId, { anchor, note });
    }
    this.reposition();
  }

  private createChip(overlay: HTMLElement, anchorId: string, slot: "anchor" | "note", html: string): HTMLElement {
    const doc = this.hostEl.ownerDocument;
    const chip = doc.createElement("div");
    chip.className = `sv-anchor-markers sv-slot-${slot}`;
    chip.setAttribute("data-sv", "1");
    chip.setAttribute("data-sv-marker-for", anchorId);
    chip.setAttribute("data-sv-slot", slot);
    chip.innerHTML = html;
    chip.addEventListener("click", (event) => this.handleChipClick(anchorId, event));
    overlay.appendChild(chip);
    return chip;
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
    if (role === "anchor") {
      // LEFT slot (user-amended D2): toggle this anchor's notes.
      this.toggleAnchorNotes(anchorId);
    } else {
      // RIGHT slot: today's behavior — synthesize the anchor click that opens the
      // shared grouped note card in this realm.
      const anchor = this.anchorFor(anchorId);
      if (anchor) {
        const view = this.hostEl.ownerDocument.defaultView;
        const EventCtor = view?.MouseEvent ?? MouseEvent;
        anchor.dispatchEvent(new EventCtor("click", { bubbles: true, cancelable: true }));
      }
    }
    this.onAction?.({ anchorId, role });
  }

  // Flip the per-anchor "notes hidden" state. The store lives in annotationLayer
  // (keyed by this realm's document) so the shared card + margin machinery consult
  // the same state; the overlay only re-lays-out its chips. Returns the NEW state.
  toggleAnchorNotes(anchorId: string): boolean {
    const doc = this.hostEl.ownerDocument;
    const hidden = !isAnchorNotesHidden(doc, anchorId);
    setAnchorNotesHidden(doc, anchorId, hidden);
    this.reposition();
    return hidden;
  }

  // rAF-throttled: read the host rect once, then place each anchor's two chips at
  // its live first/last rects in overlay-local coords. Chips whose anchor element
  // is gone (page virtualized out) hide themselves. Runs synchronously if there's
  // no rAF (jsdom).
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
    const origin = { left: overlayRect.left, top: overlayRect.top };
    const doc = this.hostEl.ownerDocument;
    const glyphsVisible = getAnchorGlyphVisibility();
    for (const [anchorId, chips] of this.chips) {
      const rects = this.rectsFor(anchorId);
      if (!rects) {
        chips.anchor.style.display = "none";
        if (chips.note) chips.note.style.display = "none";
        continue;
      }
      const notesHidden = isAnchorNotesHidden(doc, anchorId);
      // LEFT slot: the anchor glyph at the FIRST line's left edge (the stylesheet
      // pulls it fully into the margin via translateX(-100%)). Hidden by the
      // global 显示锚点标记 switch; dimmed (data attr) while its notes are toggled off.
      if (notesHidden) chips.anchor.setAttribute("data-sv-notes-hidden", "1");
      else chips.anchor.removeAttribute("data-sv-notes-hidden");
      if (glyphsVisible) {
        chips.anchor.style.left = `${rects.first.left - origin.left}px`;
        chips.anchor.style.top = `${rects.first.top - origin.top}px`;
        chips.anchor.style.display = "";
      } else {
        chips.anchor.style.display = "none";
      }
      // RIGHT slot: the note-type icons at the LAST line's right edge (top-right
      // hang, same as the old single chip). Hidden while the anchor's notes are
      // toggled off. NOT affected by the global switch (note slots stay).
      if (chips.note) {
        if (notesHidden) {
          chips.note.style.display = "none";
        } else {
          const local = rectToOverlayLocal(rects.last, origin);
          chips.note.style.left = `${local.x}px`;
          chips.note.style.top = `${local.y}px`;
          chips.note.style.display = "";
        }
      }
    }
  }

  // Remove all chips (keeps the overlay div for reuse).
  clear(): void {
    for (const chips of this.chips.values()) {
      chips.anchor.remove();
      chips.note?.remove();
    }
    this.chips.clear();
  }

  // Tear down: remove the overlay div and disconnect the observers/listeners
  // (including the adapter's onLayoutChange + glyph-visibility subscriptions).
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
