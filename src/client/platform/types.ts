// PlatformAdapter — the single seam between the client (views + domains) and the
// host it runs on (Electron desktop today; a Capacitor mobile shell / a plain
// browser later). Everything platform-specific the UI reaches for — file dialogs,
// clipboard, shell/webview/pty natives, localStorage prefs, confirm/prompt/alert,
// and asset URL resolution — funnels through this interface so a view never touches
// `window.studyVault` / `localStorage` / `window.confirm` directly.
//
// See docs/implementation/platform-layering-build-spec.md §1.2. This file is the
// TYPE contract only; the concrete adapters (desktop/web/memory) implement it.
//
// `pty` reuses the exact bridge shape the Electron preload exposes. StudyVaultPty
// is declared globally by the ambient electron.d.ts (not a module), so it is
// referenced directly rather than imported.

export type PlatformKind = "desktop" | "web" | "mobile";

export interface PlatformCapabilities {
  /** Native OS file/folder pickers (studyVault.openFile / pickDirectory). */
  nativeFileDialogs: boolean;
  /** Open a path with the OS default app (shell.openPath). */
  shellOpen: boolean;
  /** An embedded terminal is available (studyVault.pty). */
  terminal: boolean;
  /** Custom window chrome / traffic-light controls (studyVault.windowControls). */
  windowChrome: boolean;
  /** In-app webview surface (studyVault.webviewPreloadUrl). */
  webview: boolean;
  /** The Notification API is present (NudgeToast). */
  notification: boolean;
  /** getUserMedia is available (useVoiceInput). */
  microphone: boolean;
}

export interface PlatformPrefs {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

// ASYNC by design — the mobile (Capacitor) equivalents are promise-based, so the
// desktop/web adapters wrap the synchronous window.* calls in a resolved promise
// rather than forcing every caller to branch. See §1.5.
export interface PlatformDialogs {
  confirm(message: string): Promise<boolean>;
  prompt(message: string, defaultValue?: string): Promise<string | null>;
  alert(message: string): Promise<void>;
}

export interface PlatformFiles {
  /** Resolves to the chosen file's path, or null if cancelled/unsupported. */
  pickFile(): Promise<string | null>;
  /** Resolves to the chosen folder's path, or null if cancelled/unsupported. */
  pickDirectory(): Promise<string | null>;
}

export interface PlatformClipboard {
  writeText(text: string): Promise<void>;
  readText(): Promise<string>;
}

export interface PlatformAssets {
  /** Resolve an asset id to a URL the current host's <img>/loader can fetch. */
  url(assetId: string): string;
}

// Desktop-only escape hatches; `undefined` on web/mobile. Capabilities gate their
// use, and each field is individually optional so a partial host (or a future
// mobile native bridge) can expose a subset.
export interface PlatformNative {
  /** shell.openPath — resolves to Electron's error string ("" on success). */
  shellOpenPath?(path: string): Promise<string>;
  /** Open an external URL (routes the UserMenu window.open). */
  openUrl?(url: string): void;
  windowControls?: { minimize(): void; toggleMaximize(): void; close(): void };
  webviewPreloadUrl?: string;
  pty?: StudyVaultPty;
}

export interface PlatformAdapter {
  kind: PlatformKind;
  capabilities: PlatformCapabilities;
  prefs: PlatformPrefs;
  dialogs: PlatformDialogs;
  files: PlatformFiles;
  clipboard: PlatformClipboard;
  assets: PlatformAssets;
  native?: PlatformNative;
}
