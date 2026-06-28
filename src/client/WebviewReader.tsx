import { useEffect, useRef, useState } from "react";
import {
  bindWebviewAnchors,
  bindWebviewSelection,
  revealWebviewAnchor,
  toWebAnchorMsgs,
  webSelectionToDraft,
  webviewPreloadUrl,
  type SelectionWebview,
  type WebAnchorMsg,
  type WebviewIpcMessage
} from "./selection/webviewSelection";
import { anchorsOfKind, type SurfaceReaderProps } from "./surfaces/types";
import { DomReader } from "./surfaces/DomReader";

type WebviewReaderProps = SurfaceReaderProps & {
  // The active source id — stamped onto emitted drafts.
  sourceId: string;
  // The source's web URL: the live URL (web_live) or the snapshot's original URL
  // (webpage). Used as the first tab's address + the target of "Open Live".
  sourceUrl: string;
  // Which sub-mode the source opens in. "live" = embed the URL in a webview guest
  // (web_text_quote anchors); "snapshot" = render the stored study-id HTML in a
  // DomReader tab (html_selection anchors), with the option to go live.
  primaryMode: "snapshot" | "live";
  // The server-rendered study-id HTML for the snapshot tab (snapshot mode only).
  snapshotHtml?: string;
};

// The <webview> element isn't a typed DOM/JSX element; describe just the methods
// and events we drive so we can cast the imperatively-created element. `send`/
// `getURL` come from the shared SelectionWebview surface; the rest drive nav.
type WebviewElement = SelectionWebview & {
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
  stop: () => void;
  loadURL: (url: string) => Promise<void>;
  canGoBack: () => boolean;
  canGoForward: () => boolean;
};

// A tab is either the offline SNAPSHOT (rendered HTML, html_selection anchors) or a
// LIVE page (an Electron <webview> guest, web_text_quote anchors). Only one snapshot
// tab ever exists (the source's first tab); links/"Open Live" spawn live tabs.
type Tab = { id: string; url: string; title: string; mode: "snapshot" | "live" };

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) || trimmed.startsWith("about:")) return trimmed;
  return `https://${trimmed}`;
}

// A short, readable tab label from a URL (host + trimmed path).
function tabTitle(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname === "/" ? "" : u.pathname;
    const label = `${u.host}${path}`;
    return label.length > 28 ? `${label.slice(0, 27)}…` : label || url;
  } catch {
    return url.length > 28 ? `${url.slice(0, 27)}…` : url;
  }
}

let tabCounter = 0;
const nextTabId = () => `tab${(tabCounter += 1)}`;

// The source's opening tab: a snapshot tab in snapshot mode, else a live tab.
function initialTabs(primaryMode: "snapshot" | "live", sourceUrl: string): Tab[] {
  if (primaryMode === "snapshot") {
    return [{ id: "tab0", url: sourceUrl, title: sourceUrl ? tabTitle(sourceUrl) : "Snapshot", mode: "snapshot" }];
  }
  return [{ id: "tab0", url: sourceUrl, title: tabTitle(sourceUrl), mode: "live" }];
}

// Unified Web surface adapter for BOTH saved snapshots (webpage) and live pages
// (web_live), behind one Chrome-ish tabbed shell (tab strip + back/forward/reload +
// address bar). The two sub-modes keep their own annotation path:
//   SNAPSHOT tab → renders the stored study-id HTML in a DomReader (html_selection
//                  anchors, painted offline — works without Electron). Clicking a
//                  link, editing the address, or hitting "Open Live" opens the target
//                  as a new LIVE tab.
//   LIVE tab     → an Electron <webview> guest with the selection-capture preload;
//                  every link click opens a NEW tab (sv:open-tab) so you never lose
//                  the page you came from.
//     READ : guest text selection → AnchorDraft { mode:"quote", kind:"web", url }.
//     WRITE: paint web_text_quote anchors via sv:anchors.
// Live tabs need Electron; outside it a pure-live source shows a hint, while a
// snapshot source still renders (its snapshot tab needs no webview).
export function WebviewReader({
  sourceId,
  sourceUrl,
  primaryMode,
  snapshotHtml,
  anchors,
  onSelect,
  activeAnchorId,
  revealSeq
}: WebviewReaderProps) {
  const preloadUrl = webviewPreloadUrl();

  const [tabs, setTabs] = useState<Tab[]>(() => initialTabs(primaryMode, sourceUrl));
  const [activeId, setActiveId] = useState("tab0");
  const [address, setAddress] = useState(sourceUrl);
  const [editingAddress, setEditingAddress] = useState(false);
  const [canBack, setCanBack] = useState(false);
  const [canForward, setCanForward] = useState(false);
  const [loading, setLoading] = useState(false);

  // Keep latest values in refs so per-webview listeners (bound once) stay correct.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const sourceIdRef = useRef(sourceId);
  sourceIdRef.current = sourceId;
  // The web_text_quote subset as guest paint messages (the only kind a webview can
  // paint); kept in a ref so the once-bound pushes always send the current set.
  const anchorsRef = useRef<WebAnchorMsg[]>(toWebAnchorMsgs(anchorsOfKind(anchors, "web_text_quote")));
  anchorsRef.current = toWebAnchorMsgs(anchorsOfKind(anchors, "web_text_quote"));
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const editingRef = useRef(editingAddress);
  editingRef.current = editingAddress;

  const webviews = useRef(new Map<string, WebviewElement>());
  const containers = useRef(new Map<string, HTMLDivElement>());
  // Per-tab anchor pushers (from bindWebviewAnchors), so the anchors-changed effect
  // can re-send into each live webview.
  const anchorPushers = useRef(new Map<string, () => void>());
  const prevUrl = useRef(sourceUrl);

  // Open a URL as a new LIVE tab (link click in a snapshot, address submit on a
  // snapshot tab, "Open Live", or sv:open-tab from a live guest).
  const openLive = (rawUrl: string) => {
    const target = normalizeUrl(rawUrl);
    if (!target) return;
    const id = nextTabId();
    setTabs((prev) => [...prev, { id, url: target, title: tabTitle(target), mode: "live" }]);
    setActiveId(id);
  };

  const closeTab = (id: string) => {
    setTabs((prev) => {
      if (prev.length <= 1) return prev; // always keep one tab
      const remaining = prev.filter((tab) => tab.id !== id);
      setActiveId((current) => (current === id ? remaining[remaining.length - 1].id : current));
      return remaining;
    });
  };

  const syncNav = (webview: WebviewElement) => {
    try {
      setCanBack(webview.canGoBack());
      setCanForward(webview.canGoForward());
    } catch {
      // methods unavailable until the guest attaches; ignore.
    }
  };

  // Create a <webview> for any LIVE tab that doesn't have one yet; tear down webviews
  // for tabs that were closed. Snapshot tabs are React-rendered (DomReader) and never
  // get a webview.
  useEffect(() => {
    if (!preloadUrl) return;
    for (const tab of tabs) {
      if (tab.mode !== "live") continue;
      if (webviews.current.has(tab.id)) continue;
      const container = containers.current.get(tab.id);
      if (!container) continue;

      const webview = document.createElement("webview") as WebviewElement;
      webview.setAttribute("src", tab.url);
      webview.setAttribute("plugins", ""); // inline PDF viewer
      webview.style.width = "100%";
      webview.style.height = "100%";
      webviews.current.set(tab.id, webview);

      // Shared paint-back wiring: push stored anchors into the guest (highlights +
      // hover note-cards). Handles sv:ready + dom-ready itself; the anchors-changed
      // effect re-pushes via the returned push fn (which reads the live anchorsRef).
      const anchorsBinding = bindWebviewAnchors(webview, () => anchorsRef.current);
      anchorPushers.current.set(tab.id, anchorsBinding.push);
      // Shared selection capture: attaches the guest preload + translates
      // sv:selection into a web quote draft keyed by the page url it was made on.
      // The extra handler covers the one channel only the tabbed live reader owns
      // (link → new tab). The preload attribute MUST be set before the guest starts
      // loading (i.e. before appendChild below); otherwise the live page loads with
      // NO selection-capture preload and selections never reach the host (so no chip,
      // no anchor) — the bug LocalHtmlReader already avoided by binding pre-append.
      bindWebviewSelection(
        webview,
        (selection, pageUrl) => {
          const draft = webSelectionToDraft(sourceIdRef.current, selection, pageUrl);
          if (draft) onSelectRef.current(draft);
        },
        (message: WebviewIpcMessage) => {
          if (message.channel === "sv:open-tab") {
            openLive(String(message.args[0] ?? ""));
          }
        }
      );

      const onNavigate = () => {
        let current = tab.url;
        try {
          current = webview.getURL();
        } catch {
          // ignore
        }
        setTabs((prev) => prev.map((item) => (item.id === tab.id ? { ...item, url: current, title: tabTitle(current) } : item)));
        if (activeIdRef.current === tab.id) {
          if (!editingRef.current) setAddress(current);
          syncNav(webview);
        }
      };
      webview.addEventListener("did-navigate", onNavigate);
      webview.addEventListener("did-navigate-in-page", onNavigate);
      webview.addEventListener("dom-ready", onNavigate);
      webview.addEventListener("did-start-loading", () => {
        if (activeIdRef.current === tab.id) setLoading(true);
      });
      webview.addEventListener("did-stop-loading", () => {
        if (activeIdRef.current === tab.id) {
          setLoading(false);
          syncNav(webview);
        }
      });

      // Attach LAST: appending starts the guest loading, so the preload attribute
      // (set above by bindWebviewSelection) and every listener must already be in
      // place. Otherwise the guest can load before the preload attaches → no
      // selection capture.
      container.appendChild(webview);
    }

    for (const [id, webview] of [...webviews.current]) {
      if (!tabs.some((tab) => tab.id === id)) {
        webview.remove();
        webviews.current.delete(id);
        anchorPushers.current.delete(id);
      }
    }
  }, [tabs, preloadUrl]);

  // Re-push anchors to every LIVE tab when they change (e.g. after a new note). Each
  // push reads the live anchorsRef inside the shared helper. (Snapshot tabs repaint
  // themselves via DomReader's own anchors effect.)
  useEffect(() => {
    for (const push of anchorPushers.current.values()) push();
  }, [anchors]);

  // REVEAL: ask the ACTIVE LIVE tab's guest to scroll the focused anchor into view
  // (sv:reveal → the guest preload calls the shared revealAnchorInDoc). Keyed on
  // revealSeq so re-selecting the same anchor re-fires, and on activeId so switching
  // to a tab honors the current focus. The snapshot tab reveals through its nested
  // DomReader (below) instead, so target only live guests here.
  useEffect(() => {
    if (!activeAnchorId) return;
    revealWebviewAnchor(webviews.current.get(activeIdRef.current), activeAnchorId);
  }, [activeAnchorId, revealSeq, activeId]);

  // Reflect the active tab's URL + nav state when switching tabs.
  useEffect(() => {
    const tab = tabs.find((item) => item.id === activeId);
    setAddress(tab?.url ?? "");
    if (tab?.mode === "live") {
      const webview = webviews.current.get(activeId);
      if (webview) syncNav(webview);
    } else {
      // Snapshot tab: nothing to navigate.
      setCanBack(false);
      setCanForward(false);
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // A new source (sourceUrl changes) resets back to its opening tab.
  useEffect(() => {
    if (prevUrl.current === sourceUrl) return;
    prevUrl.current = sourceUrl;
    for (const webview of webviews.current.values()) webview.remove();
    webviews.current.clear();
    anchorPushers.current.clear();
    setTabs(initialTabs(primaryMode, sourceUrl));
    setActiveId("tab0");
    setAddress(sourceUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceUrl]);

  // Pure-live source outside Electron: there's no snapshot to fall back on, so show
  // the desktop-app hint (unchanged behavior for web_live in a browser).
  if (!preloadUrl && primaryMode === "live") {
    return (
      <div className="empty-reader">
        Live web annotation runs in the desktop app. Launch with <code>npm run electron</code>.
      </div>
    );
  }

  const activeTab = tabs.find((item) => item.id === activeId) ?? tabs[0];
  const activeWebview = () => webviews.current.get(activeIdRef.current) ?? null;

  const submitAddress = () => {
    const target = normalizeUrl(address);
    setEditingAddress(false);
    if (!target) return;
    const tab = tabs.find((item) => item.id === activeIdRef.current);
    if (tab?.mode === "live") {
      setAddress(target);
      void activeWebview()
        ?.loadURL(target)
        .catch(() => {
          // navigation failures surface in the guest; ignore here.
        });
    } else {
      // Snapshot tab: navigating away means going live.
      openLive(target);
    }
  };

  return (
    <div className="webview-frame">
      <div className="webview-tabs">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`webview-tab${tab.id === activeId ? " active" : ""}${tab.mode === "snapshot" ? " snapshot" : ""}`}
            role="button"
            tabIndex={0}
            title={tab.url}
            onClick={() => setActiveId(tab.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter") setActiveId(tab.id);
            }}
          >
            <span className="webview-tab-title">{tab.mode === "snapshot" ? "Snapshot" : tab.title}</span>
            {tabs.length > 1 ? (
              <button
                type="button"
                className="webview-tab-close"
                aria-label="Close tab"
                onClick={(event) => {
                  event.stopPropagation();
                  closeTab(tab.id);
                }}
              >
                ×
              </button>
            ) : null}
          </div>
        ))}
      </div>
      <div className="webview-nav">
        <button
          type="button"
          className="webview-nav-btn"
          title="Back"
          aria-label="Back"
          disabled={!canBack}
          onClick={() => activeWebview()?.goBack()}
        >
          {"←"}
        </button>
        <button
          type="button"
          className="webview-nav-btn"
          title="Forward"
          aria-label="Forward"
          disabled={!canForward}
          onClick={() => activeWebview()?.goForward()}
        >
          {"→"}
        </button>
        <button
          type="button"
          className="webview-nav-btn"
          title={loading ? "Stop" : "Reload"}
          aria-label={loading ? "Stop" : "Reload"}
          disabled={activeTab?.mode === "snapshot"}
          onClick={() => (loading ? activeWebview()?.stop() : activeWebview()?.reload())}
        >
          {loading ? "✕" : "↻"}
        </button>
        <input
          className="webview-address"
          type="text"
          aria-label="Address"
          spellCheck={false}
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          onFocus={(event) => {
            setEditingAddress(true);
            event.target.select();
          }}
          onBlur={() => setEditingAddress(false)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submitAddress();
              event.currentTarget.blur();
            }
          }}
        />
        {activeTab?.mode === "snapshot" ? (
          <button
            type="button"
            className="webview-nav-btn webview-go-live"
            title="Open this page live"
            aria-label="Open Live"
            onClick={() => openLive(activeTab.url || sourceUrl)}
          >
            Open Live
          </button>
        ) : null}
      </div>
      <div className="webview-stack">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className="webview-host"
            style={{ display: tab.id === activeId ? "block" : "none" }}
            ref={
              tab.mode === "live"
                ? (element) => {
                    if (element) containers.current.set(tab.id, element);
                    else containers.current.delete(tab.id);
                  }
                : undefined
            }
          >
            {tab.mode === "snapshot" ? (
              <DomReader
                srcDoc={snapshotHtml ?? ""}
                sourceId={sourceId}
                anchors={anchors}
                onSelect={onSelect}
                activeAnchorId={activeAnchorId}
                revealSeq={revealSeq}
                onOpenUrl={openLive}
              />
            ) : !preloadUrl ? (
              <div className="empty-reader">
                Live web annotation runs in the desktop app. Launch with <code>npm run electron</code>.
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
