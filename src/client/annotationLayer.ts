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
import { renderNoteContent } from "../adapters/notes/render";
import { resolveTextQuote, type TextQuoteSelector } from "../adapters/web/textQuote";

export const ANNOTATION_STYLE_ID = "sv-annot-style";

export const ANNOTATION_CSS = `
.sv-annotated {
  background: rgba(255, 213, 79, 0.4);
  box-shadow: inset 0 -2px 0 #f0a500;
  cursor: pointer;
}
/* Transient "we just jumped here" pulse, applied by revealAnchorInDoc on a
   jump-to-anchor (bookmark row / multi-anchor jump) then removed after ~1s. A
   ring + glow distinct from the persistent .sv-annotated highlight. */
.sv-active {
  outline: 2px solid #f0a500 !important;
  outline-offset: 1px;
  box-shadow: 0 0 0 3px rgba(240, 165, 0, 0.45), inset 0 -2px 0 #f0a500 !important;
  transition: outline-color 0.25s ease, box-shadow 0.25s ease;
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
  background: #fffdf5;
  color: #202124;
  border: 1px solid #e6c463;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.18);
  font: 13px/1.5 Inter, "Segoe UI", Arial, sans-serif;
}
#sv-note-card.sv-note-card-show {
  display: flex;
}
.sv-note-card-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: 0 0 auto;
  padding: 5px 4px 5px 9px;
  cursor: move;
  user-select: none;
  background: #f3e7bf;
  border-bottom: 1px solid #e6c463;
  border-radius: 8px 8px 0 0;
}
.sv-note-card-grip {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: #6b5a1e;
}
.sv-note-card-close {
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  color: #6b5a1e;
  padding: 0 6px;
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
  background: #efe9dc;
  padding: 0 3px;
  border-radius: 3px;
}
.sv-note-card-body hr { border: 0; border-top: 1px solid #e6dcc0; margin: 8px 0; }

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
  stroke: #e0a800;
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
  background: #fffdf5;
  color: #202124;
  border: 1px solid #e6c463;
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
.sv-margin-note-body code { background: #efe9dc; padding: 0 3px; border-radius: 3px; }`;

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
// where it was dragged and how it was resized for THAT key, restored on next
// show. Stored in the reader realm's localStorage so it survives reloads.
export interface CardGeom {
  left: number;
  top: number;
  width: number;
  height: number;
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
      return { left: parsed.left, top: parsed.top, width: parsed.width, height: parsed.height };
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

  // A draggable / resizable mini-window: title bar (drag handle + close) over a
  // scrollable body that renders the note as markdown preview (not raw text).
  const card = doc.createElement("div");
  card.id = "sv-note-card";
  card.setAttribute("data-sv", "1");
  const bar = doc.createElement("div");
  bar.className = "sv-note-card-bar";
  const grip = doc.createElement("span");
  grip.className = "sv-note-card-grip";
  grip.textContent = "⠿ note";
  const closeBtn = doc.createElement("button");
  closeBtn.className = "sv-note-card-close";
  closeBtn.type = "button";
  closeBtn.textContent = "×";
  bar.appendChild(grip);
  bar.appendChild(closeBtn);
  const body = doc.createElement("div");
  body.className = "sv-note-card-body";
  card.appendChild(bar);
  card.appendChild(body);
  doc.body.appendChild(card);

  let pinned = false;
  let currentKey = ""; // the data-sv-key of the anchor the card currently shows

  // Persist the card's current rect for the active key (drag / resize end).
  const persistGeom = () => {
    if (!currentKey) return;
    const rect = card.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return; // not laid out (e.g. jsdom)
    writeCardGeom(doc, currentKey, { left: rect.left, top: rect.top, width: rect.width, height: rect.height });
  };

  const show = (target: Element) => {
    currentKey = target.getAttribute("data-sv-key") ?? "";
    body.innerHTML = renderNoteContent("markdown", target.getAttribute("data-sv-note") ?? "").html;
    const view = doc.defaultView;
    const saved = currentKey ? readCardGeom(doc, currentKey) : null;
    if (saved && view) {
      // Restore the remembered placement + size for this anchor.
      const g = clampGeom(saved, view.innerWidth, view.innerHeight);
      card.style.left = `${g.left}px`;
      card.style.top = `${g.top}px`;
      card.style.width = `${g.width}px`;
      card.style.height = `${g.height}px`;
    } else {
      // First time for this anchor: anchor the card under the highlight. Fixed
      // positioning + viewport rect works whether the doc scrolls the window
      // (iframe / webview guest) or an inner container (PDF).
      const rect = target.getBoundingClientRect();
      card.style.left = `${Math.max(8, rect.left)}px`;
      card.style.top = `${rect.bottom + 6}px`;
    }
    card.classList.add("sv-note-card-show");
  };
  const hide = () => {
    if (!pinned) card.classList.remove("sv-note-card-show");
  };
  const dismiss = () => {
    pinned = false;
    card.classList.remove("sv-note-card-show");
  };

  // Remember user resizes (CSS `resize: both`) for the active key.
  const view = doc.defaultView as (Window & { ResizeObserver?: typeof ResizeObserver }) | null;
  if (view && typeof view.ResizeObserver === "function") {
    const ro = new view.ResizeObserver(() => {
      if (card.classList.contains("sv-note-card-show")) persistGeom();
    });
    ro.observe(card);
  }

  // In marginalia mode the notes live in the gutter, so the hover card is off.
  const marginActive = () => doc.body?.classList.contains("sv-annot-margin") ?? false;

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
  closeBtn.addEventListener("click", dismiss);
  doc.addEventListener("click", (event) => {
    if (marginActive()) return;
    const target = closestMatch(event.target, ".sv-annotated");
    if (target) {
      pinned = !pinned;
      if (pinned) {
        show(target);
      } else {
        card.classList.remove("sv-note-card-show");
      }
      return;
    }
    if (!closestMatch(event.target, "#sv-note-card")) dismiss();
  });

  // Drag by the title bar (pins so it survives the pointer leaving the highlight).
  bar.addEventListener("mousedown", (event) => {
    const start = event as MouseEvent;
    if (closestMatch(start.target, ".sv-note-card-close")) return;
    pinned = true;
    const rect = card.getBoundingClientRect();
    const offsetX = start.clientX - rect.left;
    const offsetY = start.clientY - rect.top;
    const onMove = (move: Event) => {
      const m = move as MouseEvent;
      card.style.left = `${m.clientX - offsetX}px`;
      card.style.top = `${m.clientY - offsetY}px`;
    };
    const onUp = () => {
      doc.removeEventListener("mousemove", onMove);
      doc.removeEventListener("mouseup", onUp);
      persistGeom(); // remember where it was dropped
    };
    doc.addEventListener("mousemove", onMove);
    doc.addEventListener("mouseup", onUp);
    start.preventDefault();
  });
}

// Mark an already-resolved element as annotated and stash the note text for the
// card. `noteText` may be empty (highlight only).
export function applyHighlight(element: Element, noteText: string, key?: string): void {
  element.classList.add("sv-annotated");
  if (noteText) element.setAttribute("data-sv-note", noteText);
  // Stable id → the card remembers this anchor's placement/size across shows.
  if (key) element.setAttribute("data-sv-key", key);
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

// Remove all highlights this layer painted under `root` (idempotent repaint).
// Unwraps the <mark>s created by highlightQuote and clears class/attr from any
// element-level highlights (e.g. study-id elements).
export function clearAnnotations(root: ParentNode): void {
  root.querySelectorAll('mark[data-sv="1"]').forEach((mark) => {
    mark.replaceWith(mark.textContent ?? "");
  });
  root.querySelectorAll(".sv-annotated").forEach((el) => {
    el.classList.remove("sv-annotated");
    el.removeAttribute("data-sv-note");
    el.removeAttribute("data-sv-key");
  });
}

// Re-find a passage by its text (W3C TextQuoteSelector) and wrap the first match
// in a highlighted <mark>. This is the durable, edit-resilient locator shared by
// the live webview guest AND the HTML reader's fallback — it needs no injected
// ids, only that the text still exists. Returns whether a match was highlighted.
export function highlightQuote(doc: Document, selector: TextQuoteSelector, noteText: string, key?: string): boolean {
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
        applyHighlight(mark, noteText, key);
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
  const placedCards = items.map(({ element, noteText, key }) => {
    const card = doc.createElement("div");
    card.className = "sv-margin-note";
    if (key) card.setAttribute("data-sv-key", key);
    const cardBody = doc.createElement("div");
    cardBody.className = "sv-margin-note-body";
    cardBody.innerHTML = renderNoteContent("markdown", noteText).html;
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
