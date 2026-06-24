// Strips ANSI escape sequences (colors, cursor moves, OSC titles) and carriage
// returns from raw terminal output so a PTY-backed provider can return clean
// text. ESC/BEL are built via String.fromCharCode so the source holds no
// literal control bytes.
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const CSI = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, "g"); // ESC [ ... final
const OSC = new RegExp(`${ESC}\\][^${BEL}]*${BEL}?`, "g"); // ESC ] ... BEL
const SINGLE_ESC = new RegExp(`${ESC}[@-Z\\\\-_]`, "g"); // other two-byte escapes

export function stripAnsi(input: string): string {
  return input
    .replace(OSC, "")
    .replace(CSI, "")
    .replace(SINGLE_ESC, "")
    .replace(/\r/g, "");
}

// Clean a captured PTY turn into plain assistant text. Without a stable CLI
// output contract this is just strip+trim; tune the marker handling against the
// real `claude` TUI on a machine with an authenticated CLI.
export function extractAnswer(raw: string): string {
  return stripAnsi(raw).trim();
}
