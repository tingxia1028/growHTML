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
  restorePinnedNoteCards,
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

// Global "显示锚点标记" switch (D2 amendment, 2026-07-04): the Anchor panel toggle
// hides EVERY anchor glyph chip across readers (note-slot chips stay). Same
// persistence idiom as the annotation mode above. The LIVE value is the
// markerOverlay module store (lazily seeded from readStoredAnchorGlyphVisibility),
// which every overlay in the realm subscribes to; the webview guest realm gets
// the value over the sv:anchors payload instead of its own storage.
const ANCHOR_GLYPH_STORAGE_KEY = "sv-anchor-glyph-markers";

export function readStoredAnchorGlyphVisibility(): boolean {
  try {
    return globalThis.localStorage?.getItem(ANCHOR_GLYPH_STORAGE_KEY) !== "hidden";
  } catch {
    return true; // storage unavailable — default to visible
  }
}

export function persistAnchorGlyphVisibility(visible: boolean): void {
  try {
    globalThis.localStorage?.setItem(ANCHOR_GLYPH_STORAGE_KEY, visible ? "shown" : "hidden");
  } catch {
    // storage unavailable — the in-memory overlay store still drives the paint.
  }
  notifyMarkerPrefsChanged();
}

// —— Realm-agnostic "marker prefs changed" bus (F-1 follow-up) ————————————————
// The live glyph/hide-all stores are now PER-REALM (keyed by the reader's document),
// so the host controls flip a SPECIFIC realm's store — there's no module-global flip
// event for the webview host-push (bindWebviewAnchors) to subscribe to, and the guest
// lives in a realm the host can't reach. Instead the host controls persist the choice
// (glyph = global, hide-all = per-source) and fire THIS bus; the webview push reads the
// freshest value straight from the persisted stores and re-sends it to the guest. This
// is a pure "something changed, re-read storage" ping — it carries no value.
const markerPrefsListeners = new Set<() => void>();

export function notifyMarkerPrefsChanged(): void {
  for (const listener of [...markerPrefsListeners]) listener();
}

export function subscribeMarkerPrefsChanged(listener: () => void): () => void {
  markerPrefsListeners.add(listener);
  return () => {
    markerPrefsListeners.delete(listener);
  };
}

// D11 hide-all — a PER-SOURCE "hide all notes" view flag (note-presentation-unified
// §10 D11). Device-local (localStorage), keyed by sourceId: the exported truth is
// each note's display.open, so a reader who hid everything still ships the author's
// pins. The LIVE value is the annotationLayer module store (isAllNotesHidden /
// setAllNotesHidden), which every card/overlay in the realm subscribes to; these
// helpers only seed it from — and persist it to — storage. Reading never throws.
const NOTES_HIDDEN_STORAGE_PREFIX = "sv-notes-hidden:";

export function readStoredNotesHidden(sourceId: string): boolean {
  if (!sourceId) return false;
  try {
    return globalThis.localStorage?.getItem(NOTES_HIDDEN_STORAGE_PREFIX + sourceId) === "hidden";
  } catch {
    return false; // storage unavailable — default to shown
  }
}

export function persistNotesHidden(sourceId: string, hidden: boolean): void {
  if (!sourceId) return;
  try {
    if (hidden) globalThis.localStorage?.setItem(NOTES_HIDDEN_STORAGE_PREFIX + sourceId, "hidden");
    else globalThis.localStorage?.removeItem(NOTES_HIDDEN_STORAGE_PREFIX + sourceId);
  } catch {
    // storage unavailable — the in-memory store still drives the paint.
  }
  // Wake the webview host-push (bindWebviewAnchors) so an already-painted guest re-reads
  // this source's hide-all flag and re-sends it (F-1 follow-up per-realm bus).
  notifyMarkerPrefsChanged();
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
    // ALWAYS routed through paintMarginNotes: margin mode paints the gutter;
    // floating mode passes [] so the margin memo clears (the per-anchor notes
    // toggle re-packs the gutter from that memo and must never resurrect a stale
    // margin layout after a mode switch). Floating needs no other work: the
    // inline highlight + shared hover card (ensureAnnotationLayer) cover it.
    paintMarginNotes(
      doc,
      mode === "margin"
        ? resolved.map(({ element, noteText, noteHtml, noteCount, key }): MarginItem => ({
            element,
            noteText,
            noteHtml,
            noteCount,
            key
          }))
        : []
    );
    // D10: in floating mode, re-pin any card the geometry store remembers as open
    // (margin mode already renders every note in the gutter — no floating pin).
    if (mode !== "margin") {
      restorePinnedNoteCards(
        doc,
        resolved.map(({ key }) => key).filter(Boolean)
      );
    }
  }
};

// Resolve anchors to elements (study-id fast path, else edit-resilient text
// re-find), apply the inline highlight, and merge notes that land on the same
// element. The returned targets drive marginalia layout.
function notePayload(notes: AnnotationNote[]): { noteText: string; noteHtml: string; noteCount: number; noteTypes: string[] } {
  return {
    noteText: notes.map((note) => note.content).join("\n\n"),
    noteHtml: notes
      .map((note) => note.previewHtml)
      .filter((html): html is string => Boolean(html))
      .join(""),
    noteCount: notes.length,
    noteTypes: notes.map((note) => note.contentType ?? "markdown")
  };
}

function payloadFor(noteHtml: string, noteCount: number, noteTypes: string[]): HighlightPayload {
  return { noteHtml: noteHtml || undefined, noteCount, noteTypes };
}

function resolveTargets(
  doc: Document,
  items: AnchorNotes[]
): { element: Element; noteText: string; noteHtml: string; noteCount: number; key: string }[] {
  const byElement = new Map<Element, { lines: string[]; htmls: string[]; types: string[]; count: number; key: string }>();
  for (const { anchor, notes } of items) {
    const { noteText, noteHtml, noteCount, noteTypes } = notePayload(notes);
    const studyEl = anchor.studyId ? doc.querySelector(`[data-study-id="${cssEscape(anchor.studyId)}"]`) : null;
    if (studyEl) {
      const entry = byElement.get(studyEl) ?? { lines: [], htmls: [], types: [], count: 0, key: anchor.id };
      for (const note of notes) {
        entry.lines.push(note.content);
        if (note.previewHtml) entry.htmls.push(note.previewHtml);
        entry.types.push(note.contentType ?? "markdown");
        entry.count += 1;
      }
      byElement.set(studyEl, entry);
    } else if (anchor.quote) {
      highlightQuote(
        doc,
        { exact: anchor.quote, prefix: anchor.contextBefore ?? "", suffix: anchor.contextAfter ?? "" },
        noteText,
        anchor.id,
        payloadFor(noteHtml, noteCount, noteTypes)
      );
      const mark = doc.querySelector(`mark[data-sv="1"][data-sv-key="${cssEscape(anchor.id)}"]`);
      if (mark && !byElement.has(mark)) {
        byElement.set(mark, { lines: [noteText], htmls: [noteHtml], types: noteTypes, count: noteCount, key: anchor.id });
      }
    }
  }
  const out: { element: Element; noteText: string; noteHtml: string; noteCount: number; key: string }[] = [];
  for (const [element, { lines, htmls, types, count, key }] of byElement) {
    const noteText = lines.join("\n\n");
    const noteHtml = htmls.join("");
    applyHighlight(element, noteText, key, payloadFor(noteHtml, count, types));
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
  for (const anchor of anchorById.values()) {
    if (!renderer.anchorKinds.includes(anchor.anchorKind)) continue;
    byAnchor.set(anchor.id, { anchor, notes: [] });
  }
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
