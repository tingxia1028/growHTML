// D1 — the ONE ReaderAnnotationAdapter contract every reader realm implements
// (docs/design/note-presentation-unified.md §1).
//
// Every reader hosts the SAME three framework-free view-layer pieces — paint
// (highlight classes on resolved elements), the MarkerOverlay, and the shared
// #sv-note-card — driven by this adapter. The adapter is the only reader-specific
// part: it resolves + measures anchors in ITS realm (iframe document, PDF host
// canvas, image stage, webview guest page) and reports layout changes; the shared
// machinery (markerOverlay.ts, annotationLayer.ts) consumes the adapter instead of
// reaching into reader internals.
//
// Framework-free: no React / no Node imports — this runs in the app document, the
// reader <iframe> realm, and the injected Electron <webview> guest realm.

import { ANNOTATION_STYLE_ID, revealAnchorInDoc } from "../annotationLayer";
import type { PaintAnchor } from "./types";

// A plain viewport-coordinate rect literal (DOMRect shape without the class), so
// adapters are jsdom-testable and rects can cross realm boundaries as data.
export type AdapterRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

// The live rects of ONE anchor's painted element(s), in viewport coords.
// A multi-element anchor (e.g. a PDF quote stamped onto MANY text-layer spans)
// reports its FIRST element's rect, its LAST element's rect, and every rect —
// D2's two marker slots need the first line AND the last line of a passage;
// today's single chip positions from `.first` (visuals unchanged).
export type AnchorRects = { first: AdapterRect; last: AdapterRect; all: AdapterRect[] };

// The per-reader-realm adapter contract (D1). `TAnchor` is the host's PaintAnchor
// for in-app readers; the webview guest realm paints its own WebAnchorMsg shape.
export interface ReaderAnnotationAdapter<TAnchor = PaintAnchor> {
  /** Live viewport-coordinate rects for an anchor's painted element(s), or null
   *  when the anchor is not currently painted (e.g. its PDF page is virtualized
   *  out). first/last/all — see AnchorRects. */
  rectsFor(anchorId: string): AnchorRects | null;
  /** Subscribe to realm layout changes (scroll / zoom / page render / reflow);
   *  the overlay repositions on each. Returns the unsubscribe. */
  onLayoutChange(cb: () => void): () => void;
  /** Inject ANNOTATION_CSS (+ future style vars) into the realm. Idempotent. */
  injectRealmCss(css: string): void;
  /** Paint the given anchors: applyHighlight/highlightQuote onto resolved
   *  elements + drive the realm's MarkerOverlay chips. */
  paint(anchors: TAnchor[]): void;
  /** Scroll+flash the anchor's painted element — delegates to revealAnchorInDoc. */
  reveal(anchorId: string): boolean;
}

// The measurement slice of the contract the MarkerOverlay consumes (it never
// paints or reveals) — kept structural so the overlay stays decoupled.
export type AnnotationRectSource = {
  rectsFor(anchorId: string): AnchorRects | null;
  onLayoutChange?(cb: () => void): () => void;
};

// Escape a double-quote in an anchor id the same way annotationLayer/DomReader do,
// so an exotic id can't break the attribute selector.
function escapeId(id: string): string {
  return id.replace(/"/g, '\\"');
}

function toAdapterRect(rect: { left: number; top: number; right: number; bottom?: number; width: number; height: number }): AdapterRect {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: typeof rect.bottom === "number" ? rect.bottom : rect.top + rect.height,
    width: rect.width,
    height: rect.height
  };
}

// The default DOM-realm `rectsFor`: collect EVERY element stamped with the anchor's
// `data-sv-key` under `root` (document order) and measure each. This is the fix for
// the old single-`querySelector` measurement — a multi-span PDF anchor stamps its
// key onto MANY spans of which only the first was ever measured; now first = the
// first span's rect, last = the last span's rect, all = every span's rect.
// Cross-realm-safe: every DOM call is duck-typed/guarded.
export function collectAnchorRects(root: ParentNode | null | undefined, anchorId: string): AnchorRects | null {
  if (!root || !anchorId) return null;
  try {
    const elements = Array.from(root.querySelectorAll(`[data-sv-key="${escapeId(anchorId)}"]`));
    const all: AdapterRect[] = [];
    for (const el of elements) {
      const measurable = el as Element & { getBoundingClientRect?: () => DOMRect };
      if (typeof measurable.getBoundingClientRect !== "function") continue;
      all.push(toAdapterRect(measurable.getBoundingClientRect()));
    }
    if (!all.length) return null;
    return { first: all[0], last: all[all.length - 1], all };
  } catch {
    return null; // realm torn down / exotic selector — treat as not painted
  }
}

// The shared DOM-realm `onLayoutChange` idiom (previously hand-rolled inside
// MarkerOverlay's constructor): a ResizeObserver on the host (content reflow /
// image resize) plus scroll listeners. Scroll events don't bubble, so a listener
// on `hostEl` only catches scrolls of that exact element — a CAPTURE-phase
// listener on the window catches scrolls from ANY element on the way down.
export function observeDomLayout(hostEl: HTMLElement, cb: () => void): () => void {
  const view = hostEl.ownerDocument?.defaultView as
    | (Window & typeof globalThis & { ResizeObserver?: typeof ResizeObserver })
    | null
    | undefined;
  let resizeObserver: ResizeObserver | null = null;
  if (view && typeof view.ResizeObserver === "function") {
    resizeObserver = new view.ResizeObserver(() => cb());
    resizeObserver.observe(hostEl);
  }
  const onScroll = () => cb();
  hostEl.addEventListener("scroll", onScroll, { passive: true });
  view?.addEventListener("scroll", onScroll, { passive: true, capture: true });
  return () => {
    resizeObserver?.disconnect();
    resizeObserver = null;
    hostEl.removeEventListener("scroll", onScroll);
    view?.removeEventListener("scroll", onScroll, { capture: true } as EventListenerOptions);
  };
}

// Idempotently (re)inject a stylesheet into a realm document — the default
// `injectRealmCss`. Keyed by ANNOTATION_STYLE_ID so it composes with
// ensureAnnotationLayer's own injection of the same sheet.
export function injectCssIntoRealm(doc: Document | null | undefined, css: string, styleId: string = ANNOTATION_STYLE_ID): void {
  if (!doc?.head) return;
  let style = doc.getElementById(styleId) as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement("style");
    style.id = styleId;
    doc.head.appendChild(style);
  }
  if (style.textContent !== css) style.textContent = css;
}

type DomRealmRoot = Document | HTMLElement | null | undefined;

function realmDoc(root: DomRealmRoot): Document | null {
  if (!root) return null;
  return root.nodeType === 9 ? (root as Document) : (root as HTMLElement).ownerDocument;
}

function realmHost(root: DomRealmRoot): HTMLElement | null {
  if (!root) return null;
  if (root.nodeType === 9) {
    const doc = root as Document;
    return (doc.body as HTMLElement | null) ?? doc.documentElement;
  }
  return root as HTMLElement;
}

export type DomRealmAdapterOptions<TAnchor> = {
  /** The realm root the anchors are painted into — a Document (iframe/guest) or a
   *  host-document container element (PDF viewer div / image stage). Read lazily so
   *  a re-created container is always the live one. */
  root: () => DomRealmRoot;
  /** Reader-specific paint: resolve + highlight + push overlay chips. */
  paint: (anchors: TAnchor[]) => void;
  /** Override reveal (default: revealAnchorInDoc over root()). */
  reveal?: (anchorId: string) => boolean;
  /** Override layout-change wiring (default: observeDomLayout on the realm host).
   *  PDF supplies its own (textlayerrendered + zoom via the pdf.js event bus). */
  onLayoutChange?: (cb: () => void) => () => void;
};

// Build a ReaderAnnotationAdapter for any DOM-painted realm — the shared factory
// behind the DomReader iframe (snapshot web inherits it), the image stage, and the
// webview guest; PDF overrides onLayoutChange with its event-bus signals.
export function createDomRealmAdapter<TAnchor = PaintAnchor>(
  options: DomRealmAdapterOptions<TAnchor>
): ReaderAnnotationAdapter<TAnchor> {
  return {
    rectsFor: (anchorId) => collectAnchorRects(options.root(), anchorId),
    onLayoutChange:
      options.onLayoutChange ??
      ((cb) => {
        const host = realmHost(options.root());
        return host ? observeDomLayout(host, cb) : () => {};
      }),
    injectRealmCss: (css) => injectCssIntoRealm(realmDoc(options.root()), css),
    paint: options.paint,
    reveal: options.reveal ?? ((anchorId) => revealAnchorInDoc(options.root(), anchorId))
  };
}
