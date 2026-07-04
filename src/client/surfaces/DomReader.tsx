import { useEffect, useRef } from "react";
import { decorateAnnotations, type HtmlAnnotationMode } from "../annotations";
import { buildAnchorSlotHtml, buildNoteSlotHtml, setSelectedAnchorInDoc, type HighlightPayload } from "../annotationLayer";
import { MarkerOverlay, mountRealmMarkerOverlay } from "../markerOverlay";
import type { AnchorDraft } from "../focus/FocusContext";
import { publishSelectionRect, rectFromDomRect } from "../selection/selectionRect";
import { createDomRealmAdapter, type ReaderAnnotationAdapter } from "./readerAnnotationAdapter";
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
export function paintDomAnchors(
  doc: Document,
  anchors: PaintAnchor[],
  mode: HtmlAnnotationMode = "floating",
  overlay?: MarkerOverlay | null
): void {
  const htmlAnchors = anchorsOfKind(anchors, "html_selection");
  decorateAnnotations(doc, {
    // The registry re-keys notes under their anchor id; each preview becomes one
    // card so the source-viewer overlay matches the Notes panel card style.
    anchors: htmlAnchors.map((anchor) => ({
      id: anchor.id,
      anchorKind: anchor.anchorKind,
      studyId: anchor.studyId,
      quote: anchor.quote,
      contextBefore: anchor.contextBefore,
      contextAfter: anchor.contextAfter
    })),
    // Always map previews (converged paint path — no plain-text divergence). An
    // anchor with no previews contributes no note (it paints highlight + markers
    // but no card body), so HTML renders identically to the overlay readers.
    notes: htmlAnchors.flatMap((anchor) =>
      (anchor.notePreviews ?? []).map((preview) => ({
        anchorIds: [anchor.id],
        content: preview.text,
        previewHtml: preview.html,
        contentType: preview.contentType
      }))
    ),
    mode
  });
  // Drive the view-layer marker overlay from the same painted anchors, so HTML gets
  // the uniform D2 two-slot chips (siblings of the iframe body content) rather than
  // in-content children: the anchor glyph at the passage's first line + the
  // note-type icons at its last line.
  if (overlay) {
    overlay.setMarkers(
      htmlAnchors.map((anchor) => {
        const payload: HighlightPayload = {
          noteCount: anchor.notePreviews ? anchor.notePreviews.length : anchor.note ? 1 : 0,
          noteTypes: anchor.notePreviews?.map((preview) => preview.contentType) ?? []
        };
        return { anchorId: anchor.id, anchorSlotHtml: buildAnchorSlotHtml(), noteSlotHtml: buildNoteSlotHtml(payload) };
      })
    );
  }
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
  revealAnchors,
  onSelect,
  onMarkerAction,
  activeAnchorId,
  revealSeq,
  mode = "floating",
  onOpenUrl
}: DomReaderProps) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  // The iframe realm's D1 ReaderAnnotationAdapter + its view-layer marker overlay
  // (mounted on the iframe body). Re-created per document (a srcDoc reload replaces
  // contentDocument), so both are keyed on the doc they were built for.
  const adapterRef = useRef<ReaderAnnotationAdapter | null>(null);
  const markerOverlayRef = useRef<MarkerOverlay | null>(null);
  const markerOverlayDocRef = useRef<Document | null>(null);
  // Latest reveal target in a ref so bindFrame (run on iframe load, possibly AFTER
  // the first reveal effect) can reveal once the anchors are actually painted.
  const activeAnchorIdRef = useRef(activeAnchorId);
  activeAnchorIdRef.current = activeAnchorId;
  // Keep the latest callback + state in refs so the once-per-document listeners
  // (bound on load) always see current values.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onMarkerActionRef = useRef(onMarkerAction);
  onMarkerActionRef.current = onMarkerAction;
  const sourceIdRef = useRef(sourceId);
  sourceIdRef.current = sourceId;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const onOpenUrlRef = useRef(onOpenUrl);
  onOpenUrlRef.current = onOpenUrl;
  const revealAnchorsRef = useRef(revealAnchors ?? anchors);
  revealAnchorsRef.current = revealAnchors ?? anchors;

  function revealDomAnchor(doc: Document | null | undefined, anchorId: string | undefined): boolean {
    if (!doc || !anchorId) return false;
    // Fast path: the adapter's reveal (the shared revealAnchorInDoc over this realm).
    if (surfaceForDoc(doc).adapter.reveal(anchorId)) return true;
    const target = anchorsOfKind(revealAnchorsRef.current, "html_selection").find((anchor) => anchor.id === anchorId);
    if (!target) return false;

    const selector =
      target.studyId ? `[data-study-id="${target.studyId.replace(/"/g, '\\"')}"]` : undefined;
    const el = (selector ? doc.querySelector(selector) : null) as
      | (Element & { scrollIntoView?: Element["scrollIntoView"] })
      | null;
    if (!el) return false;
    try {
      el.scrollIntoView?.({ block: "center", inline: "nearest" });
    } catch {
      // jsdom / realm without scrollIntoView
    }
    el.classList.add("sv-active");
    const view = doc.defaultView;
    const clear = () => el.classList.remove("sv-active");
    if (view && typeof view.setTimeout === "function") view.setTimeout(clear, 1000);
    else clear();
    return true;
  }

  // Get (or lazily build) the D1 annotation surface — adapter + marker overlay —
  // for the CURRENT iframe document. A srcDoc reload swaps contentDocument, so a
  // stale surface is torn down and a fresh one mounted on the new body
  // (mountRealmMarkerOverlay forces the positioning context).
  function surfaceForDoc(doc: Document): { adapter: ReaderAnnotationAdapter; overlay: MarkerOverlay } {
    if (markerOverlayDocRef.current === doc && markerOverlayRef.current && adapterRef.current) {
      return { adapter: adapterRef.current, overlay: markerOverlayRef.current };
    }
    markerOverlayRef.current?.destroy();
    const adapter = createDomRealmAdapter({
      root: () => doc,
      // Paint = the shared DOM paint path (decorateAnnotations highlight + note
      // card) plus this realm's overlay chips; the overlay ref is read lazily so
      // the closure always drives the CURRENT overlay.
      paint: (paintList) => paintDomAnchors(doc, paintList, modeRef.current, markerOverlayRef.current)
    });
    const overlay = mountRealmMarkerOverlay(doc, {
      onAction: ({ anchorId, role }) => onMarkerActionRef.current?.(anchorId, role),
      adapter
    });
    adapterRef.current = adapter;
    markerOverlayRef.current = overlay;
    markerOverlayDocRef.current = doc;
    return { adapter, overlay };
  }

  // Bind selection capture + paint when the iframe document is ready. Called from
  // onLoad (fresh document) and re-runnable for the initial paint.
  function bindFrame() {
    const doc = frameRef.current?.contentDocument;
    // A srcDoc swap can transiently expose a replacement document with no body yet;
    // mounting the annotation surface on it would hand MarkerOverlay a null host
    // (observeDomLayout crash). The loaded document re-enters through onLoad.
    if (!doc || !doc.body) return;
    surfaceForDoc(doc).adapter.paint(anchors);
    // A reveal may have been requested before this fresh document painted (effect
    // ran first) — now that the data-sv-key elements exist, honor the pending one.
    if (activeAnchorIdRef.current) revealDomAnchor(doc, activeAnchorIdRef.current);
    // Re-apply the persistent blue "selected" highlight after a repaint (paint clears
    // it). Keeps the focused anchor visibly selected across re-paints / mode switches.
    setSelectedAnchorInDoc(doc, activeAnchorIdRef.current);
    if (boundSelectionDocuments.has(doc)) return;

    const onSelection = (event?: Event) => {
      const draft = readDomSelection(doc, sourceIdRef.current, event);
      if (draft) onSelectRef.current(draft);
      // Publish the selection's rect in HOST viewport coords for the floating toolbar:
      // the range rect is in the iframe's own space, so offset by the iframe element's
      // position. A collapsed/empty selection clears this realm's rect (toolbar hides).
      const selection = doc.getSelection();
      const collapsed = !selection || selection.isCollapsed || selection.rangeCount === 0 || !selection.toString().trim();
      const frameRect = frameRef.current?.getBoundingClientRect();
      const domRect = collapsed ? null : selection!.getRangeAt(0).getBoundingClientRect();
      publishSelectionRect(
        "iframe",
        rectFromDomRect(domRect, frameRect ? { left: frameRect.left, top: frameRect.top } : undefined)
      );
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
    // Same transitional-document guard as bindFrame: a mid-swap document with no
    // body must not get a surface (null overlay host); onLoad paints the real one.
    if (doc && doc.body) surfaceForDoc(doc).adapter.paint(anchors);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchors, srcDoc, mode]);

  // Tear the surface down when the reader unmounts.
  useEffect(() => {
    return () => {
      markerOverlayRef.current?.destroy();
      markerOverlayRef.current = null;
      markerOverlayDocRef.current = null;
      adapterRef.current = null;
    };
  }, []);

  // REVEAL: scroll the focused anchor into view (+ brief flash) via the one shared
  // helper. Keyed on revealSeq too so re-selecting the SAME anchor re-fires. Prop-
  // driven (no useFocus) so this stays unit-testable in jsdom.
  useEffect(() => {
    // Paint the persistent blue "selected" highlight on the focused anchor (and clear
    // it from the previously-selected one) on every change — including a change to
    // "none", which clears the selection. Runs regardless of revealSeq.
    setSelectedAnchorInDoc(frameRef.current?.contentDocument, activeAnchorId);
    if (!activeAnchorId) return;
    revealDomAnchor(frameRef.current?.contentDocument, activeAnchorId);
  }, [activeAnchorId, revealSeq]);

  return <iframe ref={frameRef} title="Source reader" srcDoc={srcDoc} onLoad={bindFrame} />;
}
