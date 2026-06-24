import { useEffect, useRef, useState } from "react";

export type WebAnchorMsg = { id?: string; quote: string; contextBefore: string; contextAfter: string; note?: string };
export type WebSelection = { exact: string; prefix: string; suffix: string };

type WebviewReaderProps = {
  url: string;
  anchors: WebAnchorMsg[];
  // The page URL is reported alongside the selection so the anchor records which
  // tab/page it was made on (tabs can navigate to other URLs).
  onSelection: (selection: WebSelection, pageUrl: string) => void;
};

// The <webview> element isn't a typed DOM/JSX element; describe just the methods
// and events we drive so we can cast the imperatively-created element.
type WebviewElement = HTMLElement & {
  send: (channel: string, ...args: unknown[]) => void;
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
  stop: () => void;
  loadURL: (url: string) => Promise<void>;
  canGoBack: () => boolean;
  canGoForward: () => boolean;
  getURL: () => string;
};

type IpcMessage = Event & { channel: string; args: unknown[] };
type Tab = { id: string; url: string; title: string };

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

// Embeds live web pages in Electron <webview>s with Chrome-ish in-app TABS: every
// link click opens a NEW tab (the guest preload reports navigations as
// sv:open-tab), so the page you came from is never lost. A nav bar (back/forward/
// reload/stop + address bar) drives the active tab. The guest preload reports
// selections and highlights stored anchors per page. Renders a hint outside Electron.
export function WebviewReader({ url, anchors, onSelection }: WebviewReaderProps) {
  const preloadUrl = typeof window !== "undefined" ? window.studyVault?.webviewPreloadUrl : undefined;

  const [tabs, setTabs] = useState<Tab[]>([{ id: "tab0", url, title: tabTitle(url) }]);
  const [activeId, setActiveId] = useState("tab0");
  const [address, setAddress] = useState(url);
  const [editingAddress, setEditingAddress] = useState(false);
  const [canBack, setCanBack] = useState(false);
  const [canForward, setCanForward] = useState(false);
  const [loading, setLoading] = useState(false);

  // Keep latest values in refs so per-webview listeners (bound once) stay correct.
  const onSelectionRef = useRef(onSelection);
  onSelectionRef.current = onSelection;
  const anchorsRef = useRef(anchors);
  anchorsRef.current = anchors;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const editingRef = useRef(editingAddress);
  editingRef.current = editingAddress;

  const webviews = useRef(new Map<string, WebviewElement>());
  const containers = useRef(new Map<string, HTMLDivElement>());
  const prevUrl = useRef(url);

  const addTab = (rawUrl: string) => {
    const target = normalizeUrl(rawUrl);
    if (!target) return;
    const id = nextTabId();
    setTabs((prev) => [...prev, { id, url: target, title: tabTitle(target) }]);
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

  // Create a <webview> for any tab that doesn't have one yet; tear down webviews
  // for tabs that were closed.
  useEffect(() => {
    if (!preloadUrl) return;
    for (const tab of tabs) {
      if (webviews.current.has(tab.id)) continue;
      const container = containers.current.get(tab.id);
      if (!container) continue;

      const webview = document.createElement("webview") as WebviewElement;
      webview.setAttribute("src", tab.url);
      webview.setAttribute("preload", preloadUrl);
      webview.setAttribute("plugins", ""); // inline PDF viewer
      webview.style.width = "100%";
      webview.style.height = "100%";
      container.appendChild(webview);
      webviews.current.set(tab.id, webview);

      const sendAnchors = () => {
        try {
          webview.send("sv:anchors", anchorsRef.current);
        } catch {
          // not ready yet; dom-ready / sv:ready will retry.
        }
      };
      webview.addEventListener("ipc-message", (event) => {
        const message = event as IpcMessage;
        if (message.channel === "sv:selection") {
          onSelectionRef.current(message.args[0] as WebSelection, webview.getURL());
        } else if (message.channel === "sv:ready") {
          sendAnchors();
        } else if (message.channel === "sv:open-tab") {
          addTab(String(message.args[0] ?? ""));
        }
      });
      webview.addEventListener("dom-ready", sendAnchors);

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
    }

    for (const [id, webview] of [...webviews.current]) {
      if (!tabs.some((tab) => tab.id === id)) {
        webview.remove();
        webviews.current.delete(id);
      }
    }
  }, [tabs, preloadUrl]);

  // Re-push anchors to every tab when they change (e.g. after a new note).
  useEffect(() => {
    for (const webview of webviews.current.values()) {
      try {
        webview.send("sv:anchors", anchors);
      } catch {
        // ignore until ready
      }
    }
  }, [anchors]);

  // Reflect the active tab's URL + nav state when switching tabs.
  useEffect(() => {
    const webview = webviews.current.get(activeId);
    const tab = tabs.find((item) => item.id === activeId);
    setAddress(tab?.url ?? "");
    if (webview) syncNav(webview);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // A new source (url prop changes) resets back to a single tab.
  useEffect(() => {
    if (prevUrl.current === url) return;
    prevUrl.current = url;
    for (const webview of webviews.current.values()) webview.remove();
    webviews.current.clear();
    setTabs([{ id: "tab0", url, title: tabTitle(url) }]);
    setActiveId("tab0");
    setAddress(url);
  }, [url]);

  if (!preloadUrl) {
    return (
      <div className="empty-reader">
        Live web annotation runs in the desktop app. Launch with <code>npm run electron</code>.
      </div>
    );
  }

  const activeWebview = () => webviews.current.get(activeIdRef.current) ?? null;

  const submitAddress = () => {
    const target = normalizeUrl(address);
    setEditingAddress(false);
    if (!target) return;
    setAddress(target);
    void activeWebview()
      ?.loadURL(target)
      .catch(() => {
        // navigation failures surface in the guest; ignore here.
      });
  };

  return (
    <div className="webview-frame">
      <div className="webview-tabs">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`webview-tab${tab.id === activeId ? " active" : ""}`}
            role="button"
            tabIndex={0}
            title={tab.url}
            onClick={() => setActiveId(tab.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter") setActiveId(tab.id);
            }}
          >
            <span className="webview-tab-title">{tab.title}</span>
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
      </div>
      <div className="webview-stack">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className="webview-host"
            style={{ display: tab.id === activeId ? "block" : "none" }}
            ref={(element) => {
              if (element) containers.current.set(tab.id, element);
              else containers.current.delete(tab.id);
            }}
          />
        ))}
      </div>
    </div>
  );
}
