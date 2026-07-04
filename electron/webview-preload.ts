// Guest preload injected into the live page inside the <webview>. It captures
// text selections (as W3C TextQuoteSelectors) and reports them to the host, and
// highlights stored anchors the host sends back. Reuses the unit-tested
// textQuote helpers so the selector logic is trustworthy.
//
// The guest realm is a full D1 ReaderAnnotationAdapter host (docs/design/
// note-presentation-unified.md §1): it paints via highlightQuote, mounts the SAME
// framework-free MarkerOverlay every other reader uses (on the guest body — the
// old divergent inline chip inside the <mark> is gone), and bridges marker clicks
// to the host over the existing sv:marker-action channel.
import { ipcRenderer } from "electron";
import {
  buildAnchorSlotHtml,
  buildNoteSlotHtml,
  clearAnnotations,
  ensureAnnotationLayer,
  highlightQuote,
  setSelectedAnchorInDoc
} from "../src/client/annotationLayer";
import {
  mountRealmMarkerOverlay,
  setAnchorGlyphVisibility,
  type MarkerItem,
  type MarkerOverlay
} from "../src/client/markerOverlay";
import { createDomRealmAdapter, type ReaderAnnotationAdapter } from "../src/client/surfaces/readerAnnotationAdapter";

type WebAnchorMsg = {
  id?: string;
  quote: string;
  contextBefore: string;
  contextAfter: string;
  note?: string;
  noteHtml?: string;
  noteCount?: number;
  noteTypes?: string[];
};

const CONTEXT = 32;

// Build prefix/suffix context by collapsing a clone of the selection range to its
// start (resp. end) and extending it to the surrounding text. This is robust to the
// selection's start/end containers being ELEMENTS rather than text nodes — e.g. a
// selectNodeContents() selection (or a paragraph-spanning drag), whose startOffset/
// endOffset are CHILD-NODE indices, not character offsets. The earlier code sliced
// the container's textContent by those offsets, so an element-level selection
// collapsed to a single character ("P" instead of the whole passage). We take the
// exact text straight from the range (always correct) and read context off the DOM.
function contextAround(range: Range, side: "before" | "after"): string {
  try {
    const probe = range.cloneRange();
    probe.collapse(side === "before");
    const root = range.commonAncestorContainer;
    const rootEl = (root.nodeType === Node.ELEMENT_NODE ? root : root.parentNode) as Element | null;
    if (!rootEl) return "";
    if (side === "before") {
      // From the start of the common ancestor up to the selection start.
      probe.setStart(rootEl, 0);
      return probe.toString().slice(-CONTEXT);
    }
    // From the selection end to the end of the common ancestor.
    probe.setEnd(rootEl, rootEl.childNodes.length);
    return probe.toString().slice(0, CONTEXT);
  } catch {
    return "";
  }
}

function reportSelection() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
  // The exact selected text — taken from the selection itself, never re-sliced by
  // node offsets (which are child indices when the container is an element).
  const exact = selection.toString();
  if (!exact.trim()) return;

  const range = selection.getRangeAt(0);
  ipcRenderer.sendToHost("sv:selection", {
    exact,
    prefix: contextAround(range, "before"),
    suffix: contextAround(range, "after")
  });
}

document.addEventListener("mouseup", reportSelection);
document.addEventListener("keyup", reportSelection);

// Chrome-ish tabs: a link click opens a NEW tab in the host instead of navigating
// this page away. Capture phase so we win before the page's own handlers. Only
// cross-document http(s) links — in-page #fragments and mailto:/javascript: behave
// normally. The host (WebviewReader) creates the tab from sv:open-tab.
document.addEventListener(
  "click",
  (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) return;
    const target = event.target as Element | null;
    const link = target && typeof target.closest === "function" ? target.closest("a[href]") : null;
    const href = link?.getAttribute("href") ? (link as HTMLAnchorElement).href : "";
    if (!/^https?:\/\//i.test(href)) return;
    if (href.split("#")[0] === window.location.href.split("#")[0]) return; // same-page anchor
    event.preventDefault();
    event.stopPropagation();
    ipcRenderer.sendToHost("sv:open-tab", href);
  },
  true
);

// The host's currently focused anchor id, so a repaint (sv:anchors) can re-apply the
// persistent blue "selected" highlight that clearAnnotations would otherwise wipe.
let selectedAnchorId: string | undefined;

// The guest realm's D1 annotation surface: the shared DOM-realm adapter over this
// document plus a REAL MarkerOverlay mounted on the guest body (the same
// framework-free module the DomReader iframe / PDF / image readers host). Built
// lazily on the first host message so document.body exists. Marker clicks are
// handled by the overlay itself and bridged to the host over the existing
// sv:marker-action channel; role "note" also synthesizes the anchor click that
// opens the shared in-guest note card (MarkerOverlay does both).
let guestSurface: { adapter: ReaderAnnotationAdapter<WebAnchorMsg>; overlay: MarkerOverlay } | null = null;

function ensureGuestSurface(): { adapter: ReaderAnnotationAdapter<WebAnchorMsg>; overlay: MarkerOverlay } {
  if (guestSurface) return guestSurface;
  const adapter = createDomRealmAdapter<WebAnchorMsg>({
    root: () => document,
    paint: paintGuestAnchors
  });
  const overlay = mountRealmMarkerOverlay(document, {
    adapter,
    onAction: ({ anchorId, role }) => ipcRenderer.sendToHost("sv:marker-action", { anchorId, role })
  });
  guestSurface = { adapter, overlay };
  return guestSurface;
}

function paintGuestAnchors(anchors: WebAnchorMsg[]): void {
  ensureAnnotationLayer(document);
  clearAnnotations(document.body);
  const markers: MarkerItem[] = [];
  for (const anchor of anchors) {
    const painted = highlightQuote(
      document,
      { exact: anchor.quote, prefix: anchor.contextBefore, suffix: anchor.contextAfter },
      anchor.note ?? "",
      anchor.id,
      { noteHtml: anchor.noteHtml, noteCount: anchor.noteCount, noteTypes: anchor.noteTypes }
    );
    // One pair of D2 slot chips per painted anchor — the SAME slot builders every
    // reader uses, hosted by the shared body-mounted overlay.
    if (painted && anchor.id) {
      markers.push({
        anchorId: anchor.id,
        anchorSlotHtml: buildAnchorSlotHtml(),
        noteSlotHtml: buildNoteSlotHtml({
          noteHtml: anchor.noteHtml,
          noteCount: anchor.noteCount,
          noteTypes: anchor.noteTypes
        })
      });
    }
  }
  ensureGuestSurface().overlay.setMarkers(markers);
  // Re-apply the selection after the repaint (the marks were just re-created).
  setSelectedAnchorInDoc(document, selectedAnchorId);
}

// Additive second payload on sv:anchors (see webviewSelection.ts WebAnchorPrefs):
// the host's global 显示锚点标记 switch. This bundle is its own realm, so the shared
// markerOverlay module store must be driven from here — the guest page's own
// localStorage never sees the host's persisted choice. Older hosts send no prefs;
// the default ("visible") stands.
type AnchorPrefsMsg = { anchorGlyphsVisible?: boolean };

ipcRenderer.on("sv:anchors", (_event, anchors: WebAnchorMsg[], prefs?: AnchorPrefsMsg) => {
  if (prefs && typeof prefs.anchorGlyphsVisible === "boolean") {
    setAnchorGlyphVisibility(prefs.anchorGlyphsVisible);
  }
  ensureGuestSurface().adapter.paint(anchors ?? []);
});

// The host asks us to scroll a painted anchor into view (a bookmark row / a
// multi-anchor jump button on a web or local-HTML source). We paint data-sv-key
// marks via highlightQuote above, so this delegates to the adapter's reveal —
// the SAME shared revealAnchorInDoc helper, no scroll logic duplicated here.
ipcRenderer.on("sv:reveal", (_event, anchorId: string) => ensureGuestSurface().adapter.reveal(anchorId));

// The host's focused anchor changed: paint the persistent blue "selected" highlight
// on it (clearing the previous one) — the SAME shared helper the iframe/PDF/image
// readers use, so the selection feedback is uniform across every surface. Remember the
// id so the next sv:anchors repaint re-applies it.
ipcRenderer.on("sv:select", (_event, anchorId: string | undefined) => {
  selectedAnchorId = anchorId || undefined;
  setSelectedAnchorInDoc(document, selectedAnchorId);
});

// Tell the host we're ready so it can push existing anchors.
window.addEventListener("DOMContentLoaded", () => ipcRenderer.sendToHost("sv:ready", {}));
