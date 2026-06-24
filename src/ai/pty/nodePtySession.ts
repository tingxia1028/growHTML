import { buildSubprocessEnv } from "../claudeCliProvider";
import type { PtySession } from "./session";

// Real PTY session backed by node-pty. node-pty is a native module, so it is
// imported dynamically (only when a PTY chat actually starts) to keep it out of
// the test/bundle graph until needed, and stays desktop/Node-only. The API-key
// strip is reused so subscription OAuth is used, never the metered API.
export async function createClaudePtySession(command = "claude"): Promise<PtySession> {
  const pty = await import("node-pty");
  const env = buildSubprocessEnv(process.env, true) as Record<string, string>;

  // On Windows `claude` is a .cmd shim that ConPTY's CreateProcess can't launch
  // directly, so run it through the shell. POSIX can exec the binary directly.
  const isWin = process.platform === "win32";
  const file = isWin ? process.env.ComSpec ?? "cmd.exe" : command;
  const args = isWin ? ["/c", command] : [];

  const proc = pty.spawn(file, args, {
    name: "xterm-color",
    cols: 80,
    rows: 30,
    cwd: process.cwd(),
    env
  });

  return {
    write: (data) => proc.write(data),
    onData: (listener) => {
      proc.onData(listener);
    },
    kill: () => proc.kill()
  };
}
