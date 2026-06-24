import { useEffect, useRef } from "react";
import { decorateAnnotations, type HtmlAnnotationMode } from "../annotations";
import type { AnchorDraft } from "../focus/FocusContext";
import { anchorsOfKind, type PaintAnchor, type SurfaceReaderProps } from "./types";

// DOM surface adapter — the imported-HTML / markdown reader.
//
// This surface is the rendered HTML study pipeline: server-rendered HTML (with
// injected `data-study-id`s) shown in an iframe whose `contentDocument` the host
// owns directly. Unlike the webview surface, there's no IPC — we read the
// selection straight off the iframe document and paint highlights straight onto
// it. All of that selection + paint logic used to live in App.tsx (bindReaderFrame
// / decorateNotes); it now lives here so the host just renders <DomReader
// srcDoc=… anchors=… onSelect=… /> like every other reader.
//
// READ : a text selection → AnchorDraft { mode:"quote", kind:"html", studyId, … }.
// WRITE: paints html_selection anchors via the AnnotationRenderer registry
//        (decorateAnnotations → the shared highlight + hover note-card).

type DomReaderProps = SurfaceReaderProps & {
  // The server-rendered HTML for the active source (study-id injected).
  srcDoc: string;
  // The active source id — stamped onto emitted drafts.
  sourceId: string;
  // How notes are presented: "floating" hover card (default) or "margin" gutter.
  // Threaded from the workspace so the reader-header toggle repaints this surface.
  mode?: HtmlAnnotationMode;
};

const CONTEXT = 32;

// One WeakSet across all DomReader instances: a srcDoc iframe's contentDocument is
// replaced on every navigation, so binding is keyed on the document identity, not
// the component. Prevents double-binding the same live document.
const boundSelectionDocuments = new WeakSet<Document>();

// Translate the host paintAnchors into the AnnotationRenderer registry's shape and
// paint the html_selection ones onto the reader document (highlight + note card,
// or — in "margin" mode — gutter cards). Exported pure-ish so the paint contract
// can be unit-tested with a jsdom Document.
export function paintDomAnchors(doc: Document, anchors: PaintAnchor[], mode: HtmlAnnotationMode = "floating"): void {
  const htmlAnchors = anchorsOfKind(anchors, "html_selection");
  decorateAnnotations(doc, {
    // The registry re-keys notes under their anchor id; we synthesize one note per
    // anchor carrying its merged text so the existing grouping/painting is reused.
    anchors: htmlAnchors.map((anchor) => ({
      id: anchor.id,
      anchorKind: anchor.anchorKind,
      studyId: anchor.studyId,
      quote: anchor.quote,
      contextBefore: anchor.contextBefore,
      contextAfter: anchor.contextAfter
    })),
    notes: htmlAnchors.map((anchor) => ({ anchorIds: [anchor.id], content: anchor.note })),
    mode
  });
}

// Read the user's selection in the reader document and emit a normalized html quote
// draft. Pure except for the DOM read; exported so the selection→draft mapping can
// be unit-tested against a jsdom document without React.
export function readDomSelection(doc: Document, sourceId: string, event?: Event): AnchorDraft | null {
  const selected = doc.getSelection();
  const text = selected?.toString().trim() ?? "";
  const frameNode = doc.defaultView?.Node ?? Node;
  const frameElement = doc.defaultView?.Element ?? Element;
  const selectedElement =
    selected && text && selected.rangeCount > 0
      ? (() => {
          const node = selected.getRangeAt(0).commonAncestorContainer;
          return node.nodeType === frameNode.ELEMENT_NODE ? (node as Element) : node.parentElement;
        })()
      : null;
  const eventElement = event?.target instanceof frameElement ? event.target : null;
  const element = selectedElement ?? eventElement;
  const target = element?.closest("[data-study-id]");
  const studyId = target?.getAttribute("data-study-id");
  if (!target || !studyId) return null;

  const quote = text || target.textContent?.trim() || "";
  if (!quote) return null;

  const docText = (doc.body?.textContent ?? "").replace(/\s+/g, " ");
  const normalizedQuote = quote.replace(/\s+/g, " ");
  const at = docText.indexOf(normalizedQuote);
  const prefix = at >= 0 ? docText.slice(Math.max(0, at - CONTEXT), at) : "";
  const suffix = at >= 0 ? docText.slice(at + normalizedQuote.length, at + normalizedQuote.length + CONTEXT) : "";

  return {
    mode: "quote",
    sourceId,
    kind: "html",
    quote,
    studyId,
    selector: `[data-study-id="${studyId.replace(/"/g, '\\"')}"]`,
    prefix,
    suffix
  };
}

export function DomReader({ srcDoc, sourceId, anchors, onSelect, mode = "floating" }: DomReaderProps) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  // Keep the latest callback + state in refs so the once-per-document listeners
  // (bound on load) always see current values.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const sourceIdRef = useRef(sourceId);
  sourceIdRef.current = sourceId;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  // Bind selection capture + paint when the iframe document is ready. Called from
  // onLoad (fresh document) and re-runnable for the initial paint.
  function bindFrame() {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    paintDomAnchors(doc, anchors, modeRef.current);
    if (boundSelectionDocuments.has(doc)) return;

    const onSelection = (event?: Event) => {
      const draft = readDomSelection(doc, sourceIdRef.current, event);
      if (draft) onSelectRef.current(draft);
    };
    boundSelectionDocuments.add(doc);
    doc.addEventListener("selectionchange", onSelection);
    doc.addEventListener("mouseup", onSelection);
    doc.addEventListener("click", onSelection);
    doc.addEventListener("keyup", onSelection);
  }

  // Re-paint whenever the anchor set, the document, or the note-presentation mode
  // changes — so toggling Floating ↔ Margin re-decorates this surface immediately.
  useEffect(() => {
    const doc = frameRef.current?.contentDocument;
    if (doc) paintDomAnchors(doc, anchors, mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchors, srcDoc, mode]);

  return <iframe ref={frameRef} title="Source reader" srcDoc={srcDoc} onLoad={bindFrame} />;
}
