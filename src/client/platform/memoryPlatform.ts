// memoryPlatform — the test/mock seam, the client analog of the core's
// MemoryStorageAdapter (src/core/storage/memoryStorage.ts). Prefs live in an
// in-memory Map, dialogs return injectable canned answers (so a test never blocks
// on a real window.confirm), files/clipboard are in-memory, and assets.url resolves
// to the same `/api/assets/${id}` shape the real client uses. Nothing touches
// window / studyVault / localStorage, so it runs in a bare (non-jsdom) unit test.
//
// Pass `overrides` to inject dialog answers, seed prefs, or flip capabilities.
// See docs/implementation/platform-layering-build-spec.md §1.7.

import type {
  PlatformAdapter,
  PlatformCapabilities,
  PlatformDialogs,
  PlatformFiles,
  PlatformNative
} from "./types";

export interface MemoryPlatformOverrides {
  kind?: PlatformAdapter["kind"];
  capabilities?: Partial<PlatformCapabilities>;
  /** Seed the in-memory prefs Map. */
  prefs?: Record<string, string>;
  /** Canned dialog answers (default confirm→true, prompt→null, alert→noop). */
  dialogs?: Partial<PlatformDialogs>;
  /** Canned file-picker answers (default → null). */
  files?: Partial<PlatformFiles>;
  native?: PlatformNative;
}

const NO_CAPABILITIES: PlatformCapabilities = {
  nativeFileDialogs: false,
  shellOpen: false,
  terminal: false,
  windowChrome: false,
  webview: false,
  notification: false,
  microphone: false
};

export function memoryPlatform(
  overrides: MemoryPlatformOverrides = {}
): PlatformAdapter {
  const store = new Map<string, string>(
    Object.entries(overrides.prefs ?? {})
  );
  let clipboardText = "";

  const dialogs: PlatformDialogs = {
    confirm: overrides.dialogs?.confirm ?? (() => Promise.resolve(true)),
    prompt: overrides.dialogs?.prompt ?? (() => Promise.resolve(null)),
    alert: overrides.dialogs?.alert ?? (() => Promise.resolve())
  };

  const files: PlatformFiles = {
    pickFile: overrides.files?.pickFile ?? (() => Promise.resolve(null)),
    pickDirectory:
      overrides.files?.pickDirectory ?? (() => Promise.resolve(null))
  };

  return {
    kind: overrides.kind ?? "web",
    capabilities: { ...NO_CAPABILITIES, ...overrides.capabilities },
    prefs: {
      get: (key) => (store.has(key) ? store.get(key)! : null),
      set: (key, value) => {
        store.set(key, value);
      },
      remove: (key) => {
        store.delete(key);
      }
    },
    dialogs,
    files,
    clipboard: {
      writeText: (text) => {
        clipboardText = text;
        return Promise.resolve();
      },
      readText: () => Promise.resolve(clipboardText)
    },
    assets: {
      url: (assetId) => `/api/assets/${assetId}`
    },
    native: overrides.native
  };
}
