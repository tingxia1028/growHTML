import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Display-side HARD contract guard (design law §0.5-B / decision §6.6).
//
// note content reaches the screen through EXACTLY ONE path — getNoteType(contentType)
// .render(...). This CI-runnable test fails if HOST/WORKSPACE code regresses by:
//   (a) rendering note content OUTSIDE getNoteType().render — i.e. calling the raw
//       renderNoteContent() string renderer in a view;
//   (b) BRANCHING on `contentType === …` to choose a renderer (the "if it's a game
//       return <MyGameView/>" anti-pattern — adding a form must be register-only);
//   (c) SAVING a note with a hardcoded literal contentType (createNote / add-note
//       dispatch with contentType:"<literal>").
//
// It is a repo-grep guard (a custom ESLint rule would be heavier for the same reach).
// To stay LOW false-positive it strips comments first and scopes itself to the host
// surface (src/client/workspace) — the note-type PLUGINS (src/client/notes) own the
// legitimate render implementations and are intentionally NOT scanned.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOST_DIR = path.resolve(HERE, "../workspace");

// Strip // line comments, /* */ block comments, and JSX {/* */} comments so a comment
// that merely DESCRIBES the old anti-pattern (e.g. "instead of contentType:'markdown'")
// never trips the guard. Also drop the `getNoteType("markdown").render(...)` chat call:
// that string literal is a RENDER lookup, not a save, and is the sanctioned path.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "") // /* */ and {/* */}
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1"); // // line comments (not URLs like http://)
}

// The host files that make up the workspace surface (views + the context + the
// per-feature view modules). Anything under src/client/workspace ending in .ts/.tsx,
// excluding tests.
function hostFiles(): string[] {
  const out: string[] = [];
  for (const name of readdirSync(HOST_DIR)) {
    const full = path.join(HOST_DIR, name);
    if (statSync(full).isFile() && /\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

describe("display-side hard contract guard (§0.5-B / §6.6)", () => {
  const files = hostFiles();

  it("scans a non-empty host surface (sanity: the guard is actually reading files)", () => {
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((f) => f.endsWith("views.tsx"))).toBe(true);
  });

  it("(a) no host renders note content outside getNoteType().render (no raw renderNoteContent call)", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const code = stripComments(readFileSync(file, "utf8"));
      // A CALL to renderNoteContent( — the raw string renderer bypass. (An import of
      // the symbol alone is harmless; we look for an invocation.)
      if (/\brenderNoteContent\s*\(/.test(code)) offenders.push(path.basename(file));
    }
    expect(offenders, `renderNoteContent() called in: ${offenders.join(", ")}`).toEqual([]);
  });

  it("(b) no host branches on contentType === <literal> to choose a renderer", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const code = stripComments(readFileSync(file, "utf8"));
      // `contentType === "x"` / `=== contentType` used in a render decision. The ONLY
      // sanctioned equality is the picker SORT comparator in views.tsx (it orders the
      // create-picker, it does not pick a renderer) — allow that exact line.
      const lines = code.split("\n");
      for (const line of lines) {
        if (!/contentType\s*===|===\s*contentType/.test(line)) continue;
        // Allowlist: the composer picker sort (orders options; not a render branch).
        if (line.includes("localeCompare")) continue;
        offenders.push(`${path.basename(file)}: ${line.trim()}`);
      }
    }
    expect(offenders, `contentType === branch in:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("(c) no host saves a note with a hardcoded literal contentType", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const code = stripComments(readFileSync(file, "utf8"));
      // A save site is createNote({...}) or a dispatch to a note-creating command
      // ("anchor.add-note" / "bookmark.add"). Flag a STRING-LITERAL contentType in the
      // same object literal — the form must come from resolveForm/a draft/state, never
      // be hardcoded at the save call. (A literal in a TEST fixture or the bookmark
      // COMMAND itself lives outside the host surface and isn't scanned.)
      const callRe = /(createNote\s*\(|dispatch\s*\(\s*"(?:anchor\.add-note|bookmark\.add)")[\s\S]{0,200}?contentType\s*:\s*["'][a-z-]+["']/g;
      let m: RegExpExecArray | null;
      while ((m = callRe.exec(code)) !== null) {
        offenders.push(`${path.basename(file)}: …${m[0].slice(-60)}`);
      }
    }
    expect(offenders, `hardcoded contentType on save in:\n${offenders.join("\n")}`).toEqual([]);
  });
});
