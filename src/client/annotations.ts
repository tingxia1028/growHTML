// AnnotationRenderer registry — the client-side plugin seam for painting stored
// notes onto a reader Document. Different sources/anchor kinds can register their
// own "how to draw an annotation" instead of hard-coding one decorate function.
//
// The driver (decorateAnnotations) owns the source-agnostic parts: inject each
// renderer's CSS once, clear prior decorations, group notes under their anchor,
// and hand each renderer only the anchors whose kind it claims. A renderer owns
// the DOM painting for its kinds. Built-in: the HTML study-id highlighter.

import {
  ANNOTATION_CSS,
  ANNOTATION_STYLE_ID,
  applyHighlight,
  clearAnnotations,
  clearMarginNotes,
  ensureAnnotationLayer,
  highlightQuote,
  paintMarginNotes,
  type MarginItem
} from "./annotationLayer";

// How the HTML reader presents notes:
//  - "floating": inline highlight + a card that pops on hover/click (default).
//  - "margin":   inline highlight + persistent cards laid out in a side gutter,
//                connected to their anchor, leaving the original text uncovered.
export type HtmlAnnotationMode = "floating" | "margin";
const MODE_STORAGE_KEY = "sv-annotation-mode";

// Read/write the persisted mode. The React layer (WorkspaceContext) owns the live
// mode state and threads it into decorateAnnotations(doc, { mode }); these helpers
// just seed that state from — and persist it to — localStorage so the choice
// survives reloads. Reading the stored value never throws (sandboxed realms).
export function readStoredAnnotationMode(): HtmlAnnotationMode {
  try {
    return globalThis.localStorage?.getItem(MODE_STORAGE_KEY) === "margin" ? "margin" : "floating";
  } catch {
    return "floating";
  }
}

export function persistAnnotationMode(mode: HtmlAnnotationMode): void {
  try {
    globalThis.localStorage?.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    // storage unavailable — the in-memory React state still drives the paint.
  }
}

// Minimal structural shapes so the registry doesn't couple to the full schemas;
// the real AnyAnchor / NoteRecord are assignable to these.
export interface AnnotationAnchor {
  id: string;
  anchorKind: string;
  studyId?: string;
  // W3C TextQuoteSelector (on every anchor) — the durable, edit-resilient locator.
  quote?: string;
  contextBefore?: string;
  contextAfter?: string;
}

export interface AnnotationNote {
  // A note can hang off several anchors; it paints under each one it claims.
  anchorIds?: string[];
  content: string;
}

export interface AnchorNotes {
  anchor: AnnotationAnchor;
  notes: AnnotationNote[];
}

export interface AnnotationContext {
  anchors: AnnotationAnchor[];
  notes: AnnotationNote[];
  /** How the HTML renderer presents notes (default "floating"). Threaded from the
      React layer so toggling re-decorates with the new look. */
  mode?: HtmlAnnotationMode;
}

export interface AnnotationRenderer {
  id: string;
  /** Anchor kinds this renderer paints (e.g. ["html_selection"]). */
  anchorKinds: string[];
  /** Stylesheet injected once into the reader document, keyed by styleId. */
  styleId: string;
  css: string;
  /** Repaint decorations for the given anchors (already cleared by the driver). */
  paint(doc: Document, items: AnchorNotes[], mode: HtmlAnnotationMode): void;
  /** Remove this renderer's previous decorations from the document. */
  clear(doc: Document): void;
}

function cssEscape(value: string): string {
  return value.replace(/"/g, '\\"');
}

// Built-in renderer: resolves an html_selection anchor to its [data-study-id]
// element, then delegates ALL presentation (highlight + floating card) to the
// shared annotationLayer — the same primitives the webview guest and PDF reader
// use. Resolution lives here (HTML-surface specific); the look does not. Notes
// resolving to the same element merge. This is just ONE look — other renderers
// can register a different presentation against the same seam.
const htmlHighlightRenderer: AnnotationRenderer = {
  id: "html-highlight",
  anchorKinds: ["html_selection"],
  styleId: ANNOTATION_STYLE_ID,
  css: ANNOTATION_CSS,
  clear(doc) {
    clearAnnotations(doc);
    clearMarginNotes(doc);
  },
  paint(doc, items, mode) {
    ensureAnnotationLayer(doc);
    // Resolve each anchor to its target element + merged note text, applying the
    // inline highlight as we go. Returns the resolved targets so the margin mode
    // can lay cards out next to them.
    const resolved = resolveTargets(doc, items);
    if (mode === "margin") {
      paintMarginNotes(
        doc,
        resolved.map(({ element, noteText, key }): MarginItem => ({ element, noteText, key }))
      );
    }
    // floating mode needs no extra work: the inline highlight + shared hover card
    // (wired by ensureAnnotationLayer) already cover it.
  }
};

// Resolve anchors to elements (study-id fast path, else edit-resilient text
// re-find), apply the inline highlight, and merge notes that land on the same
// element. The returned targets drive marginalia layout.
function resolveTargets(doc: Document, items: AnchorNotes[]): { element: Element; noteText: string; key: string }[] {
  const byElement = new Map<Element, { lines: string[]; key: string }>();
  for (const { anchor, notes } of items) {
    // Joined as markdown (blank line between notes); the card renders it.
    const noteText = notes.map((note) => note.content).join("\n\n");
    const studyEl = anchor.studyId ? doc.querySelector(`[data-study-id="${cssEscape(anchor.studyId)}"]`) : null;
    if (studyEl) {
      // Fast path: the injected study-id still exists.
      const entry = byElement.get(studyEl) ?? { lines: [], key: anchor.id };
      for (const note of notes) entry.lines.push(note.content);
      byElement.set(studyEl, entry);
    } else if (anchor.quote) {
      // study-id gone (HTML edited / re-imported) — re-find by text so the note
      // survives as long as the text does; the wrapped <mark> becomes the target.
      highlightQuote(
        doc,
        { exact: anchor.quote, prefix: anchor.contextBefore ?? "", suffix: anchor.contextAfter ?? "" },
        noteText,
        anchor.id
      );
      const mark = doc.querySelector(`mark[data-sv="1"][data-sv-key="${cssEscape(anchor.id)}"]`);
      if (mark && !byElement.has(mark)) byElement.set(mark, { lines: [noteText], key: anchor.id });
    }
  }
  // Apply (or refresh) the inline highlight on every resolved element.
  const out: { element: Element; noteText: string; key: string }[] = [];
  for (const [element, { lines, key }] of byElement) {
    const noteText = lines.join("\n\n");
    applyHighlight(element, noteText, key);
    out.push({ element, noteText, key });
  }
  return out;
}

const renderers: AnnotationRenderer[] = [htmlHighlightRenderer];

// Group notes under the anchor they target, keeping only anchors whose kind this
// renderer claims. Pure — the unit-testable core of the dispatch.
export function groupForRenderer(
  renderer: AnnotationRenderer,
  notes: AnnotationNote[],
  anchorById: Map<string, AnnotationAnchor>
): AnchorNotes[] {
  const byAnchor = new Map<string, AnchorNotes>();
  for (const note of notes) {
    for (const anchorId of note.anchorIds ?? []) {
      const anchor = anchorById.get(anchorId);
      if (!anchor || !renderer.anchorKinds.includes(anchor.anchorKind)) continue;
      const entry = byAnchor.get(anchor.id) ?? { anchor, notes: [] };
      entry.notes.push(note);
      byAnchor.set(anchor.id, entry);
    }
  }
  return [...byAnchor.values()];
}

function ensureStyle(doc: Document, renderer: AnnotationRenderer) {
  if (doc.getElementById(renderer.styleId)) return;
  const style = doc.createElement("style");
  style.id = renderer.styleId;
  style.textContent = renderer.css;
  doc.head.appendChild(style);
}

// Drive every registered renderer over the document: inject CSS once, clear, and
// repaint with only the anchors+notes it claims. Idempotent.
export function decorateAnnotations(doc: Document, context: AnnotationContext) {
  if (!doc.head) return;
  const mode: HtmlAnnotationMode = context.mode ?? "floating";
  const anchorById = new Map(context.anchors.map((anchor) => [anchor.id, anchor]));
  for (const renderer of renderers) {
    ensureStyle(doc, renderer);
    renderer.clear(doc);
    renderer.paint(doc, groupForRenderer(renderer, context.notes, anchorById), mode);
  }
}

// Plugins register earlier so they take priority / paint alongside built-ins.
export function registerAnnotationRenderer(renderer: AnnotationRenderer) {
  renderers.unshift(renderer);
}

export function listAnnotationRenderers(): readonly AnnotationRenderer[] {
  return renderers;
}
