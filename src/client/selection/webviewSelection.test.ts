// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bindWebviewAnchors,
  bindWebviewSelection,
  normalizeWebSelection,
  revealWebviewAnchor,
  selectWebviewAnchor,
  toWebAnchorMsgs,
  webSelectionToDraft,
  webviewPreloadUrl,
  type SelectionWebview,
  type WebAnchorMsg,
  type WebviewIpcMessage
} from "./webviewSelection";
import { persistAnchorGlyphVisibility, persistNotesHidden } from "../annotations";
import type { PaintAnchor } from "../surfaces/types";

// A minimal stand-in for an Electron <webview>: a real EventTarget (so the shared
// ipc-message listener attaches/detaches for real) plus the two methods the
// selection wiring calls. ipc-message events are plain Events with channel/args.
type FakeWebview = SelectionWebview & {
  fire: (channel: string, ...args: unknown[]) => void;
  fireEvent: (type: string) => void;
};

function fakeWebview(url = "https://example.test/page"): FakeWebview {
  const el = document.createElement("div") as unknown as FakeWebview;
  let preload = "";
  el.setAttribute = ((name: string, value: string) => {
    if (name === "preload") preload = value;
    Object.defineProperty(el, `__attr_${name}`, { value, configurable: true });
  }) as typeof el.setAttribute;
  (el as { getAttribute: (n: string) => string | null }).getAttribute = (name: string) =>
    name === "preload" ? preload || null : null;
  el.send = vi.fn();
  el.getURL = () => url;
  el.fire = (channel: string, ...args: unknown[]) => {
    const event = new Event("ipc-message") as WebviewIpcMessage;
    event.channel = channel;
    event.args = args;
    el.dispatchEvent(event);
  };
  // A plain DOM event (e.g. the webview's "dom-ready") with no channel/args.
  el.fireEvent = (type: string) => el.dispatchEvent(new Event(type));
  return el;
}

afterEach(() => {
  // Remove any preload url injected onto the shared bridge surface.
  delete (window as { studyVault?: unknown }).studyVault;
  // The host-push now reads the PERSISTED prefs (F-1 follow-up) — restore the localStorage
  // defaults (flip tests change them) so one test never leaks into the next.
  persistAnchorGlyphVisibility(true);
  window.localStorage.clear();
});

// The prefs object every sv:anchors push now carries alongside the anchors
// (additive payload extension — the guest mirrors the host's 显示锚点标记 switch AND
// the D11 hide-all flag).
const VISIBLE_PREFS = { anchorGlyphsVisible: true, notesHidden: false };

describe("normalizeWebSelection", () => {
  it("keeps a non-blank quote with its prefix/suffix", () => {
    expect(normalizeWebSelection({ exact: "hello", prefix: "a ", suffix: " b" })).toEqual({
      exact: "hello",
      prefix: "a ",
      suffix: " b"
    });
  });

  it("defaults missing/invalid prefix and suffix to empty strings", () => {
    expect(normalizeWebSelection({ exact: "hi" })).toEqual({ exact: "hi", prefix: "", suffix: "" });
    expect(normalizeWebSelection({ exact: "hi", prefix: 1, suffix: {} })).toEqual({
      exact: "hi",
      prefix: "",
      suffix: ""
    });
  });

  it("rejects blank, missing, or non-object payloads", () => {
    expect(normalizeWebSelection({ exact: "   " })).toBeNull();
    expect(normalizeWebSelection({ exact: "" })).toBeNull();
    expect(normalizeWebSelection({})).toBeNull();
    expect(normalizeWebSelection(null)).toBeNull();
    expect(normalizeWebSelection("hello")).toBeNull();
    expect(normalizeWebSelection(undefined)).toBeNull();
  });
});

describe("webviewPreloadUrl", () => {
  it("reflects the desktop bridge's preload url when present", () => {
    expect(webviewPreloadUrl()).toBeUndefined();
    (window as { studyVault?: { webviewPreloadUrl?: string } }).studyVault = {
      webviewPreloadUrl: "file:///preload.cjs"
    };
    expect(webviewPreloadUrl()).toBe("file:///preload.cjs");
  });
});

describe("revealWebviewAnchor", () => {
  it("sends sv:reveal with the anchor id to the guest", () => {
    const webview = fakeWebview();
    revealWebviewAnchor(webview, "anchor-7");
    expect(webview.send).toHaveBeenCalledWith("sv:reveal", "anchor-7");
  });

  it("no-ops without a webview or an id", () => {
    const webview = fakeWebview();
    revealWebviewAnchor(null, "anchor-7");
    revealWebviewAnchor(undefined, "anchor-7");
    revealWebviewAnchor(webview, undefined);
    expect(webview.send).not.toHaveBeenCalled();
  });

  it("swallows a throwing send (guest not ready yet)", () => {
    const webview = fakeWebview();
    (webview.send as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("guest not attached");
    });
    expect(() => revealWebviewAnchor(webview, "anchor-7")).not.toThrow();
  });
});

describe("selectWebviewAnchor", () => {
  it("sends sv:select with the anchor id to the guest", () => {
    const webview = fakeWebview();
    selectWebviewAnchor(webview, "anchor-7");
    expect(webview.send).toHaveBeenCalledWith("sv:select", "anchor-7");
  });

  it("sends an empty id to CLEAR the selection (undefined → '')", () => {
    const webview = fakeWebview();
    selectWebviewAnchor(webview, undefined);
    expect(webview.send).toHaveBeenCalledWith("sv:select", "");
  });

  it("no-ops without a webview", () => {
    expect(() => selectWebviewAnchor(null, "anchor-7")).not.toThrow();
    expect(() => selectWebviewAnchor(undefined, "anchor-7")).not.toThrow();
  });

  it("swallows a throwing send (guest not ready yet)", () => {
    const webview = fakeWebview();
    (webview.send as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("guest not attached");
    });
    expect(() => selectWebviewAnchor(webview, "anchor-7")).not.toThrow();
  });
});

describe("bindWebviewSelection", () => {
  it("attaches the guest preload from the desktop bridge", () => {
    (window as { studyVault?: { webviewPreloadUrl?: string } }).studyVault = {
      webviewPreloadUrl: "file:///preload.cjs"
    };
    const webview = fakeWebview();
    bindWebviewSelection(webview, () => undefined);
    expect((webview as { getAttribute: (n: string) => string | null }).getAttribute("preload")).toBe(
      "file:///preload.cjs"
    );
  });

  it("translates an sv:selection ipc-message into onSelection with the page url", () => {
    const webview = fakeWebview("https://docs.test/a");
    const onSelection = vi.fn();
    bindWebviewSelection(webview, onSelection);

    webview.fire("sv:selection", { exact: "render thread", prefix: "the ", suffix: " submits" });

    expect(onSelection).toHaveBeenCalledTimes(1);
    expect(onSelection).toHaveBeenCalledWith(
      { exact: "render thread", prefix: "the ", suffix: " submits" },
      "https://docs.test/a"
    );
  });

  it("ignores sv:selection messages with a blank quote", () => {
    const webview = fakeWebview();
    const onSelection = vi.fn();
    bindWebviewSelection(webview, onSelection);
    webview.fire("sv:selection", { exact: "   " });
    expect(onSelection).not.toHaveBeenCalled();
  });

  it("ignores non-selection channels but forwards them to extraHandler", () => {
    const webview = fakeWebview();
    const onSelection = vi.fn();
    const extra = vi.fn();
    bindWebviewSelection(webview, onSelection, extra);

    webview.fire("sv:open-tab", "https://other.test/");
    webview.fire("sv:ready", {});

    expect(onSelection).not.toHaveBeenCalled();
    expect(extra).toHaveBeenCalledTimes(2);
    expect(extra.mock.calls[0][0].channel).toBe("sv:open-tab");
    expect(extra.mock.calls[1][0].channel).toBe("sv:ready");
  });

  it("still forwards sv:selection to extraHandler alongside onSelection", () => {
    const webview = fakeWebview();
    const onSelection = vi.fn();
    const extra = vi.fn();
    bindWebviewSelection(webview, onSelection, extra);
    webview.fire("sv:selection", { exact: "quote" });
    expect(onSelection).toHaveBeenCalledTimes(1);
    expect(extra).toHaveBeenCalledTimes(1);
    expect(extra.mock.calls[0][0].channel).toBe("sv:selection");
  });

  it("stops reporting after the disposer runs", () => {
    const webview = fakeWebview();
    const onSelection = vi.fn();
    const dispose = bindWebviewSelection(webview, onSelection);
    dispose();
    webview.fire("sv:selection", { exact: "quote" });
    expect(onSelection).not.toHaveBeenCalled();
  });

  it("reports a selection even when getURL throws before the guest attaches", () => {
    const webview = fakeWebview();
    webview.getURL = () => {
      throw new Error("not attached");
    };
    const onSelection = vi.fn();
    bindWebviewSelection(webview, onSelection);
    webview.fire("sv:selection", { exact: "quote" });
    expect(onSelection).toHaveBeenCalledWith({ exact: "quote", prefix: "", suffix: "" }, "");
  });
});

// The paint-back direction: pushing stored anchors INTO the guest so it highlights
// them + shows hover note-cards. This is the host-side wiring the local-HTML
// highlight bug needed (LocalHtmlReader never sent sv:anchors). The actual in-guest
// painting (highlightQuote → <mark data-sv-note>) is a separate WebContents and
// isn't observable from the host in Playwright, so it's covered by the guest unit
// tests in annotationDom.test.ts; here we assert the host pushes the anchors.
describe("bindWebviewAnchors", () => {
  const anchor = (id: string, note = ""): WebAnchorMsg => ({
    id,
    quote: `quote-${id}`,
    contextBefore: "before ",
    contextAfter: " after",
    note
  });

  it("sends the current anchors over sv:anchors when the guest reports sv:ready", () => {
    const webview = fakeWebview();
    const anchors = [anchor("a1", "my note")];
    bindWebviewAnchors(webview, () => anchors);

    expect(webview.send).not.toHaveBeenCalled(); // nothing until the guest is ready
    webview.fire("sv:ready", {});

    expect(webview.send).toHaveBeenCalledTimes(1);
    expect(webview.send).toHaveBeenCalledWith("sv:anchors", anchors, VISIBLE_PREFS);
  });

  it("sends the current anchors over sv:anchors on dom-ready (re-paint after nav)", () => {
    const webview = fakeWebview();
    const anchors = [anchor("a1")];
    bindWebviewAnchors(webview, () => anchors);

    webview.fireEvent("dom-ready");

    expect(webview.send).toHaveBeenCalledTimes(1);
    expect(webview.send).toHaveBeenCalledWith("sv:anchors", anchors, VISIBLE_PREFS);
  });

  it("re-sends the LATEST anchors when push() is called (e.g. after a new note)", () => {
    let anchors = [anchor("a1")];
    const webview = fakeWebview();
    const { push } = bindWebviewAnchors(webview, () => anchors);

    // A note was added: the getter now returns a different set.
    anchors = [anchor("a1", "added note"), anchor("a2")];
    push();

    expect(webview.send).toHaveBeenCalledTimes(1);
    expect(webview.send).toHaveBeenCalledWith("sv:anchors", anchors, VISIBLE_PREFS);
    expect((webview.send as ReturnType<typeof vi.fn>).mock.calls[0][1]).toHaveLength(2);
  });

  it("always sends the freshest anchors from the getter, not a bound snapshot", () => {
    let anchors = [anchor("a1")];
    const webview = fakeWebview();
    bindWebviewAnchors(webview, () => anchors);

    webview.fire("sv:ready", {}); // sends [a1]
    anchors = [anchor("a2")]; // note set changed underneath the once-bound listener
    webview.fireEvent("dom-ready"); // must send the NEW set

    const calls = (webview.send as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][1]).toEqual([anchor("a1")]);
    expect(calls[1][1]).toEqual([anchor("a2")]);
  });

  it("swallows send() throwing before the guest attaches (a later event retries)", () => {
    const webview = fakeWebview();
    (webview.send as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error("guest not ready");
    });
    const { push } = bindWebviewAnchors(webview, () => [anchor("a1")]);

    expect(() => push()).not.toThrow(); // guarded
    webview.fireEvent("dom-ready"); // retry succeeds
    expect(webview.send).toHaveBeenCalledTimes(2);
  });

  it("ignores ipc-message channels other than sv:ready", () => {
    const webview = fakeWebview();
    bindWebviewAnchors(webview, () => [anchor("a1")]);
    webview.fire("sv:selection", { exact: "x" });
    webview.fire("sv:open-tab", "https://other.test/");
    expect(webview.send).not.toHaveBeenCalled();
  });

  it("stops sending after dispose() detaches the sv:ready and dom-ready listeners", () => {
    const webview = fakeWebview();
    const { dispose } = bindWebviewAnchors(webview, () => [anchor("a1")]);
    dispose();
    webview.fire("sv:ready", {});
    webview.fireEvent("dom-ready");
    expect(webview.send).not.toHaveBeenCalled();
  });

  // —— The 显示锚点标记 switch reaching an already-painted guest (via the marker-prefs
  //    bus + persisted store, F-1 follow-up) ——

  it("re-pushes with the new flag when the anchor-glyph switch flips (connected webview)", () => {
    const webview = fakeWebview();
    document.body.appendChild(webview); // connected — the subscription stays live
    const anchors = [anchor("a1")];
    const { dispose } = bindWebviewAnchors(webview, () => anchors);

    // A host control persisting the GLOBAL glyph pref pings the marker-prefs bus.
    persistAnchorGlyphVisibility(false);
    expect(webview.send).toHaveBeenCalledTimes(1);
    expect(webview.send).toHaveBeenCalledWith("sv:anchors", anchors, { anchorGlyphsVisible: false, notesHidden: false });

    dispose();
    persistAnchorGlyphVisibility(true);
    expect(webview.send).toHaveBeenCalledTimes(1); // unsubscribed by dispose
    webview.remove();
  });

  // —— The D11 hide-all flag reaching an already-painted guest ——

  it("re-pushes with the hide-all flag when it flips (connected webview)", () => {
    const webview = fakeWebview();
    document.body.appendChild(webview); // connected — the subscription stays live
    const anchors = [anchor("a1")];
    // Bound to a source so the per-source hide-all store is keyed and pinged.
    const { dispose } = bindWebviewAnchors(webview, () => anchors, "src-hide");

    persistNotesHidden("src-hide", true);
    expect(webview.send).toHaveBeenCalledTimes(1);
    expect(webview.send).toHaveBeenCalledWith("sv:anchors", anchors, { anchorGlyphsVisible: true, notesHidden: true });

    dispose();
    persistNotesHidden("src-hide", false);
    expect(webview.send).toHaveBeenCalledTimes(1); // unsubscribed by dispose
    webview.remove();
  });

  it("a removed webview (tab closed without dispose) self-unsubscribes on the next flip", () => {
    const webview = fakeWebview(); // never appended → isConnected is false
    bindWebviewAnchors(webview, () => [anchor("a1")]);

    persistAnchorGlyphVisibility(false); // first flip: detects the dead webview, no send
    persistAnchorGlyphVisibility(true);
    expect(webview.send).not.toHaveBeenCalled();
  });
});

// The bridge between the uniform surface contract and the guest IPC shapes — the
// pure boundary both webview readers use so the host can drive them with
// PaintAnchor[] / AnchorDraft like every other surface.
describe("toWebAnchorMsgs", () => {
  const pa = (over: Partial<PaintAnchor>): PaintAnchor => ({
    id: "a1",
    anchorKind: "web_text_quote",
    note: "",
    ...over
  });

  it("keeps only web_text_quote anchors and maps them to guest paint messages", () => {
    const anchors: PaintAnchor[] = [
      pa({ id: "w1", quote: "hello", contextBefore: "a ", contextAfter: " b", note: "n1" }),
      pa({ id: "h1", anchorKind: "html_selection", quote: "html quote", note: "ignored" }),
      pa({ id: "p1", anchorKind: "pdf_selection", quote: "pdf", note: "ignored" }),
      pa({ id: "i1", anchorKind: "image_region", note: "ignored" })
    ];
    expect(toWebAnchorMsgs(anchors)).toEqual([
      { id: "w1", quote: "hello", contextBefore: "a ", contextAfter: " b", note: "n1" }
    ]);
  });

  it("defaults missing quote/context to empty strings", () => {
    expect(toWebAnchorMsgs([pa({ id: "w1", note: "n" })])).toEqual([
      { id: "w1", quote: "", contextBefore: "", contextAfter: "", note: "n" }
    ]);
  });

  it("passes preview-card html and note count to the guest paint message", () => {
    expect(
      toWebAnchorMsgs([
        pa({
          id: "w-rich",
          note: "merged text",
          notePreviews: [
            { id: "n1", contentType: "markdown", text: "one", html: "<div>Card one</div>" },
            { id: "n2", contentType: "quiz", text: "two", html: "<div>Card two</div>" }
          ]
        })
      ])
    ).toEqual([
      {
        id: "w-rich",
        quote: "",
        contextBefore: "",
        contextAfter: "",
        note: "merged text",
        noteHtml: "<div>Card one</div><div>Card two</div>",
        noteCount: 2,
        noteTypes: ["markdown", "quiz"]
      }
    ]);
  });
});

describe("webSelectionToDraft", () => {
  it("maps a guest selection to a web quote draft keyed by the given url", () => {
    const draft = webSelectionToDraft(
      "src_1",
      { exact: "render thread", prefix: "the ", suffix: " submits" },
      "https://docs.test/a"
    );
    expect(draft).toEqual({
      mode: "quote",
      sourceId: "src_1",
      kind: "web",
      quote: "render thread",
      prefix: "the ",
      suffix: " submits",
      url: "https://docs.test/a"
    });
  });

  it("keys a local-HTML selection by its /api/local url (same web kind)", () => {
    const draft = webSelectionToDraft(
      "src_local",
      { exact: "the loop", prefix: "", suffix: "" },
      "/api/local/C%3A/docs/intro.html"
    );
    expect(draft).toMatchObject({ kind: "web", url: "/api/local/C%3A/docs/intro.html", quote: "the loop" });
  });

  it("returns null for a blank selection", () => {
    expect(webSelectionToDraft("s", { exact: "   ", prefix: "", suffix: "" }, "https://x.test")).toBeNull();
  });
});
