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
  ensureAnnotationLayer,
  highlightQuote
} from "./annotationLayer";

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
  anchorId?: string;
  content: string;
}

export interface AnchorNotes {
  anchor: AnnotationAnchor;
  notes: AnnotationNote[];
}

export interface AnnotationContext {
  anchors: AnnotationAnchor[];
  notes: AnnotationNote[];
}

export interface AnnotationRenderer {
  id: string;
  /** Anchor kinds this renderer paints (e.g. ["html_selection"]). */
  anchorKinds: string[];
  /** Stylesheet injected once into the reader document, keyed by styleId. */
  styleId: string;
  css: string;
  /** Repaint decorations for the given anchors (already cleared by the driver). */
  paint(doc: Document, items: AnchorNotes[]): void;
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
  },
  paint(doc, items) {
    ensureAnnotationLayer(doc);
    // Track the merged note text + a stable key (first anchor id) per element, so
    // the floating card can remember this element's placement across shows.
    const byElement = new Map<Element, { lines: string[]; key: string }>();
    for (const { anchor, notes } of items) {
      // Joined as markdown (blank line between notes); the card renders it.
      const noteText = notes.map((note) => note.content).join("\n\n");
      const target = anchor.studyId ? doc.querySelector(`[data-study-id="${cssEscape(anchor.studyId)}"]`) : null;
      if (target) {
        // Fast path: the injected study-id still exists.
        const entry = byElement.get(target) ?? { lines: [], key: anchor.id };
        for (const note of notes) entry.lines.push(note.content);
        byElement.set(target, entry);
      } else if (anchor.quote) {
        // The study-id is gone (the HTML was edited / re-imported) — re-find the
        // passage by its text, so the note survives as long as the text does.
        highlightQuote(
          doc,
          { exact: anchor.quote, prefix: anchor.contextBefore ?? "", suffix: anchor.contextAfter ?? "" },
          noteText,
          anchor.id
        );
      }
    }
    for (const [element, { lines, key }] of byElement) {
      applyHighlight(element, lines.join("\n\n"), key);
    }
  }
};

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
    if (!note.anchorId) continue;
    const anchor = anchorById.get(note.anchorId);
    if (!anchor || !renderer.anchorKinds.includes(anchor.anchorKind)) continue;
    const entry = byAnchor.get(anchor.id) ?? { anchor, notes: [] };
    entry.notes.push(note);
    byAnchor.set(anchor.id, entry);
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
  const anchorById = new Map(context.anchors.map((anchor) => [anchor.id, anchor]));
  for (const renderer of renderers) {
    ensureStyle(doc, renderer);
    renderer.clear(doc);
    renderer.paint(doc, groupForRenderer(renderer, context.notes, anchorById));
  }
}

// Plugins register earlier so they take priority / paint alongside built-ins.
export function registerAnnotationRenderer(renderer: AnnotationRenderer) {
  renderers.unshift(renderer);
}

export function listAnnotationRenderers(): readonly AnnotationRenderer[] {
  return renderers;
}
