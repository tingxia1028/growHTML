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
  type HighlightPayload,
  type MarginItem
} from "./annotationLayer";

// How the HTML reader presents notes:
//  - "floating": inline highlight + a card that pops on hover/click.
//  - "margin":   inline highlight + persistent cards laid out in a side gutter,
//                connected to their anchor, leaving the original text uncovered (default).
export type HtmlAnnotationMode = "floating" | "margin";
const MODE_STORAGE_KEY = "sv-annotation-mode";

// Read/write the persisted mode. The React layer (WorkspaceContext) owns the live
// mode state and threads it into decorateAnnotations(doc, { mode }); these helpers
// just seed that state from — and persist it to — localStorage so the choice
// survives reloads. Reading the stored value never throws (sandboxed realms).
export function readStoredAnnotationMode(): HtmlAnnotationMode {
  return "margin";
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
  previewHtml?: string;
  contentType?: string;
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
        resolved.map(({ element, noteText, noteHtml, noteCount, key }): MarginItem => ({
          element,
          noteText,
          noteHtml,
          noteCount,
          key
        }))
      );
    }
    // floating mode needs no extra work: the inline highlight + shared hover card
    // (wired by ensureAnnotationLayer) already cover it.
  }
};

// Resolve anchors to elements (study-id fast path, else edit-resilient text
// re-find), apply the inline highlight, and merge notes that land on the same
// element. The returned targets drive marginalia layout.
function notePayload(notes: AnnotationNote[]): { noteText: string; noteHtml: string; noteCount: number } {
  return {
    noteText: notes.map((note) => note.content).join("\n\n"),
    noteHtml: notes
      .map((note) => note.previewHtml)
      .filter((html): html is string => Boolean(html))
      .join(""),
    noteCount: notes.length
  };
}

function payloadFor(noteHtml: string, noteCount: number): HighlightPayload {
  return { noteHtml: noteHtml || undefined, noteCount };
}

function resolveTargets(
  doc: Document,
  items: AnchorNotes[]
): { element: Element; noteText: string; noteHtml: string; noteCount: number; key: string }[] {
  const byElement = new Map<Element, { lines: string[]; htmls: string[]; count: number; key: string }>();
  for (const { anchor, notes } of items) {
    const { noteText, noteHtml, noteCount } = notePayload(notes);
    const studyEl = anchor.studyId ? doc.querySelector(`[data-study-id="${cssEscape(anchor.studyId)}"]`) : null;
    if (studyEl) {
      const entry = byElement.get(studyEl) ?? { lines: [], htmls: [], count: 0, key: anchor.id };
      for (const note of notes) {
        entry.lines.push(note.content);
        if (note.previewHtml) entry.htmls.push(note.previewHtml);
        entry.count += 1;
      }
      byElement.set(studyEl, entry);
    } else if (anchor.quote) {
      highlightQuote(
        doc,
        { exact: anchor.quote, prefix: anchor.contextBefore ?? "", suffix: anchor.contextAfter ?? "" },
        noteText,
        anchor.id,
        payloadFor(noteHtml, noteCount)
      );
      const mark = doc.querySelector(`mark[data-sv="1"][data-sv-key="${cssEscape(anchor.id)}"]`);
      if (mark && !byElement.has(mark)) {
        byElement.set(mark, { lines: [noteText], htmls: [noteHtml], count: noteCount, key: anchor.id });
      }
    }
  }
  const out: { element: Element; noteText: string; noteHtml: string; noteCount: number; key: string }[] = [];
  for (const [element, { lines, htmls, count, key }] of byElement) {
    const noteText = lines.join("\n\n");
    const noteHtml = htmls.join("");
    applyHighlight(element, noteText, key, payloadFor(noteHtml, count));
    out.push({ element, noteText, noteHtml, noteCount: count, key });
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
