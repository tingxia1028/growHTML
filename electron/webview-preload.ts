// Guest preload injected into the live page inside the <webview>. It captures
// text selections (as W3C TextQuoteSelectors) and reports them to the host, and
// highlights stored anchors the host sends back. Reuses the unit-tested
// textQuote helpers so the selector logic is trustworthy.
import { ipcRenderer } from "electron";
import { createTextQuoteSelector } from "../src/adapters/web/textQuote";
import { clearAnnotations, ensureAnnotationLayer, highlightQuote } from "../src/client/annotationLayer";

type WebAnchorMsg = { id?: string; quote: string; contextBefore: string; contextAfter: string; note?: string };

function reportSelection() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
  const exact = selection.toString();
  if (!exact.trim()) return;

  const range = selection.getRangeAt(0);
  const container = range.startContainer;
  const text = container.textContent ?? exact;
  const start = range.startOffset;
  const end =
    range.startContainer === range.endContainer ? range.endOffset : Math.min(text.length, start + exact.length);
  const selector = createTextQuoteSelector(text, start, end);

  ipcRenderer.sendToHost("sv:selection", {
    exact: selector.exact || exact,
    prefix: selector.prefix,
    suffix: selector.suffix
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

ipcRenderer.on("sv:anchors", (_event, anchors: WebAnchorMsg[]) => {
  ensureAnnotationLayer(document);
  clearAnnotations(document.body);
  for (const anchor of anchors) {
    highlightQuote(
      document,
      { exact: anchor.quote, prefix: anchor.contextBefore, suffix: anchor.contextAfter },
      anchor.note ?? "",
      anchor.id
    );
  }
});

// Tell the host we're ready so it can push existing anchors.
window.addEventListener("DOMContentLoaded", () => ipcRenderer.sendToHost("sv:ready", {}));
