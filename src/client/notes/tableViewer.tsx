// Table viewer — a concrete EXCLUSIVE viewer (plugin-viewer-model §4) that exercises the
// whole resolver chain end to end. It targets `markdown` notes whose body is a GFM pipe
// table: when the markdown IS a pipe table it renders a real HTML <table>; when it is not,
// it declines (match → 0) and the resolver falls back to the markdown NoteType renderer.
//
// This is registered TWO ways (side effect on import):
//   1. registerViewer(...) — into the exclusive viewer registry the resolver reads.
//   2. registerContribution("core", { kind: "viewer", ... }) — into the plugin READ MODEL
//      so the Kit & Plugin manager panel + its conflict UI can enumerate it.
// No note/source schema changes; markdown notes with non-table bodies render exactly as
// today (the fallback path is untouched).

import type { ReactNode } from "react";
import { registerViewer, type Viewer, type ViewerInput } from "./viewerRegistry";
import { namespaceId, registerContribution } from "../../kits/plugin";

// The markdown string of the input — the raw `content` (the chat/preview card path) or the
// saved note's body, or "" for anything that is not a plain-string body.
function markdownOf(input: ViewerInput): string {
  const content = input.content ?? input.note?.content;
  return typeof content === "string" ? content : "";
}

// A GFM pipe table = a header row with pipes, an immediately following SEPARATOR row of
// `---`/`:--:` cells, then ≥0 body rows. We detect the minimal shape: a `| … |` header
// line whose next non-empty line is a separator row (`| --- | :--: | … |`). Kept
// deliberately simple (matches the resolver's `match() true/false` test cases).
const PIPE_ROW = /^\s*\|.*\|\s*$/;
const SEPARATOR_ROW = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/;

export function isPipeTable(markdown: string): boolean {
  const lines = markdown.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return false;
  return PIPE_ROW.test(lines[0]) && SEPARATOR_ROW.test(lines[1]);
}

// Split a `| a | b |` row into trimmed cells, dropping the leading/trailing empties the
// outer pipes create.
function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((c) => c.trim());
}

function parseTable(markdown: string): { header: string[]; rows: string[][] } {
  const lines = markdown.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const header = splitRow(lines[0]);
  // lines[1] is the separator; body starts at lines[2].
  const rows = lines.slice(2).filter((l) => PIPE_ROW.test(l)).map(splitRow);
  return { header, rows };
}

function TableView({ markdown }: { markdown: string }): ReactNode {
  const { header, rows } = parseTable(markdown);
  return (
    <table className="note-table-viewer">
      <thead>
        <tr>
          {header.map((cell, i) => (
            <th key={i}>{cell}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, r) => (
          <tr key={r}>
            {row.map((cell, c) => (
              <td key={c}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export const TABLE_VIEWER_ID = "core:table";

// The viewer object, exported so tests can (re-)register it deterministically after a
// registry reset (side-effect registration below runs once at import).
export const tableViewer: Viewer = {
  id: TABLE_VIEWER_ID,
  pluginId: "core",
  label: "Table",
  // 1 when the note's markdown body IS a pipe table, else 0 (declines → markdown fallback).
  match: (input) => (isPipeTable(markdownOf(input)) ? 1 : 0),
  render: (input) => <TableView markdown={markdownOf(input)} />
};

/** Register the Table viewer into the exclusive registry + the plugin read model.
    Idempotent (both registries de-dupe by id), so re-calling is safe. */
export function registerTableViewer(): void {
  registerViewer(tableViewer);
  registerContribution("core", {
    id: namespaceId("core", "viewer", "table"),
    kind: "viewer",
    label: "Table",
    key: "table"
  });
}

// Register on import (the side-effect import in views.tsx drives this).
registerTableViewer();
