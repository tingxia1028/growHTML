// Shared, framework-free annotation PRESENTATION layer.
//
// This is the layer that is decoupled from viewers: it paints the highlight and
// the floating note card and knows nothing about HTML/PDF/web sources. Resolving
// an anchor to a target element is each viewer's job (irreducibly surface-
// specific); once a viewer has the element + note text, it calls applyHighlight
// and the shared card handles hover/click. Adding a new viewer therefore never
// re-implements the card UI.
//
// No React / no Node imports, so it runs equally in the main app document, inside
// the reader <iframe>, and injected into the live <webview> guest page.
import { resolveTextQuote, type TextQuoteSelector } from "../adapters/web/textQuote";

export const ANNOTATION_STYLE_ID = "sv-annot-style";

export const ANNOTATION_CSS = `
.sv-annotated {
  background: rgba(52, 116, 230, 0.18);
  box-shadow: inset 0 -2px 0 #3474e6;
  cursor: pointer;
}
/* The currently SELECTED / focused anchor — persistent UI-blue highlight (the
   product accent #3474e6) so clicking/focusing an anchor gives immediate "this is
   selected" feedback on the same blue ramp. Wins over
   .sv-annotated (declared after it) and also paints a bare, note-less anchor.
   Literal color: this stylesheet is injected into the reader realm, which has no
   --sv-* tokens. setSelectedAnchorInDoc adds/clears this class. */
.sv-selected,
.sv-annotated.sv-selected {
  background: rgba(52, 116, 230, 0.22);
  box-shadow: inset 0 -2px 0 #3474e6;
  border-radius: 2px;
}
/* Transient "we just jumped here" pulse, applied by revealAnchorInDoc on a
   jump-to-anchor (bookmark row / multi-anchor jump) then removed after ~1s. A
   ring + glow in the UI accent blue, distinct from the persistent highlight. */
.sv-active {
  outline: 2px solid #3474e6 !important;
  outline-offset: 1px;
  box-shadow: 0 0 0 3px rgba(52, 116, 230, 0.45), inset 0 -2px 0 #3474e6 !important;
  transition: outline-color 0.25s ease, box-shadow 0.25s ease;
}
/* Anchor markers now live in a VIEW-LAYER overlay (MarkerOverlay), a sibling of the
   reader content rather than a child of the annotated element. This escapes the
   PDF.js text-layer span transform (scaleX) + color:transparent that used to
   shrink/hide an in-content chip, and gives every reader (HTML/PDF/image) a uniform,
   fixed-size chip positioned in overlay/page coordinate space. */
.sv-marker-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 6;
  overflow: hidden;
}
/* One chip per anchor, positioned absolutely inside the overlay at the anchor's
   top-right (MarkerOverlay.reposition sets left/top). EXPLICIT color (never inherit
   currentColor): realms have no --sv-* tokens, so use the literal product blue. */
.sv-anchor-markers {
  position: absolute;
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 3px;
  border: 1px solid #c9dcff;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.96);
  color: #3474e6;
  box-shadow: 0 3px 10px rgba(52, 116, 230, 0.18);
  line-height: 1;
  user-select: none;
  transform: translate(5px, -4px);
}
.sv-anchor-marker {
  position: relative;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.sv-anchor-marker:hover,
.sv-anchor-marker:focus-visible {
  background: #eef5ff;
  outline: none;
}
.sv-anchor-marker svg {
  width: 13px;
  height: 13px;
  stroke: currentColor;
}
.sv-anchor-marker-count {
  font: 700 9px/1 Inter, "Segoe UI", Arial, sans-serif;
  vertical-align: super;
  margin-left: -1px;
  color: #3474e6;
  pointer-events: none;
}
#sv-note-card {
  position: fixed;
  z-index: 2147483000;
  display: none;
  flex-direction: column;
  width: 340px;
  min-width: 200px;
  max-width: 640px;
  min-height: 70px;
  max-height: 70vh;
  resize: both;
  overflow: hidden;
  border-radius: 8px;
  background: #ffffff;
  color: #202124;
  border: 1px solid #c9dcff;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.18);
  font: 13px/1.5 Inter, "Segoe UI", Arial, sans-serif;
}
#sv-note-card.sv-note-card-show {
  display: flex;
}
.sv-note-card-body {
  flex: 1 1 auto;
  overflow: auto;
  padding: 8px 11px;
  overflow-wrap: anywhere;
}
.sv-note-card-body > :first-child { margin-top: 0; }
.sv-note-card-body > :last-child { margin-bottom: 0; }
.sv-note-card-body h1,
.sv-note-card-body h2,
.sv-note-card-body h3 {
  font-size: 14px;
  margin: 7px 0 3px;
}
.sv-note-card-body p { margin: 4px 0; }
.sv-note-card-body ul,
.sv-note-card-body ol { margin: 4px 0; padding-left: 18px; }
.sv-note-card-body code {
  background: #eef5ff;
  padding: 0 3px;
  border-radius: 3px;
}
.sv-note-card-body hr { border: 0; border-top: 1px solid #c9dcff; margin: 8px 0; }
.sv-annotation-card-list {
  display: grid;
  gap: 10px;
}
/* Content-only card: the sanctioned note body renders directly (no artifact-card
   chrome). Stacked previews when an anchor has multiple notes. */
.sv-annotation-preview + .sv-annotation-preview {
  border-top: 1px solid #e3e8ef;
  padding-top: 8px;
  margin-top: 8px;
}
.sv-note-content {
  font-size: 13px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.sv-note-content > :first-child { margin-top: 0; }
.sv-note-content > :last-child { margin-bottom: 0; }
.sv-note-content .note-rendered {
  font-size: 13px;
  line-height: 1.5;
}

/* --- Marginalia mode: persistent cards in a right-hand gutter --- */
.sv-annot-margin { padding-right: 312px; box-sizing: border-box; }
#sv-margin-layer {
  position: absolute;
  top: 0;
  right: 0;
  width: 300px;
  pointer-events: none;
  z-index: 2147482000;
}
#sv-margin-connectors {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  overflow: visible;
  z-index: 2147481999;
}
.sv-margin-connectors-path {
  fill: none;
  stroke: #3474e6;
  stroke-width: 1.5;
  stroke-dasharray: 3 3;
}
.sv-margin-note {
  position: absolute;
  right: 6px;
  width: 286px;
  box-sizing: border-box;
  pointer-events: auto;
  border-radius: 8px;
  background: #ffffff;
  color: #202124;
  border: 1px solid #c9dcff;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
  font: 13px/1.5 Inter, "Segoe UI", Arial, sans-serif;
  transition: top 0.12s ease;
}
.sv-margin-note-body {
  padding: 7px 10px;
  max-height: 240px;
  overflow: auto;
  overflow-wrap: anywhere;
}
.sv-margin-note-body > :first-child { margin-top: 0; }
.sv-margin-note-body > :last-child { margin-bottom: 0; }
.sv-margin-note-body p { margin: 4px 0; }
.sv-margin-note-body ul,
.sv-margin-note-body ol { margin: 4px 0; padding-left: 18px; }
.sv-margin-note-body code { background: #eef5ff; padding: 0 3px; border-radius: 3px; }`;

// Cross-realm-safe "is this node (or an ancestor) a match" — the reader doc /
// guest page is a different realm, so `instanceof Element` is unreliable;
// duck-type `.closest` instead.
function closestMatch(node: EventTarget | null, selector: string): Element | null {
  const el = node as (Element & { closest?: Element["closest"] }) | null;
  return el && typeof el.closest === "function" ? el.closest(selector) : null;
}

// --- Per-anchor card geometry persistence -----------------------------------
// The floating card is a single shared element, but each annotated target may
// carry a stable `data-sv-key` (its anchor id). When present, the card remembers
// how it was resized and, after an explicit drag, its offset from THAT anchor.
// Stored in the reader realm's localStorage so it survives reloads. The card is
// always positioned from the live anchor rect, never from stale viewport left/top.
export interface CardGeom {
  left: number;
  top: number;
  width: number;
  height: number;
  anchorDx?: number;
  anchorDy?: number;
}

export type HighlightPayload = {
  noteHtml?: string;
  noteCount?: number;
  /** One entry per note on the anchor (e.g. ["markdown","quiz","quiz"]) — drives
   *  the note-type glyph markers. */
  noteTypes?: string[];
};

const highlightPayloads = new WeakMap<Element, HighlightPayload>();

// --- Inline-adjacent marker glyphs -------------------------------------------
// Literal lucide 24x24 path data (stroke=currentColor, fill=none). This map is a
// framework-free MIRROR of src/client/notes/noteTypeIcon.tsx's ICONS map — keep the
// two in sync (a unit test asserts every noteTypeIcon key has an entry here). We
// inline raw SVG strings because annotationLayer.ts is framework-free (no React /
// lucide imports; it runs in the reader iframe and the injected guest realm).
function svg(inner: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

// FileText (markdown / plain-text / fallback)
const GLYPH_FILE_TEXT = svg(
  '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>'
);
// ListChecks (quiz)
const GLYPH_LIST_CHECKS = svg(
  '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>'
);
// CreditCard (flashcard)
const GLYPH_CREDIT_CARD = svg('<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>');
// Code2 (code / code-snippet / html / html-sandbox)
const GLYPH_CODE2 = svg('<path d="m18 16 4-4-4-4"/><path d="m6 8-4 4 4 4"/><path d="m14.5 4-5 16"/>');
// Workflow (mermaid)
const GLYPH_WORKFLOW = svg(
  '<rect width="8" height="8" x="3" y="3" rx="2"/><path d="M7 11v4a2 2 0 0 0 2 2h4"/><rect width="8" height="8" x="13" y="13" rx="2"/>'
);
// Network (markmap / mindmap)
const GLYPH_NETWORK = svg(
  '<rect x="9" y="2" width="6" height="6" rx="1"/><rect x="3" y="16" width="6" height="6" rx="1"/><rect x="15" y="16" width="6" height="6" rx="1"/><path d="M12 8v4"/><path d="M6 16v-1a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"/>'
);
// Image (image)
const GLYPH_IMAGE = svg(
  '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>'
);
// Play (media / video / audio)
const GLYPH_PLAY = svg('<polygon points="6 3 20 12 6 21 6 3"/>');
// HelpCircle (concept)
const GLYPH_HELP_CIRCLE = svg(
  '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>'
);
// Bookmark (bookmark)
const GLYPH_BOOKMARK = svg('<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>');

// contentType → glyph. Keys MUST cover every key in noteTypeIcon.tsx's ICONS map.
export const MARKER_GLYPHS: Record<string, string> = {
  markdown: GLYPH_FILE_TEXT,
  "plain-text": GLYPH_FILE_TEXT,
  flashcard: GLYPH_CREDIT_CARD,
  quiz: GLYPH_LIST_CHECKS,
  image: GLYPH_IMAGE,
  media: GLYPH_PLAY,
  video: GLYPH_PLAY,
  audio: GLYPH_PLAY,
  code: GLYPH_CODE2,
  "code-snippet": GLYPH_CODE2,
  html: GLYPH_CODE2,
  "html-sandbox": GLYPH_CODE2,
  mermaid: GLYPH_WORKFLOW,
  markmap: GLYPH_NETWORK,
  mindmap: GLYPH_NETWORK,
  concept: GLYPH_HELP_CIRCLE,
  bookmark: GLYPH_BOOKMARK
};

// The left "this passage is anchored" glyph — an anchor (lucide Anchor).
export const ANCHOR_GLYPH = svg(
  '<line x1="12" x2="12" y1="22" y2="8"/><path d="M5 12H2a10 10 0 0 0 20 0h-3"/><circle cx="12" cy="5" r="3"/>'
);

export function markerGlyph(type: string): string {
  return MARKER_GLYPHS[type] ?? MARKER_GLYPHS.markdown;
}

const CARD_GEOM_PREFIX = "sv-card-geom:";

function cardStore(doc: Document): Storage | null {
  try {
    return doc.defaultView?.localStorage ?? null;
  } catch {
    return null; // sandboxed / unavailable
  }
}

export function readCardGeom(doc: Document, key: string): CardGeom | null {
  const store = cardStore(doc);
  if (!store || !key) return null;
  try {
    const raw = store.getItem(CARD_GEOM_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CardGeom>;
    if (
      typeof parsed?.left === "number" &&
      typeof parsed?.top === "number" &&
      typeof parsed?.width === "number" &&
      typeof parsed?.height === "number"
    ) {
      return {
        left: parsed.left,
        top: parsed.top,
        width: parsed.width,
        height: parsed.height,
        anchorDx: typeof parsed.anchorDx === "number" ? parsed.anchorDx : undefined,
        anchorDy: typeof parsed.anchorDy === "number" ? parsed.anchorDy : undefined
      };
    }
  } catch {
    // corrupt entry — ignore
  }
  return null;
}

export function writeCardGeom(doc: Document, key: string, geom: CardGeom): void {
  const store = cardStore(doc);
  if (!store || !key) return;
  try {
    store.setItem(CARD_GEOM_PREFIX + key, JSON.stringify(geom));
  } catch {
    // quota / unavailable — ignore
  }
}

// Keep a restored card visible even if the viewport shrank since it was saved.
export function clampGeom(geom: CardGeom, viewW: number, viewH: number): CardGeom {
  const width = Math.min(geom.width, Math.max(120, viewW - 16));
  const height = Math.min(geom.height, Math.max(80, viewH - 16));
  const left = Math.min(Math.max(0, geom.left), Math.max(0, viewW - width));
  const top = Math.min(Math.max(0, geom.top), Math.max(0, viewH - height));
  return { left, top, width, height };
}

const wiredDocs = new WeakSet<Document>();

// Inject the stylesheet once and wire the single floating note card (shown on
// hover, pinned on click) for a document. Idempotent.
export function ensureAnnotationLayer(doc: Document): void {
  if (doc.head && !doc.getElementById(ANNOTATION_STYLE_ID)) {
    const style = doc.createElement("style");
    style.id = ANNOTATION_STYLE_ID;
    style.textContent = ANNOTATION_CSS;
    doc.head.appendChild(style);
  }
  wireNoteCard(doc);
}

function wireNoteCard(doc: Document): void {
  if (wiredDocs.has(doc) || !doc.body || typeof doc.addEventListener !== "function") return;
  wiredDocs.add(doc);

  // A resizable, CONTENT-ONLY card: no title bar / grip / close / footer — just a
  // scrollable body rendering the sanctioned note preview. Dismissal is the
  // ambient outside-click + mouseleave + Esc (no explicit close affordance).
  const card = doc.createElement("div");
  card.id = "sv-note-card";
  card.setAttribute("data-sv", "1");
  const body = doc.createElement("div");
  body.className = "sv-note-card-body";
  card.appendChild(body);
  doc.body.appendChild(card);

  let pinned = false;
  let currentKey = ""; // the data-sv-key of the anchor the card currently shows
  let currentTarget: Element | null = null;
  let anchorOffset = { x: 0, y: 6 };
  let resizing = false;

  // Persist the card's current rect for the active key (drag / resize end).
  const persistGeom = () => {
    if (!currentKey) return;
    const rect = card.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return; // not laid out (e.g. jsdom)
    const targetRect = currentTarget?.getBoundingClientRect();
    writeCardGeom(doc, currentKey, {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      anchorDx: targetRect ? rect.left - targetRect.left : undefined,
      anchorDy: targetRect ? rect.top - targetRect.bottom : undefined
    });
  };

  const placeCardAtTarget = (target: Element) => {
    if (!target.isConnected) {
      pinned = false;
      currentTarget = null;
      card.classList.remove("sv-note-card-show");
      return;
    }
    const rect = target.getBoundingClientRect();
    const view = doc.defaultView;
    const styleWidth = Number.parseFloat(card.style.width);
    const measuredWidth = card.getBoundingClientRect().width;
    const cardWidth = Number.isFinite(styleWidth) && styleWidth > 0 ? styleWidth : measuredWidth > 0 ? measuredWidth : 340;
    const maxLeft = view ? Math.max(8, view.innerWidth - cardWidth - 8) : Number.POSITIVE_INFINITY;
    const left = Math.min(Math.max(8, rect.left + anchorOffset.x), maxLeft);
    card.style.left = `${left}px`;
    // Do not clamp vertically: a pinned card should travel with its source text
    // instead of staying stuck to the viewport after the reader scrolls away.
    card.style.top = `${rect.bottom + anchorOffset.y}px`;
  };

  const syncPinnedCard = () => {
    if (!pinned || marginActive()) return;
    if (currentTarget) placeCardAtTarget(currentTarget);
  };

  const show = (target: Element) => {
    currentKey = target.getAttribute("data-sv-key") ?? "";
    currentTarget = target;
    const payload = highlightPayloads.get(target);
    // Content-only: render the sanctioned note body directly (no chrome). An anchor
    // with no note previews paints highlight + markers but no card body.
    body.innerHTML = payload?.noteHtml ?? "";
    const view = doc.defaultView;
    const saved = currentKey ? readCardGeom(doc, currentKey) : null;
    if (saved && view) {
      // Restore size and an optional anchor-relative offset. Older records only
      // have viewport left/top; ignore those absolute coordinates so the card
      // stays bound to the live source text after scrolling.
      const g = clampGeom(saved, view.innerWidth, view.innerHeight);
      card.style.width = `${g.width}px`;
      card.style.height = `${g.height}px`;
      anchorOffset = {
        x: typeof saved.anchorDx === "number" ? saved.anchorDx : 0,
        y: typeof saved.anchorDy === "number" ? saved.anchorDy : 6
      };
    } else {
      card.style.width = "";
      card.style.height = "";
      anchorOffset = { x: 0, y: 6 };
    }
    card.classList.add("sv-note-card-show");
    placeCardAtTarget(target);
  };
  const hide = () => {
    if (!pinned) card.classList.remove("sv-note-card-show");
  };
  const dismiss = () => {
    pinned = false;
    currentTarget = null;
    card.classList.remove("sv-note-card-show");
  };

  // Remember user resizes (CSS `resize: both`) for the active key.
  const view = doc.defaultView as (Window & { ResizeObserver?: typeof ResizeObserver }) | null;
  if (view && typeof view.ResizeObserver === "function") {
    const ro = new view.ResizeObserver(() => {
      if (resizing && card.classList.contains("sv-note-card-show")) persistGeom();
    });
    ro.observe(card);
  }

  // In marginalia mode the notes live in the gutter, so the hover card is off.
  const marginActive = () => doc.body?.classList.contains("sv-annot-margin") ?? false;

  doc.addEventListener("scroll", syncPinnedCard, true);
  view?.addEventListener("scroll", syncPinnedCard, true);
  view?.addEventListener("resize", syncPinnedCard);

  doc.addEventListener("mouseover", (event) => {
    if (marginActive()) return;
    const target = closestMatch(event.target, ".sv-annotated");
    if (target && !pinned) show(target);
  });
  doc.addEventListener("mouseout", (event) => {
    if (!closestMatch(event.target, ".sv-annotated")) return;
    // Keep the card open while the pointer moves from the highlight onto it.
    if (!closestMatch((event as MouseEvent).relatedTarget, "#sv-note-card")) hide();
  });
  card.addEventListener("mouseleave", hide);
  doc.addEventListener("click", (event) => {
    if (marginActive()) return;
    const target = closestMatch(event.target, ".sv-annotated");
    if (target) {
      if (pinned && currentTarget === target) {
        pinned = false;
        currentTarget = null;
        card.classList.remove("sv-note-card-show");
      } else {
        pinned = true;
        show(target);
      }
      return;
    }
    if (!closestMatch(event.target, "#sv-note-card")) dismiss();
  });

  // No drag bar (content-only card). A mousedown on the card is a resize gesture
  // (CSS `resize: both`); remember the resulting size for the active key.
  card.addEventListener("mousedown", () => {
    resizing = true;
    const onUp = () => {
      resizing = false;
      persistGeom();
      doc.removeEventListener("mouseup", onUp);
    };
    doc.addEventListener("mouseup", onUp);
  });
}

export type MarkerRole = "anchor" | "note";

function markerHtml(inner: string, count: number | undefined, role: MarkerRole): string {
  const badge = count && count > 1 ? `<sup class="sv-anchor-marker-count">${count}</sup>` : "";
  const title = role === "anchor" ? "Focus anchor" : "Show linked notes";
  return `<button type="button" class="sv-anchor-marker" data-sv-marker-role="${role}" title="${title}" aria-label="${title}">${inner}${badge}</button>`;
}

// PURE glyph builder for an anchor's overlay chip: a leading anchor glyph plus one
// glyph per DISTINCT note type (deduped in first-seen order), each carrying a count
// superscript when that type repeats. When the anchor has no type info, fall back to
// the markdown glyph carrying the total note count. Framework-free string output so
// it's identical in the reader iframe, the PDF/image host document, and the guest.
// The overlay controller (markerOverlay.ts) wraps this in a positioned chip; the
// guest appends it inline as a trailing <mark> child (no transform problem there).
export function buildMarkerHtml(payload?: HighlightPayload): string {
  const types = payload?.noteTypes ?? [];
  const noteCount = payload?.noteCount ?? types.length;

  // Count per distinct type (in first-seen order) so a repeated type shows once
  // with a superscript rather than a duplicated glyph.
  const counts = new Map<string, number>();
  for (const t of types) counts.set(t, (counts.get(t) ?? 0) + 1);

  let glyphs = "";
  if (counts.size) {
    for (const [type, n] of counts) glyphs += markerHtml(markerGlyph(type), n, "note");
  } else if (noteCount > 0) {
    // No type info: fall back to the markdown glyph, carrying the note count.
    glyphs += markerHtml(markerGlyph("markdown"), noteCount > 1 ? noteCount : undefined, "note");
  }
  return markerHtml(ANCHOR_GLYPH, undefined, "anchor") + glyphs;
}

// A resolved anchor's overlay-local rect: the chip's target box (x,y,w,h) already
// translated into the overlay's coordinate space. Plain-literal I/O so it's
// jsdom-testable without live layout.
export type OverlayRect = { anchorId: string; x: number; y: number; w: number; h: number };

type RectLike = { left: number; top: number; right: number; width: number; height: number };

// Translate an anchor's viewport rect into the overlay's local coordinate space,
// returning the anchor's TOP-RIGHT corner (x = right edge) so the chip hangs off the
// end of the passage. Pure — accepts plain rect literals.
export function rectToOverlayLocal(
  anchorRect: RectLike,
  overlayRect: { left: number; top: number }
): { x: number; y: number; w: number; h: number } {
  return {
    x: anchorRect.right - overlayRect.left,
    y: anchorRect.top - overlayRect.top,
    w: anchorRect.width,
    h: anchorRect.height
  };
}

// Mark an already-resolved element as annotated and stash the note text for the
// card. `noteText` may be empty (highlight only). Markers are NO LONGER painted into
// the content here — each reader mounts a MarkerOverlay (view-layer sibling) and
// drives it from buildMarkerHtml, so the annotated element stays clean.
export function applyHighlight(element: Element, noteText: string, key?: string, payload?: HighlightPayload): void {
  element.classList.add("sv-annotated");
  if (noteText) element.setAttribute("data-sv-note", noteText);
  // Stable id → the card remembers this anchor's placement/size across shows.
  if (key) element.setAttribute("data-sv-key", key);
  const noteCount = payload?.noteCount ?? (noteText ? 1 : 0);
  if (noteCount > 0) element.setAttribute("data-sv-note-count", String(noteCount));
  else element.removeAttribute("data-sv-note-count");
  if (payload) highlightPayloads.set(element, payload);
  else highlightPayloads.delete(element);
}

// The ONE shared "scroll the focused passage into view" helper for every surface
// whose anchors are painted into a DOM document carrying `data-sv-key` — the iframe
// reader (DomReader), the snapshot webview's nested DomReader, the webview GUEST
// page (called from the preload), and the host-document overlays (PDF text/region
// hits, image region boxes). It is the WRITE-side mirror of selection: the host
// hands every reader an activeAnchorId + a reveal nonce, and the reader that owns a
// painted element for that id delegates HERE, so the scroll/flash logic lives once.
//
// Framework-free (no React/Node) so it runs equally in the app document, the reader
// iframe realm, and the injected guest realm. Every DOM call is wrapped in try/catch
// because the realm may be cross-origin/torn down and jsdom has no scrollIntoView.
// Returns whether a matching element was found (PDF uses the false return to first
// scroll the virtualized target page into view, then reveal again after it paints).
export function revealAnchorInDoc(root: ParentNode | null | undefined, anchorId: string | undefined): boolean {
  if (!root || !anchorId) return false;
  try {
    // Escape double-quotes the same way DomReader escapes its selector so an exotic
    // anchor id can't break the attribute selector or inject into the query.
    const el = root.querySelector(`[data-sv-key="${anchorId.replace(/"/g, '\\"')}"]`) as
      | (Element & { scrollIntoView?: Element["scrollIntoView"] })
      | null;
    if (!el) return false;
    try {
      el.scrollIntoView?.({ block: "center", inline: "nearest" });
    } catch {
      // jsdom / realm without scrollIntoView — the flash still applies.
    }
    el.classList.add("sv-active");
    const view = el.ownerDocument?.defaultView;
    const clear = () => el.classList.remove("sv-active");
    if (view && typeof view.setTimeout === "function") view.setTimeout(clear, 1000);
    else clear();
    return true;
  } catch {
    return false;
  }
}

// Persistent SELECT mirror of revealAnchorInDoc: paint the UI-blue `.sv-selected`
// highlight on the element for `anchorId` (the host's currently focused anchor) and
// clear it from any previously-selected element, so exactly one anchor reads as
// selected at a time. Passing an empty/undefined id just clears the selection.
// Framework-free + try/catch for the same cross-realm reasons as revealAnchorInDoc.
export function setSelectedAnchorInDoc(root: ParentNode | null | undefined, anchorId: string | undefined): void {
  if (!root) return;
  try {
    root.querySelectorAll(".sv-selected").forEach((el) => el.classList.remove("sv-selected"));
    if (!anchorId) return;
    const el = root.querySelector(`[data-sv-key="${anchorId.replace(/"/g, '\\"')}"]`);
    if (el) el.classList.add("sv-selected");
  } catch {
    // realm torn down / unavailable — selection paint is best-effort.
  }
}

// Remove all highlights this layer painted under `root` (idempotent repaint).
// Unwraps the <mark>s created by highlightQuote and clears class/attr from any
// element-level highlights (e.g. study-id elements).
export function clearAnnotations(root: ParentNode): void {
  // Markers are no longer content children (they live in the view-layer overlay),
  // so there's nothing marker-related to strip here — just unwrap the highlight
  // <mark>s and clear element-level highlight class/attrs.
  root.querySelectorAll('mark[data-sv="1"]').forEach((mark) => {
    mark.replaceWith(mark.textContent ?? "");
  });
  root.querySelectorAll(".sv-annotated").forEach((el) => {
    el.classList.remove("sv-annotated");
    el.removeAttribute("data-sv-note");
    el.removeAttribute("data-sv-key");
    el.removeAttribute("data-sv-note-count");
    highlightPayloads.delete(el);
  });
}

// Re-find a passage by its text (W3C TextQuoteSelector) and wrap the first match
// in a highlighted <mark>. This is the durable, edit-resilient locator shared by
// the live webview guest AND the HTML reader's fallback — it needs no injected
// ids, only that the text still exists. Returns whether a match was highlighted.
export function highlightQuote(
  doc: Document,
  selector: TextQuoteSelector,
  noteText: string,
  key?: string,
  payload?: HighlightPayload
): boolean {
  if (!doc.body || !selector.exact) return false;
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const value = node.nodeValue ?? "";
    const hit = resolveTextQuote(value, selector);
    if (hit && node.parentElement && node.parentElement.tagName !== "MARK") {
      const range = doc.createRange();
      range.setStart(node, hit.start);
      range.setEnd(node, hit.end);
      const mark = doc.createElement("mark");
      mark.setAttribute("data-sv", "1");
      try {
        range.surroundContents(mark);
        applyHighlight(mark, noteText, key, payload);
        return true;
      } catch {
        // Range spans element boundaries; skip this occurrence.
      }
    }
    node = walker.nextNode();
  }
  return false;
}

// --- Marginalia layout -------------------------------------------------------
// Place note cards in a side gutter, each near its anchor's vertical position
// but never overlapping. Pure + deterministic so the stacking is unit-testable
// independently of the DOM (jsdom can't measure real geometry).
export interface ColumnItem {
  /** Desired top (the anchor's y); cards drift down from here to avoid overlap. */
  top: number;
  height: number;
}

// Two-pass label placement: greedily stack downward from `minTop`, then — if the
// column overflows `maxBottom` — compact upward from the bottom. Returns the
// resolved top for each item, in the SAME order as the input.
export function packColumn(items: ColumnItem[], gap: number, minTop: number, maxBottom?: number): number[] {
  const order = items.map((_, i) => i).sort((a, b) => items[a].top - items[b].top);
  const placed = new Array<number>(items.length).fill(minTop);

  let cursor = minTop;
  for (const i of order) {
    const top = Math.max(items[i].top, cursor);
    placed[i] = top;
    cursor = top + items[i].height + gap;
  }

  if (maxBottom !== undefined && order.length) {
    const last = order[order.length - 1];
    const overflow = placed[last] + items[last].height - maxBottom;
    if (overflow > 0) {
      let bottomCursor = maxBottom;
      for (let k = order.length - 1; k >= 0; k -= 1) {
        const i = order[k];
        const top = Math.max(minTop, Math.min(placed[i], bottomCursor - items[i].height));
        placed[i] = top;
        bottomCursor = top - gap;
      }
    }
  }
  return placed;
}

export interface MarginItem {
  element: Element;
  noteText: string;
  noteHtml?: string;
  noteCount?: number;
  key?: string;
}

const MARGIN_LAYER_ID = "sv-margin-layer";
const MARGIN_CONNECTORS_ID = "sv-margin-connectors";

// Remove the gutter, its cards, the connector overlay, and the reserved padding.
export function clearMarginNotes(doc: Document): void {
  doc.getElementById(MARGIN_LAYER_ID)?.remove();
  doc.getElementById(MARGIN_CONNECTORS_ID)?.remove();
  if (doc.body) {
    doc.body.classList.remove("sv-annot-margin");
    doc.body.style.position = doc.body.dataset.svPrevPosition ?? "";
    delete doc.body.dataset.svPrevPosition;
  }
}

// Lay out the given anchored elements' notes as persistent cards in a right-hand
// gutter, vertically near each anchor, collision-resolved, leaving the original
// content uncovered (the body reserves right padding). A dashed SVG connector
// links each card back to its anchor. Re-runnable (clears first).
export function paintMarginNotes(doc: Document, items: MarginItem[]): void {
  if (!doc.body) return;
  clearMarginNotes(doc);
  if (!items.length) return;

  const body = doc.body;
  const view = doc.defaultView;
  body.classList.add("sv-annot-margin");
  // Absolute children need a positioned ancestor; remember/restore the prior value.
  const computedPos = view?.getComputedStyle(body).position ?? "static";
  if (computedPos === "static") {
    body.dataset.svPrevPosition = body.style.position;
    body.style.position = "relative";
  }

  const bodyRect = body.getBoundingClientRect();
  const contentHeight = Math.max(body.scrollHeight, view?.innerHeight ?? 0);

  const layer = doc.createElement("div");
  layer.id = MARGIN_LAYER_ID;
  layer.style.height = `${contentHeight}px`;

  const svgNs = "http://www.w3.org/2000/svg";
  const connectors = doc.createElementNS(svgNs, "svg");
  connectors.id = MARGIN_CONNECTORS_ID;
  connectors.setAttribute("width", `${bodyRect.width}`);
  connectors.setAttribute("height", `${contentHeight}`);

  // First pass: create cards at their desired tops and measure heights.
  const placedCards = items.map(({ element, noteHtml, key }) => {
    const card = doc.createElement("div");
    card.className = "sv-margin-note";
    if (key) card.setAttribute("data-sv-key", key);
    const cardBody = doc.createElement("div");
    cardBody.className = "sv-margin-note-body";
    // Content-only: the sanctioned note preview HTML renders directly.
    cardBody.innerHTML = noteHtml ?? "";
    card.appendChild(cardBody);
    layer.appendChild(card);
    const elRect = element.getBoundingClientRect();
    return { card, desiredTop: elRect.top - bodyRect.top, anchorMidY: elRect.top - bodyRect.top + elRect.height / 2 };
  });
  body.appendChild(layer);

  const tops = packColumn(
    placedCards.map(({ card, desiredTop }) => ({ top: Math.max(0, desiredTop), height: card.offsetHeight || 60 })),
    10,
    0,
    contentHeight
  );

  // Gutter starts where the layer sits (body width minus the layer width).
  const gutterLeft = bodyRect.width - layer.offsetWidth;
  placedCards.forEach(({ card, anchorMidY }, i) => {
    card.style.top = `${tops[i]}px`;
    const cardMidY = tops[i] + (card.offsetHeight || 60) / 2;
    const path = doc.createElementNS(svgNs, "path");
    path.setAttribute("class", "sv-margin-connectors-path");
    // Elbow: out from the gutter edge, across, to the anchor's mid-line.
    path.setAttribute(
      "d",
      `M ${gutterLeft} ${cardMidY} L ${gutterLeft - 16} ${cardMidY} L ${gutterLeft - 16} ${anchorMidY} L ${gutterLeft - 28} ${anchorMidY}`
    );
    connectors.appendChild(path);
  });
  body.appendChild(connectors);
}
