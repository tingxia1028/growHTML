import path from "node:path";
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell } from "electron";
import log from "electron-log/main";
import { startServer, type StartedServer } from "../src/server/start";
import { getDefaultVaultRoot } from "../src/core/vault";
import { DEV_SERVER_URL, isDevMode, resolveVaultRoot } from "./shell";
import { registerPtyBridge } from "./pty-bridge";

let started: StartedServer | null = null;
let mainWindow: BrowserWindow | null = null;

app.setName("Growte");
if (process.platform === "win32") app.setAppUserModelId("com.growte.desktop");

// Main-process file log (X1): <userData>/logs/main.log — the packaged app has no
// console, so boot info (server URL, vault root) and updater events land here.
log.initialize();
log.errorHandler.startCatching();

function loadAppIcon() {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, "assets", "growte-anchor.ico")
    : path.join(process.cwd(), "electron", "assets", "growte-anchor.ico");
  const icon = nativeImage.createFromPath(iconPath);
  return icon.isEmpty() ? undefined : icon;
}

function windowForEvent(event: Electron.IpcMainEvent) {
  return BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
}

async function resolveStartUrl(): Promise<string> {
  if (isDevMode(process.env, process.argv)) {
    // Dev: `npm run dev` runs the API (4177) + Vite (5173, which proxies /api).
    return process.env.ELECTRON_DEV_URL ?? DEV_SERVER_URL;
  }
  // Prod: boot the single-origin server that also serves the bundled client.
  // Vault root: packaged → <userData>/vault; unpackaged (repo) → data/vault as
  // before; STUDY_VAULT_ROOT env always wins (resolved inside openVault).
  const vaultRoot =
    resolveVaultRoot(process.env, app.isPackaged, app.getPath("userData"), path.join) ?? getDefaultVaultRoot();
  started = await startServer({ port: 0, clientDir: path.join(__dirname, "..", "dist"), vaultRoot });
  log.info(`[boot] Growte ${app.getVersion()} server ${started.url} vault ${vaultRoot}`);
  return started.url;
}

// electron-updater against GitHub Releases (X1): packaged builds only — the dev
// tree has no app-update.yml. checkForUpdatesAndNotify shows the native toast
// when a release is downloaded; every failure is logged and NEVER blocks boot.
async function checkForUpdates() {
  if (!app.isPackaged) return;
  try {
    const { autoUpdater } = await import("electron-updater");
    autoUpdater.logger = log;
    await autoUpdater.checkForUpdatesAndNotify();
  } catch (error) {
    log.warn("[updater] check failed (non-fatal):", error);
  }
}

async function createWindow() {
  const startUrl = await resolveStartUrl();
  const appIcon = loadAppIcon();

  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    title: "AI Study Vault",
    icon: appIcon,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: "#f5f1e8",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      // sandbox off so the preload can resolve the guest webview preload path;
      // contextIsolation (the real boundary) stays on and the renderer has no Node.
      sandbox: false,
      // Enables <webview> for live web-page annotation.
      webviewTag: true,
      // Enables Chromium's built-in PDFium viewer so PDFs render natively (with a
      // scrollbar, zoom, paging and search) in an <iframe> pointed at the file.
      plugins: true
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

// Native folder picker — used both for the AI terminal's working directory and
// for opening a folder as a browsable file tree in the sidebar.
ipcMain.handle("dialog:pickDirectory", async () => {
  const options: Electron.OpenDialogOptions = { properties: ["openDirectory"] };
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// Native file picker for opening a single local file as a source.
ipcMain.handle("dialog:openFile", async () => {
  const options: Electron.OpenDialogOptions = { properties: ["openFile"] };
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// Open a LOCAL path with the OS default handler (the file-link note's 打开 action).
// Guarded: only absolute local file paths are accepted — never URLs/schemes (a note's
// path is user/vault data, so shell-opening arbitrary strings would be an easy
// footgun). Mirrors shell.openPath's own contract: resolves to an error string,
// "" on success.
ipcMain.handle("shell:openPath", async (_event, target: unknown) => {
  if (typeof target !== "string") return "Invalid path";
  const trimmed = target.trim();
  if (!trimmed || !path.isAbsolute(trimmed) || /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    return "Not a local file path";
  }
  return shell.openPath(trimmed);
});

ipcMain.on("window:minimize", (event) => {
  windowForEvent(event)?.minimize();
});

ipcMain.on("window:toggleMaximize", (event) => {
  const target = windowForEvent(event);
  if (!target) return;
  if (target.isMaximized()) target.unmaximize();
  else target.maximize();
});

ipcMain.on("window:close", (event) => {
  windowForEvent(event)?.close();
});

app
  .whenReady()
  .then(() => {
    Menu.setApplicationMenu(null);
    registerPtyBridge(() => mainWindow);
    return createWindow();
  })
  .then(() => {
    // Fire-and-forget: the window is already up; update errors only log.
    void checkForUpdates();
  })
  .catch((error) => {
    log.error("Failed to start AI Study Vault:", error);
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
