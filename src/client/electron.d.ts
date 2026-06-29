// Surface exposed by the Electron preload (electron/preload.ts). Absent when the
// app runs as a plain web page in the browser.
interface StudyVaultPty {
  start(request: { file: string; args?: string[]; cols?: number; rows?: number; cwd?: string }): Promise<{ id: string }>;
  onData(callback: (payload: { id: string; data: string }) => void): () => void;
  onExit(callback: (payload: { id: string; code: number }) => void): () => void;
  input(id: string, data: string): void;
  resize(id: string, cols: number, rows: number): void;
  kill(id: string): void;
}

interface StudyVaultBridge {
  desktop: boolean;
  platform: string;
  webviewPreloadUrl?: string;
  windowControls?: {
    minimize(): void;
    toggleMaximize(): void;
    close(): void;
  };
  pty?: StudyVaultPty;
  // Opens a native folder picker; resolves to the chosen path or null if cancelled.
  pickDirectory?(): Promise<string | null>;
  // Opens a native file picker; resolves to the chosen path or null if cancelled.
  openFile?(): Promise<string | null>;
  // Resolves a File (from a file input) to its absolute disk path (Electron only).
  getPathForFile?(file: File): string;
}

interface Window {
  studyVault?: StudyVaultBridge;
}
