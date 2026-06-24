import { useEffect, useRef } from "react";
import { bindWebviewSelection, type SelectionWebview, type WebSelection } from "./selection/webviewSelection";

// Renders a local HTML page (served from its original directory by /api/local) in a
// single isolated Electron <webview> — a real, persistent browser view. It's never
// torn down or swapped: clicking links inside the page navigates it natively, and
// switching files from the tree navigates it via loadURL(). Both are ordinary
// in-view navigations, so Chromium's paint-holding keeps the old page visible until
// the new one paints — exactly how a browser tab avoids flashing. Being a separate
// WebContents, it also can't reach the host app (no recursive nesting).

type WebviewEl = SelectionWebview & {
  loadURL: (url: string) => Promise<void>;
  executeJavaScript: (code: string) => Promise<unknown>;
};

type LocalHtmlReaderProps = {
  src: string;
  // The page URL the selection was made on is reported alongside it so the host can
  // anchor the quote to this local file (a web_text_quote anchor — local HTML is
  // stored raw with no study-ids, so html_selection anchoring isn't available).
  onSelection?: (selection: WebSelection, pageUrl: string) => void;
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

export function LocalHtmlReader({ src, onSelection }: LocalHtmlReaderProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<WebviewEl | null>(null);
  const readyRef = useRef(false);
  const lastSrc = useRef<string>("");
  // Keep the latest onSelection in a ref so the once-bound listener stays current.
  const onSelectionRef = useRef(onSelection);
  onSelectionRef.current = onSelection;
  const isDesktop = typeof window !== "undefined" && !!window.studyVault?.desktop;

  // Create the webview once and keep it mounted for the lifetime of the reader.
  useEffect(() => {
    if (!isDesktop || !hostRef.current) return;
    const view = document.createElement("webview") as WebviewEl;
    view.setAttribute("allowpopups", "true");
    view.className = "local-webview";
    view.setAttribute("src", absolute(src));
    // Shared webview selection capture: attaches the guest preload and reports
    // text selections back to the host as a TextQuoteSelector.
    const disposeSelection = bindWebviewSelection(view, (selection, pageUrl) =>
      onSelectionRef.current?.(selection, pageUrl)
    );
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
      view.remove();
      viewRef.current = null;
      readyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDesktop]);

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
