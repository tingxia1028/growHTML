// desktopPlatform — the Electron adapter. Wraps the `window.studyVault` preload
// bridge, `globalThis.localStorage`, `window.confirm/prompt/alert` (async-wrapped),
// and `navigator.clipboard`. Capabilities are derived from which studyVault members
// the preload actually exposes, so a partial bridge degrades cleanly rather than
// throwing. See docs/implementation/platform-layering-build-spec.md §1.2, §1.6.

import { entityClient } from "../data/entityClient";
import type {
  PlatformAdapter,
  PlatformCapabilities,
  PlatformNative
} from "./types";

export function desktopPlatform(): PlatformAdapter {
  const studyVault = window.studyVault;

  const capabilities: PlatformCapabilities = {
    nativeFileDialogs: !!studyVault?.openFile,
    shellOpen: !!studyVault?.openPath,
    terminal: !!studyVault?.pty,
    windowChrome: !!studyVault?.windowControls,
    webview: !!studyVault?.webviewPreloadUrl,
    notification: typeof Notification !== "undefined",
    microphone: !!navigator.mediaDevices?.getUserMedia
  };

  // Only construct the native slot when the bridge is present. Every field is a
  // straight pass-through to the preload; openUrl is the one non-studyVault member
  // (external-URL opens go through window.open, not the JSON transport).
  const native: PlatformNative | undefined = studyVault
    ? {
        shellOpenPath: studyVault.openPath,
        openUrl: (url: string) => {
          window.open(url, "_blank");
        },
        windowControls: studyVault.windowControls,
        webviewPreloadUrl: studyVault.webviewPreloadUrl,
        pty: studyVault.pty
      }
    : undefined;

  return {
    kind: "desktop",
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
      pickFile: () => studyVault?.openFile?.() ?? Promise.resolve(null),
      pickDirectory: () => studyVault?.pickDirectory?.() ?? Promise.resolve(null)
    },
    clipboard: {
      writeText: (text) =>
        navigator.clipboard?.writeText(text) ?? Promise.resolve(),
      readText: () => navigator.clipboard?.readText() ?? Promise.resolve("")
    },
    assets: {
      url: (assetId) => entityClient.assetUrl(assetId)
    },
    native
  };
}
