import { useEffect, useRef } from "react";
import {
  bindWebviewAnchors,
  bindWebviewSelection,
  toWebAnchorMsgs,
  webSelectionToDraft,
  type SelectionWebview,
  type WebAnchorMsg
} from "./selection/webviewSelection";
import { anchorsOfKind, type SurfaceReaderProps } from "./surfaces/types";

// Local-HTML webview surface adapter. Renders a local HTML page (served from its
// original directory by /api/local) in a single isolated Electron <webview> — a
// real, persistent browser view. It's never torn down or swapped: clicking links
// inside the page navigates it natively, and switching files navigates it via
// loadURL(). Both are ordinary in-view navigations, so Chromium's paint-holding
// keeps the old page visible until the new one paints — exactly how a browser tab
// avoids flashing. Being a separate WebContents, it also can't reach the host app.
//
// It conforms to the SAME surface contract as every other reader:
//   READ : a guest text selection → AnchorDraft { mode:"quote", kind:"web", url } —
//          keyed by THIS file's /api/local url (its `src`). Local HTML is stored raw
//          with no study-ids, so it can't be an html_selection; web_text_quote reuses
//          the same TextQuoteSelector infra as live web pages.
//   WRITE: paint web_text_quote anchors via sv:anchors (shared with WebviewReader).
// The only real difference from WebviewReader is single fixed page vs. multi-tab+nav.

type WebviewEl = SelectionWebview & {
  loadURL: (url: string) => Promise<void>;
  executeJavaScript: (code: string) => Promise<unknown>;
};

type LocalHtmlReaderProps = SurfaceReaderProps & {
  // The /api/local url of the local HTML file (its path mirrors the file's absolute
  // path so relative assets resolve). Also the URL emitted drafts are keyed by.
  src: string;
  // The active source id — stamped onto emitted drafts.
  sourceId: string;
};

// Read the loaded page's effective background color (body, else <html>).
const READ_BG =
  "(function(){var b=getComputedStyle(document.body).backgroundColor;" +
  "if(b&&b!=='rgba(0, 0, 0, 0)'&&b!=='transparent')return b;" +
  "var h=getComputedStyle(document.documentElement).backgroundColor;" +
  "if(h&&h!=='rgba(0, 0, 0, 0)'&&h!=='transparent')return h;return '';})()";

function absolute(src: string): string {
  if (/^[a-z]+:\/\//i.test(src)) return src;
  return (typeof window !== "undefined" ? window.location.origin : "") + src;
}

export function LocalHtmlReader({ src, sourceId, anchors, onSelect }: LocalHtmlReaderProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<WebviewEl | null>(null);
  const readyRef = useRef(false);
  const lastSrc = useRef<string>("");
  // Keep the latest props in refs so the once-bound listeners stay current.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const srcRef = useRef(src);
  srcRef.current = src;
  const sourceIdRef = useRef(sourceId);
  sourceIdRef.current = sourceId;
  // The web_text_quote subset, as the guest paint messages. Kept in a ref so the
  // once-bound sv:ready / dom-ready pushes (and the re-push effect) always send the
  // current set, not a stale snapshot.
  const webAnchors = toWebAnchorMsgs(anchorsOfKind(anchors, "web_text_quote"));
  const anchorsRef = useRef<WebAnchorMsg[]>(webAnchors);
  anchorsRef.current = webAnchors;
  // The anchor pusher returned by bindWebviewAnchors, so the anchors-changed effect
  // can re-send into the same already-bound webview.
  const pushAnchorsRef = useRef<(() => void) | null>(null);
  const isDesktop = typeof window !== "undefined" && !!window.studyVault?.desktop;

  // Create the webview once and keep it mounted for the lifetime of the reader.
  useEffect(() => {
    if (!isDesktop || !hostRef.current) return;
    const view = document.createElement("webview") as WebviewEl;
    view.setAttribute("allowpopups", "true");
    view.className = "local-webview";
    view.setAttribute("src", absolute(srcRef.current));
    // Shared webview selection capture: attaches the guest preload and reports text
    // selections; we bridge each one to a web quote draft keyed by this file's url.
    const disposeSelection = bindWebviewSelection(view, (selection) => {
      const draft = webSelectionToDraft(sourceIdRef.current, selection, srcRef.current);
      if (draft) onSelectRef.current(draft);
    });
    // Shared paint-back wiring: push stored anchors into the guest so it highlights
    // them + shows hover note-cards. Sends on sv:ready and dom-ready; the effect
    // below re-pushes whenever the anchor set changes.
    const anchorsBinding = bindWebviewAnchors(view, () => anchorsRef.current);
    pushAnchorsRef.current = anchorsBinding.push;
    view.addEventListener("dom-ready", () => {
      readyRef.current = true;
    });
    // Match the host backdrop to each page's own background. The white flash between
    // fast in-page navigations is our white host showing through the one-frame gap
    // before the next page paints; making it the page's (dark) color hides it.
    view.addEventListener("did-finish-load", () => {
      void view
        .executeJavaScript(READ_BG)
        .then((color) => {
          if (typeof color === "string" && color && hostRef.current) {
            hostRef.current.style.backgroundColor = color;
          }
        })
        .catch(() => undefined);
    });
    hostRef.current.appendChild(view);
    viewRef.current = view;
    lastSrc.current = src;
    return () => {
      disposeSelection();
      anchorsBinding.dispose();
      pushAnchorsRef.current = null;
      view.remove();
      viewRef.current = null;
      readyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDesktop]);

  // Re-push anchors into the guest whenever they change (e.g. after saving a note),
  // mirroring WebviewReader. Guarded inside bindWebviewAnchors' push (the guest may
  // not be ready); a later sv:ready / dom-ready will retry.
  useEffect(() => {
    pushAnchorsRef.current?.();
  }, [anchors]);

  // Navigate the same webview when the source changes — loadURL() is a normal
  // navigation (paint-held), unlike resetting the src attribute (reload → white).
  useEffect(() => {
    const view = viewRef.current;
    if (!view || src === lastSrc.current) return;
    lastSrc.current = src;
    const target = absolute(src);
    if (readyRef.current) {
      void view.loadURL(target).catch(() => view.setAttribute("src", target));
    } else {
      view.setAttribute("src", target);
    }
  }, [src]);

  if (!isDesktop) {
    return <div className="empty-reader">Local HTML is available in the desktop app.</div>;
  }
  return <div className="local-webview-host" ref={hostRef} />;
}
