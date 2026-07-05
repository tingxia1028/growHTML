// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { memoryPlatform } from "./memoryPlatform";
import { getPlatform, setPlatform } from "./platformSingleton";
import { platformDialogs } from "./dialogs";
import type { PlatformAdapter } from "./types";
import {
  PlatformProvider,
  detectPlatform,
  usePlatform,
  usePlatformOptional
} from "./PlatformContext";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("memoryPlatform", () => {
  it("round-trips prefs get/set/remove", () => {
    const p = memoryPlatform();
    expect(p.prefs.get("k")).toBeNull();
    p.prefs.set("k", "v");
    expect(p.prefs.get("k")).toBe("v");
    p.prefs.remove("k");
    expect(p.prefs.get("k")).toBeNull();
  });

  it("returns injected canned dialog answers", async () => {
    const p = memoryPlatform({
      dialogs: {
        confirm: () => Promise.resolve(false),
        prompt: () => Promise.resolve("typed")
      }
    });
    expect(await p.dialogs.confirm("?")).toBe(false);
    expect(await p.dialogs.prompt("?")).toBe("typed");
  });

  it("defaults dialogs to confirm→true / prompt→null / alert→noop", async () => {
    const p = memoryPlatform();
    expect(await p.dialogs.confirm("?")).toBe(true);
    expect(await p.dialogs.prompt("?")).toBeNull();
    await expect(p.dialogs.alert("!")).resolves.toBeUndefined();
  });

  it("resolves assets.url to /api/assets/${id}", () => {
    expect(memoryPlatform().assets.url("x")).toBe("/api/assets/x");
  });
});

describe("platformSingleton", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("round-trips setPlatform/getPlatform", () => {
    const p = memoryPlatform();
    setPlatform(p);
    expect(getPlatform()).toBe(p);
  });

  it("throws when the platform is unset", async () => {
    // Fresh module instance so `current` starts null regardless of test order.
    vi.resetModules();
    const mod = await import("./platformSingleton");
    expect(() => mod.getPlatform()).toThrow(/Platform not set/);
  });
});

describe("platformDialogs (the dialogs funnel)", () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("returns the active adapter's dialogs when a platform is set", async () => {
    const confirm = () => Promise.resolve(false);
    const p = memoryPlatform({ dialogs: { confirm } });
    setPlatform(p);
    // Same-module import: platformDialogs reads the singleton `current` set above.
    expect(platformDialogs()).toBe(p.dialogs);
    expect(await platformDialogs().confirm("?")).toBe(false);
  });

  it("falls back to window.confirm/prompt/alert when NO platform is set", async () => {
    // Fresh module instances so the singleton `current` starts null regardless of order,
    // AND platformDialogs reads THAT same fresh singleton (same import graph).
    vi.resetModules();
    const { platformDialogs: freshDialogs } = await import("./dialogs");

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("typed");
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});

    expect(await freshDialogs().confirm("go?")).toBe(false);
    expect(confirmSpy).toHaveBeenCalledWith("go?");
    expect(await freshDialogs().prompt("name?", "seed")).toBe("typed");
    expect(promptSpy).toHaveBeenCalledWith("name?", "seed");
    await expect(freshDialogs().alert("hi")).resolves.toBeUndefined();
    expect(alertSpy).toHaveBeenCalledWith("hi");
  });
});

describe("detectPlatform", () => {
  const original = (globalThis as { studyVault?: unknown }).studyVault;
  afterEach(() => {
    // jsdom's window is globalThis; restore whatever was there.
    if (original === undefined) delete (window as { studyVault?: unknown }).studyVault;
    else (window as { studyVault?: unknown }).studyVault = original;
  });

  it("returns a web adapter when window.studyVault is undefined", () => {
    delete (window as { studyVault?: unknown }).studyVault;
    const p = detectPlatform();
    expect(p.kind).toBe("web");
    expect(p.capabilities.nativeFileDialogs).toBe(false);
    expect(p.native).toBeUndefined();
  });

  it("returns a desktop adapter with derived capabilities when studyVault is present", () => {
    (window as { studyVault?: unknown }).studyVault = {
      desktop: true,
      openFile: () => Promise.resolve(null),
      pickDirectory: () => Promise.resolve(null),
      openPath: () => Promise.resolve(""),
      pty: {},
      windowControls: { minimize() {}, toggleMaximize() {}, close() {} },
      webviewPreloadUrl: "x"
    };
    const p = detectPlatform();
    expect(p.kind).toBe("desktop");
    expect(p.capabilities.nativeFileDialogs).toBe(true);
    expect(p.capabilities.shellOpen).toBe(true);
    expect(p.capabilities.terminal).toBe(true);
    expect(p.capabilities.windowChrome).toBe(true);
    expect(p.capabilities.webview).toBe(true);
    expect(p.native).toBeDefined();
  });

  it("degrades every capability to false when the bridge is partial (desktop:true only)", () => {
    (window as { studyVault?: unknown }).studyVault = { desktop: true };
    const p = detectPlatform();
    expect(p.kind).toBe("desktop");
    expect(p.capabilities.nativeFileDialogs).toBe(false);
    expect(p.capabilities.shellOpen).toBe(false);
    expect(p.capabilities.terminal).toBe(false);
    expect(p.capabilities.windowChrome).toBe(false);
    expect(p.capabilities.webview).toBe(false);
  });
});

describe("PlatformProvider / usePlatform", () => {
  function mount(node: ReturnType<typeof createElement>) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(node));
    return {
      container,
      cleanup: () => {
        act(() => root.unmount());
        container.remove();
      }
    };
  }

  it("renders children unchanged (no-op wiring)", () => {
    const { container, cleanup } = mount(
      createElement(PlatformProvider, {
        platform: memoryPlatform(),
        children: createElement("span", null, "ok")
      })
    );
    expect(container.textContent).toContain("ok");
    cleanup();
  });

  it("usePlatform returns the provided instance inside a provider", () => {
    const p = memoryPlatform();
    let captured: PlatformAdapter | null = null;
    function Probe() {
      captured = usePlatform();
      return null;
    }
    const { cleanup } = mount(
      createElement(PlatformProvider, { platform: p, children: createElement(Probe) })
    );
    expect(captured).toBe(p);
    cleanup();
  });

  it("usePlatformOptional returns null with no provider (usePlatform's throw-guard basis)", () => {
    let captured: PlatformAdapter | null = memoryPlatform();
    function Probe() {
      captured = usePlatformOptional();
      return null;
    }
    const { cleanup } = mount(createElement(Probe));
    expect(captured).toBeNull();
    cleanup();
  });
});
