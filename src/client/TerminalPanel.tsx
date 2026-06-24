import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

type TerminalPanelProps = {
  // When set (e.g. the folder of the file being read), seeds the working dir.
  defaultCwd?: string;
};

// Visible xterm.js terminal wired to a main-process PTY (electron/pty-bridge).
// Run `claude`, `codex`, or any shell command live in-app. Desktop only.
export function TerminalPanel({ defaultCwd = "" }: TerminalPanelProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mirrorRef = useRef<HTMLPreElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const idRef = useRef<string>("");
  const [command, setCommand] = useState("claude");
  const [cwd, setCwd] = useState(defaultCwd);
  const [running, setRunning] = useState(false);

  const pty = typeof window !== "undefined" ? window.studyVault?.pty : undefined;
  const pickDirectory = typeof window !== "undefined" ? window.studyVault?.pickDirectory : undefined;

  // Follow the active source's folder until a session is running (don't yank the
  // cwd out from under a live terminal, and don't fight the user's manual edit
  // mid-session). New default after the session ends will apply on next change.
  useEffect(() => {
    if (!running) setCwd(defaultCwd);
  }, [defaultCwd, running]);

  useEffect(() => {
    if (!pty || !hostRef.current) return;
    const term = new Terminal({ convertEol: true, fontSize: 13, theme: { background: "#1e1b16" } });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    fit.fit();
    term.onData((data) => {
      if (idRef.current) pty.input(idRef.current, data);
    });
    termRef.current = term;
    fitRef.current = fit;

    const offData = pty.onData(({ id, data }) => {
      if (id !== idRef.current) return;
      term.write(data);
      if (mirrorRef.current) mirrorRef.current.textContent += data;
    });
    const offExit = pty.onExit(({ id }) => {
      if (id === idRef.current) setRunning(false);
    });
    const onResize = () => {
      fit.fit();
      if (idRef.current) pty.resize(idRef.current, term.cols, term.rows);
    };
    window.addEventListener("resize", onResize);

    return () => {
      offData();
      offExit();
      window.removeEventListener("resize", onResize);
      if (idRef.current) pty.kill(idRef.current);
      term.dispose();
    };
  }, [pty]);

  async function start() {
    const term = termRef.current;
    if (!pty || !term) return;
    if (idRef.current) pty.kill(idRef.current);
    if (mirrorRef.current) mirrorRef.current.textContent = "";
    term.reset();
    const parts = command.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return;
    const { id } = await pty.start({
      file: parts[0],
      args: parts.slice(1),
      cols: term.cols,
      rows: term.rows,
      cwd: cwd.trim() || undefined
    });
    idRef.current = id;
    setRunning(true);
    term.focus();
  }

  if (!pty) {
    return <div className="empty-reader">The AI terminal runs in the desktop app — launch with npm run electron.</div>;
  }

  async function chooseDirectory() {
    const picked = await pickDirectory?.();
    if (picked) setCwd(picked);
  }

  return (
    <div className="terminal-panel">
      <div className="terminal-cwd">
        <input
          className="terminal-cwd-input"
          aria-label="Working directory"
          value={cwd}
          onChange={(event) => setCwd(event.target.value)}
          placeholder="Working directory (defaults to the file's folder)"
        />
        {pickDirectory ? (
          <button className="icon-button" type="button" onClick={() => void chooseDirectory()}>
            Choose…
          </button>
        ) : null}
      </div>
      <div className="terminal-bar">
        <input
          className="terminal-command"
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          placeholder="claude / codex / cmd"
        />
        <button className="icon-button" type="button" onClick={() => void start()}>
          {running ? "Restart" : "Start"}
        </button>
      </div>
      <div ref={hostRef} className="xterm-host" />
      <pre ref={mirrorRef} className="pty-raw" aria-hidden="true" />
    </div>
  );
}
