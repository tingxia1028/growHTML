// webPlatform — the plain-browser adapter (no Electron preload). This is the
// §1.6 degrade table: every native capability is false, file pickers resolve to
// null (a bare browser can't hand back an absolute path; the <input type=file>
// path is a separate UI concern), and there is no `native` slot. Prefs still ride
// localStorage, dialogs still ride window.*, and asset URLs still resolve through
// entityClient (byte-identical to desktop) — those work in any browser.
// See docs/implementation/platform-layering-build-spec.md §1.6.

import { entityClient } from "../data/entityClient";
import type { PlatformAdapter, PlatformCapabilities } from "./types";

export function webPlatform(): PlatformAdapter {
  const capabilities: PlatformCapabilities = {
    nativeFileDialogs: false,
    shellOpen: false,
    terminal: false,
    windowChrome: false,
    webview: false,
    notification: false,
    microphone: false
  };

  return {
    kind: "web",
    capabilities,
    prefs: {
      get: (key) => globalThis.localStorage?.getItem(key) ?? null,
      set: (key, value) => globalThis.localStorage?.setItem(key, value),
      remove: (key) => globalThis.localStorage?.removeItem(key)
    },
    dialogs: {
      confirm: (message) => Promise.resolve(window.confirm(message)),
      prompt: (message, defaultValue) =>
        Promise.resolve(window.prompt(message, defaultValue)),
      alert: (message) => {
        window.alert(message);
        return Promise.resolve();
      }
    },
    files: {
      pickFile: () => Promise.resolve(null),
      pickDirectory: () => Promise.resolve(null)
    },
    clipboard: {
      writeText: (text) =>
        navigator.clipboard?.writeText(text) ?? Promise.resolve(),
      readText: () => navigator.clipboard?.readText() ?? Promise.resolve("")
    },
    assets: {
      url: (assetId) => entityClient.assetUrl(assetId)
    }
    // native: undefined — no desktop escape hatches in a plain browser.
  };
}
