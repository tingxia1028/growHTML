// Shared text-selection capture for Electron <webview> surfaces.
//
// A <webview> is a separate WebContents, so the host page can't reach its DOM to
// listen for selections directly (unlike the srcDoc iframe, whose contentDocument
// the host owns). Instead a guest preload (electron/webview-preload.ts) runs INSIDE
// the webview, listens for selections, and posts them back over the `sv:selection`
// IPC channel as a TextQuoteSelector. Both webview surfaces — WebviewReader (live
// web) and LocalHtmlReader (local HTML files) — capture selection the same way, so
// the wiring lives here once instead of being duplicated per reader.

export type WebSelection = { exact: string; prefix: string; suffix: string };

// The raw shape the guest preload posts on `sv:selection`. Kept permissive because
// it crosses an IPC boundary; normalizeWebSelection validates it.
type RawSelectionMessage = {
  exact?: unknown;
  prefix?: unknown;
  suffix?: unknown;
};

// Normalize the first argument of an `sv:selection` ipc-message into a WebSelection,
// or null if it carries no usable (non-blank) quote. Pure + exported so the message
// contract can be unit-tested without a webview/Electron.
export function normalizeWebSelection(raw: unknown): WebSelection | null {
  if (!raw || typeof raw !== "object") return null;
  const { exact, prefix, suffix } = raw as RawSelectionMessage;
  const quote = typeof exact === "string" ? exact : "";
  if (!quote.trim()) return null;
  return {
    exact: quote,
    prefix: typeof prefix === "string" ? prefix : "",
    suffix: typeof suffix === "string" ? suffix : ""
  };
}

// The Electron <webview> element isn't a typed DOM/JSX element; describe just the
// surface the shared selection wiring needs. Readers can intersect this with the
// extra methods they drive (loadURL, goBack, …).
export type SelectionWebview = HTMLElement & {
  send: (channel: string, ...args: unknown[]) => void;
  getURL: () => string;
};

// An `ipc-message` event from a <webview> carries a channel + args tuple.
export type WebviewIpcMessage = Event & { channel: string; args: unknown[] };

// The preload file:// url the host attaches to each guest webview so it captures
// selections. Absent outside the desktop app (returns undefined → no capture).
export function webviewPreloadUrl(): string | undefined {
  return typeof window !== "undefined" ? window.studyVault?.webviewPreloadUrl : undefined;
}

// Attach the shared selection-capture wiring to one webview: set the guest preload,
// and translate its `sv:selection` IPC messages into onSelection(selection, pageUrl)
// calls. Returns a disposer that removes the listener. The caller still owns the
// webview's lifecycle and any other listeners (navigation, anchors, tabs, …).
//
// `extraHandler` lets a reader handle additional channels (e.g. WebviewReader's
// sv:ready / sv:open-tab) on the same single ipc-message listener.
export function bindWebviewSelection(
  webview: SelectionWebview,
  onSelection: (selection: WebSelection, pageUrl: string) => void,
  extraHandler?: (message: WebviewIpcMessage, webview: SelectionWebview) => void
): () => void {
  const preload = webviewPreloadUrl();
  if (preload) webview.setAttribute("preload", preload);

  const listener = (event: Event) => {
    const message = event as WebviewIpcMessage;
    if (message.channel === "sv:selection") {
      const selection = normalizeWebSelection(message.args[0]);
      if (selection) {
        let pageUrl = "";
        try {
          pageUrl = webview.getURL();
        } catch {
          // getURL throws before the guest attaches; report without a page url.
        }
        onSelection(selection, pageUrl);
      }
    }
    extraHandler?.(message, webview);
  };
  webview.addEventListener("ipc-message", listener);
  return () => webview.removeEventListener("ipc-message", listener);
}
