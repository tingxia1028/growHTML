import { ipcMain, type BrowserWindow } from "electron";
import { buildSubprocessEnv } from "../src/ai/claudeCliProvider";
import { resolveCwd } from "./ptyCwd";

export type PtyHandle = {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
};

export type PtySpawnOptions = {
  file: string;
  args: string[];
  cols: number;
  rows: number;
  cwd: string;
  onData: (data: string) => void;
  onExit: (code: number) => void;
};

export type PtySpawner = (options: PtySpawnOptions) => Promise<PtyHandle>;

// Real PTY via node-pty (lazy-imported native module, desktop-only). The
// API-key strip is reused so spawned `claude`/`codex` use subscription OAuth.
const realSpawner: PtySpawner = async (options) => {
  const pty = await import("node-pty");
  const env = buildSubprocessEnv(process.env, true) as Record<string, string>;
  const proc = pty.spawn(options.file, options.args, {
    name: "xterm-color",
    cols: options.cols,
    rows: options.rows,
    cwd: options.cwd,
    env
  });
  proc.onData(options.onData);
  proc.onExit(({ exitCode }) => options.onExit(exitCode));
  return {
    write: (data) => proc.write(data),
    resize: (cols, rows) => proc.resize(cols, rows),
    kill: () => proc.kill()
  };
};

// Deterministic in-process fake (no child process, no native module) used by the
// e2e: announces a ready banner and echoes input back. Selected with
// STUDY_VAULT_PTY_FAKE=1 so the full bridge↔IPC↔xterm pipeline is testable.
const fakeSpawner: PtySpawner = async (options) => {
  queueMicrotask(() =>
    options.onData(`[pty-fake] ready: ${options.file} ${options.args.join(" ")} @ ${options.cwd}\r\n`)
  );
  return {
    write: (data) => options.onData(data),
    resize: () => undefined,
    kill: () => options.onExit(0)
  };
};

export function defaultSpawner(env: NodeJS.ProcessEnv = process.env): PtySpawner {
  return env.STUDY_VAULT_PTY_FAKE ? fakeSpawner : realSpawner;
}

// Wires the renderer's terminal to PTY sessions over IPC. One hub per app.
export function registerPtyBridge(getWindow: () => BrowserWindow | null, spawner: PtySpawner = defaultSpawner()) {
  const sessions = new Map<string, PtyHandle>();
  let seq = 0;

  ipcMain.handle(
    "pty:start",
    async (_event, request: { file: string; args?: string[]; cols?: number; rows?: number; cwd?: string }) => {
    const id = `pty${(seq += 1)}`;
    const handle = await spawner({
      file: request.file,
      args: request.args ?? [],
      cols: request.cols ?? 80,
      rows: request.rows ?? 30,
      cwd: resolveCwd(request.cwd, process.cwd()),
      onData: (data) => getWindow()?.webContents.send("pty:data", { id, data }),
      onExit: (code) => getWindow()?.webContents.send("pty:exit", { id, code })
    });
    sessions.set(id, handle);
    return { id };
    }
  );

  ipcMain.on("pty:input", (_event, { id, data }: { id: string; data: string }) => sessions.get(id)?.write(data));
  ipcMain.on("pty:resize", (_event, { id, cols, rows }: { id: string; cols: number; rows: number }) =>
    sessions.get(id)?.resize(cols, rows)
  );
  ipcMain.on("pty:kill", (_event, { id }: { id: string }) => {
    sessions.get(id)?.kill();
    sessions.delete(id);
  });
}
