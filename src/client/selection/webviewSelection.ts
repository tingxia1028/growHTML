// Shared text-selection capture + anchor painting for Electron <webview> surfaces.
//
// A <webview> is a separate WebContents, so the host page can't reach its DOM to
// listen for selections directly (unlike the srcDoc iframe, whose contentDocument
// the host owns). Instead a guest preload (electron/webview-preload.ts) runs INSIDE
// the webview, listens for selections, and posts them back over the `sv:selection`
// IPC channel as a TextQuoteSelector; the host pushes stored anchors back over
// `sv:anchors` for the guest to paint. Both webview surfaces — WebviewReader (live
// web) and LocalHtmlReader (local HTML files) — use the same wiring, so it lives
// here once instead of being duplicated per reader.
//
// These are the IPC shapes the guest preload speaks (WebSelection / WebAnchorMsg).
// The readers bridge them to the uniform surface contract (PaintAnchor in,
// AnchorDraft out) via the two pure helpers at the bottom of this file, so the
// guest protocol stays an implementation detail of the webview surface.

import type { AnchorDraft } from "../focus/FocusContext";
import type { PaintAnchor } from "../surfaces/types";

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

// The anchor shape the guest preload paints back as highlights + hover note-cards
// over the `sv:anchors` channel. Permissive `id` because it's optional in the guest.
export type WebAnchorMsg = {
  id?: string;
  quote: string;
  contextBefore: string;
  contextAfter: string;
  note?: string;
  noteHtml?: string;
  noteCount?: number;
  noteTypes?: string[];
};

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

// Push stored anchors INTO a webview guest so it paints them as highlights + hover
// note-cards (the paint-back direction; the guest handles `sv:anchors` in
// electron/webview-preload.ts). This is the mirror of bindWebviewSelection's read
// direction and is shared so WebviewReader and LocalHtmlReader don't duplicate it.
//
// `getAnchors` is a getter (not a snapshot) so the once-bound listeners always send
// the latest set even though they're attached a single time. We send:
//   - when the guest reports `sv:ready` (it just loaded and asked for anchors), and
//   - on `dom-ready` (a fresh document — re-paint after a navigation).
// `send` can throw before the guest attaches, so each push is guarded; the next
// ready/dom-ready event retries. Returns a disposer that detaches both listeners.
//
// Whenever the anchor set itself changes (e.g. a new note), the caller re-pushes by
// calling the returned `push` — typically from a React effect keyed on the anchors.
export function bindWebviewAnchors(
  webview: SelectionWebview,
  getAnchors: () => WebAnchorMsg[]
): { dispose: () => void; push: () => void } {
  const push = () => {
    try {
      webview.send("sv:anchors", getAnchors());
    } catch {
      // Guest not ready yet; sv:ready / dom-ready will retry.
    }
  };
  const onReady = (event: Event) => {
    if ((event as WebviewIpcMessage).channel === "sv:ready") push();
  };
  webview.addEventListener("ipc-message", onReady);
  webview.addEventListener("dom-ready", push);
  return {
    push,
    dispose: () => {
      webview.removeEventListener("ipc-message", onReady);
      webview.removeEventListener("dom-ready", push);
    }
  };
}

// REVEAL side: ask a webview GUEST to scroll a painted anchor into view. The host
// can't reach the guest DOM, so it sends `sv:reveal` over IPC and the guest preload
// (electron/webview-preload.ts) calls the SAME shared revealAnchorInDoc against its
// own document. Shared here so both webview readers (LocalHtmlReader + the live
// WebviewReader tab) plumb reveal identically. `send` throws before the guest
// attaches, so it's guarded — a reveal requested too early is simply dropped (the
// user can re-click; the painted anchor is already in view after a fresh paint).
export function revealWebviewAnchor(webview: SelectionWebview | null | undefined, anchorId: string | undefined): void {
  if (!webview || !anchorId) return;
  try {
    webview.send("sv:reveal", anchorId);
  } catch {
    // Guest not ready yet; nothing to reveal.
  }
}

// SELECT side: tell a webview GUEST which anchor is now focused so it paints the
// persistent blue `.sv-selected` highlight (the guest calls the SAME shared
// setSelectedAnchorInDoc against its own document, and re-applies it after a repaint).
// Mirror of revealWebviewAnchor; passing an empty/undefined id clears the selection.
// `send` throws before the guest attaches, so it's guarded — an early select is
// dropped and re-sent when the focused anchor next changes / the guest re-paints.
export function selectWebviewAnchor(webview: SelectionWebview | null | undefined, anchorId: string | undefined): void {
  if (!webview) return;
  try {
    webview.send("sv:select", anchorId ?? "");
  } catch {
    // Guest not ready yet; the next select / sv:anchors push re-applies it.
  }
}

// —— Bridge: uniform surface contract ⇄ guest IPC shapes ——
// The webview surface speaks WebSelection/WebAnchorMsg over IPC, but the host
// drives every reader through the uniform PaintAnchor/AnchorDraft contract. These
// two pure helpers translate at the boundary, so a webview reader only has to say
// which URL its drafts are keyed by. Both are unit-tested.

// WRITE side: the host's paintAnchors → the WebAnchorMsg[] the guest paints. Only
// web_text_quote anchors are paintable in a webview (the others belong to other
// surfaces); each maps to the guest's quote + context + merged note text.
export function toWebAnchorMsgs(anchors: PaintAnchor[]): WebAnchorMsg[] {
  return anchors
    .filter((anchor) => anchor.anchorKind === "web_text_quote")
    .map((anchor) => {
      const msg: WebAnchorMsg = {
        id: anchor.id,
        quote: anchor.quote ?? "",
        contextBefore: anchor.contextBefore ?? "",
        contextAfter: anchor.contextAfter ?? "",
        note: anchor.note
      };
      const noteHtml = anchor.notePreviews?.map((preview) => preview.html).join("") || undefined;
      if (noteHtml) msg.noteHtml = noteHtml;
      if (anchor.notePreviews?.length) msg.noteCount = anchor.notePreviews.length;
      if (anchor.notePreviews?.length) msg.noteTypes = anchor.notePreviews.map((preview) => preview.contentType);
      return msg;
    });
}

// READ side: a guest WebSelection (+ the URL it should be anchored to) → a
// normalized web quote AnchorDraft. Local HTML is stored raw with no study-ids, so
// BOTH webview readers emit kind:"web" drafts (→ web_text_quote anchors keyed by a
// URL); the only difference is the URL — a live tab url vs. a local file's
// /api/local url — which the reader passes in.
export function webSelectionToDraft(sourceId: string, selection: WebSelection, url: string): AnchorDraft | null {
  if (!selection.exact.trim()) return null;
  return {
    mode: "quote",
    sourceId,
    kind: "web",
    quote: selection.exact,
    prefix: selection.prefix,
    suffix: selection.suffix,
    url
  };
}
