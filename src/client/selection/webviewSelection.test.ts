// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bindWebviewSelection,
  normalizeWebSelection,
  webviewPreloadUrl,
  type SelectionWebview,
  type WebviewIpcMessage
} from "./webviewSelection";

// A minimal stand-in for an Electron <webview>: a real EventTarget (so the shared
// ipc-message listener attaches/detaches for real) plus the two methods the
// selection wiring calls. ipc-message events are plain Events with channel/args.
function fakeWebview(url = "https://example.test/page"): SelectionWebview & { fire: (channel: string, ...args: unknown[]) => void } {
  const el = document.createElement("div") as unknown as SelectionWebview & {
    fire: (channel: string, ...args: unknown[]) => void;
  };
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
  return el;
}

afterEach(() => {
  // Remove any preload url injected onto the shared bridge surface.
  delete (window as { studyVault?: unknown }).studyVault;
});

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
