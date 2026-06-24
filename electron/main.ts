import path from "node:path";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { startServer, type StartedServer } from "../src/server/start";
import { DEV_SERVER_URL, isDevMode } from "./shell";
import { registerPtyBridge } from "./pty-bridge";

let started: StartedServer | null = null;
let mainWindow: BrowserWindow | null = null;

async function resolveStartUrl(): Promise<string> {
  if (isDevMode(process.env, process.argv)) {
    // Dev: `npm run dev` runs the API (4177) + Vite (5173, which proxies /api).
    return process.env.ELECTRON_DEV_URL ?? DEV_SERVER_URL;
  }
  // Prod: boot the single-origin server that also serves the bundled client.
  started = await startServer({ port: 0, clientDir: path.join(__dirname, "..", "dist") });
  return started.url;
}

async function createWindow() {
  const startUrl = await resolveStartUrl();

  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    title: "AI Study Vault",
    backgroundColor: "#f5f1e8",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      // sandbox off so the preload can resolve the guest webview preload path;
      // contextIsolation (the real boundary) stays on and the renderer has no Node.
      sandbox: false,
      // Enables <webview> for live web-page annotation.
      webviewTag: true
    }
  });

  // Open target=_blank links (e.g. shared note links) in the system browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow = window;
  await window.loadURL(startUrl);
}

// Guest <webview> contents (the live web reader) get their own handling so
// links / window.open / target=_blank navigate INSIDE the embedded view instead
// of popping out to the system browser. The main window's handler above is left
// untouched for non-webview contents (e.g. shared note links).
app.on("web-contents-created", (_event, contents) => {
  if (contents.getType() !== "webview") return;
  contents.setWindowOpenHandler(({ url }) => {
    void contents.loadURL(url);
    return { action: "deny" };
  });
});

// Native folder picker for choosing the AI terminal's working directory.
ipcMain.handle("dialog:pickDirectory", async () => {
  const options: Electron.OpenDialogOptions = { properties: ["openDirectory"] };
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

app
  .whenReady()
  .then(() => {
    registerPtyBridge(() => mainWindow);
    return createWindow();
  })
  .catch((error) => {
    console.error("Failed to start AI Study Vault:", error);
    app.quit();
  });

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  void started?.close();
});
