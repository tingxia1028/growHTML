import { useEffect, useRef } from "react";
import { decorateAnnotations, type HtmlAnnotationMode } from "../annotations";
import { revealAnchorInDoc, setSelectedAnchorInDoc } from "../annotationLayer";
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
  // Optional: intercept in-page link clicks (http/https) and hand the URL up instead
  // of letting the iframe navigate. The unified Web viewer uses this so clicking a
  // link in a snapshot opens it as a LIVE tab. Omitted = links behave as before.
  onOpenUrl?: (url: string) => void;
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

export function DomReader({
  srcDoc,
  sourceId,
  anchors,
  onSelect,
  activeAnchorId,
  revealSeq,
  mode = "floating",
  onOpenUrl
}: DomReaderProps) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  // Latest reveal target in a ref so bindFrame (run on iframe load, possibly AFTER
  // the first reveal effect) can reveal once the anchors are actually painted.
  const activeAnchorIdRef = useRef(activeAnchorId);
  activeAnchorIdRef.current = activeAnchorId;
  // Keep the latest callback + state in refs so the once-per-document listeners
  // (bound on load) always see current values.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const sourceIdRef = useRef(sourceId);
  sourceIdRef.current = sourceId;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const onOpenUrlRef = useRef(onOpenUrl);
  onOpenUrlRef.current = onOpenUrl;

  // Bind selection capture + paint when the iframe document is ready. Called from
  // onLoad (fresh document) and re-runnable for the initial paint.
  function bindFrame() {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    paintDomAnchors(doc, anchors, modeRef.current);
    // A reveal may have been requested before this fresh document painted (effect
    // ran first) — now that the data-sv-key elements exist, honor the pending one.
    if (activeAnchorIdRef.current) revealAnchorInDoc(doc, activeAnchorIdRef.current);
    // Re-apply the persistent blue "selected" highlight after a repaint (paint clears
    // it). Keeps the focused anchor visibly selected across re-paints / mode switches.
    setSelectedAnchorInDoc(doc, activeAnchorIdRef.current);
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

    // Link interception (only when the host wants it): a plain click on an http(s)
    // link is handed up (→ open as a live tab) instead of navigating the iframe. Run
    // in the capture phase so it pre-empts the iframe's own navigation; left/no-mod
    // clicks only, so ctrl/cmd-click and selection still behave normally.
    const onLinkClick = (event: MouseEvent) => {
      const open = onOpenUrlRef.current;
      if (!open || event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const node = event.target as Element | null;
      const link = node?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link) return;
      const href = link.getAttribute("href") ?? "";
      if (!href || href.startsWith("#")) return;
      let resolved = href;
      try {
        resolved = new URL(href, link.baseURI).toString();
      } catch {
        return;
      }
      if (!/^https?:\/\//i.test(resolved)) return;
      event.preventDefault();
      open(resolved);
    };
    doc.addEventListener("click", onLinkClick, true);
  }

  // Re-paint whenever the anchor set, the document, or the note-presentation mode
  // changes — so toggling Floating ↔ Margin re-decorates this surface immediately.
  useEffect(() => {
    const doc = frameRef.current?.contentDocument;
    if (doc) paintDomAnchors(doc, anchors, mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchors, srcDoc, mode]);

  // REVEAL: scroll the focused anchor into view (+ brief flash) via the one shared
  // helper. Keyed on revealSeq too so re-selecting the SAME anchor re-fires. Prop-
  // driven (no useFocus) so this stays unit-testable in jsdom.
  useEffect(() => {
    // Paint the persistent blue "selected" highlight on the focused anchor (and clear
    // it from the previously-selected one) on every change — including a change to
    // "none", which clears the selection. Runs regardless of revealSeq.
    setSelectedAnchorInDoc(frameRef.current?.contentDocument, activeAnchorId);
    if (!activeAnchorId) return;
    revealAnchorInDoc(frameRef.current?.contentDocument, activeAnchorId);
  }, [activeAnchorId, revealSeq]);

  return <iframe ref={frameRef} title="Source reader" srcDoc={srcDoc} onLoad={bindFrame} />;
}
