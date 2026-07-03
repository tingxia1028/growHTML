// Guest preload injected into the live page inside the <webview>. It captures
// text selections (as W3C TextQuoteSelectors) and reports them to the host, and
// highlights stored anchors the host sends back. Reuses the unit-tested
// textQuote helpers so the selector logic is trustworthy.
import { ipcRenderer } from "electron";
import {
  buildMarkerHtml,
  clearAnnotations,
  ensureAnnotationLayer,
  highlightQuote,
  revealAnchorInDoc,
  setSelectedAnchorInDoc
} from "../src/client/annotationLayer";

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

document.addEventListener("click", (event) => {
  const target = event.target as Element | null;
  const roleEl = target && typeof target.closest === "function" ? target.closest("[data-sv-marker-role]") : null;
  if (!roleEl) return;
  const chip = roleEl.closest(".sv-anchor-markers") as HTMLElement | null;
  const anchorId = chip?.getAttribute("data-sv-marker-for") ?? roleEl.closest("[data-sv-key]")?.getAttribute("data-sv-key");
  const role = roleEl.getAttribute("data-sv-marker-role");
  if (!anchorId || (role !== "anchor" && role !== "note")) return;
  ipcRenderer.sendToHost("sv:marker-action", { anchorId, role });
  if (role === "anchor") {
    event.preventDefault();
    event.stopPropagation();
  }
});

// The host's currently focused anchor id, so a repaint (sv:anchors) can re-apply the
// persistent blue "selected" highlight that clearAnnotations would otherwise wipe.
let selectedAnchorId: string | undefined;

ipcRenderer.on("sv:anchors", (_event, anchors: WebAnchorMsg[]) => {
  ensureAnnotationLayer(document);
  clearAnnotations(document.body);
  for (const anchor of anchors) {
    const painted = highlightQuote(
      document,
      { exact: anchor.quote, prefix: anchor.contextBefore, suffix: anchor.contextAfter },
      anchor.note ?? "",
      anchor.id,
      { noteHtml: anchor.noteHtml, noteCount: anchor.noteCount, noteTypes: anchor.noteTypes }
    );
    // Markers no longer paint into the content via applyHighlight. The guest is
    // flowing web text (no PDF text-layer transform), so we append the marker glyph
    // INLINE as a trailing child of the freshly-created <mark>. A dedicated guest
    // overlay (mirroring the PDF/image/HTML readers) is deferred.
    if (painted && anchor.id) {
      const mark = document.querySelector(`mark[data-sv="1"][data-sv-key="${anchor.id.replace(/"/g, '\\"')}"]`);
      if (mark) {
        const chip = document.createElement("span");
        chip.className = "sv-anchor-markers";
        chip.setAttribute("data-sv", "1");
        chip.setAttribute("data-sv-marker-for", anchor.id);
        chip.style.position = "static"; // inline flow, not overlay-positioned
        chip.style.marginLeft = "4px";
        chip.innerHTML = buildMarkerHtml({
          noteHtml: anchor.noteHtml,
          noteCount: anchor.noteCount,
          noteTypes: anchor.noteTypes
        });
        mark.appendChild(chip);
      }
    }
  }
  // Re-apply the selection after the repaint (the marks were just re-created).
  setSelectedAnchorInDoc(document, selectedAnchorId);
});

// The host asks us to scroll a painted anchor into view (a bookmark row / a
// multi-anchor jump button on a web or local-HTML source). We paint data-sv-key
// marks via highlightQuote above, so this delegates to the SAME shared helper —
// no scroll logic duplicated in the guest.
ipcRenderer.on("sv:reveal", (_event, anchorId: string) => revealAnchorInDoc(document, anchorId));

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
