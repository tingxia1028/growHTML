import path from "node:path";
import { contextBridge, ipcRenderer, webUtils } from "electron";

// Minimal, locked-down bridge. The renderer talks to the backend over HTTP, so
// it needs no privileged Node access. We expose an identity surface, the guest
// webview preload path, and a terminal (PTY) channel for the AI terminal.
const webviewPreloadUrl = "file:///" + path.join(__dirname, "webview-preload.cjs").replace(/\\/g, "/");

type PtyData = { id: string; data: string };
type PtyExit = { id: string; code: number };

contextBridge.exposeInMainWorld("studyVault", {
  desktop: true,
  platform: process.platform,
  webviewPreloadUrl,
  // Native folder picker (AI terminal cwd + "Open Folder" file tree).
  pickDirectory: () => ipcRenderer.invoke("dialog:pickDirectory") as Promise<string | null>,
  // Native file picker for "Open File"; resolves to the chosen path or null.
  openFile: () => ipcRenderer.invoke("dialog:openFile") as Promise<string | null>,
  // Resolve a File (from an <input type=file>) back to its absolute disk path so
  // the terminal can default to the directory of the file being read.
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  pty: {
    start: (request: { file: string; args?: string[]; cols?: number; rows?: number; cwd?: string }) =>
      ipcRenderer.invoke("pty:start", request) as Promise<{ id: string }>,
    onData: (callback: (payload: PtyData) => void) => {
      const listener = (_event: unknown, payload: PtyData) => callback(payload);
      ipcRenderer.on("pty:data", listener);
      return () => ipcRenderer.removeListener("pty:data", listener);
    },
    onExit: (callback: (payload: PtyExit) => void) => {
      const listener = (_event: unknown, payload: PtyExit) => callback(payload);
      ipcRenderer.on("pty:exit", listener);
      return () => ipcRenderer.removeListener("pty:exit", listener);
    },
    input: (id: string, data: string) => ipcRenderer.send("pty:input", { id, data }),
    resize: (id: string, cols: number, rows: number) => ipcRenderer.send("pty:resize", { id, cols, rows }),
    kill: (id: string) => ipcRenderer.send("pty:kill", { id })
  }
});
