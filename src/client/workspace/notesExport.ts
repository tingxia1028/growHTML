// D10 export — a portable, per-source export of the current source's notes/anchors
// (+ their persisted positions where meaningful), to markdown AND JSON
// (note-presentation-unified.md §10: "a note fixed open, at a remembered position,
// carried on export").
//
// Pure + React-free so it is unit-testable and the shape can be pinned. The JSON is
// the round-trippable truth (anchors + notes incl. note.display); the markdown is the
// human-readable companion. Readable note text comes from the SHARED note toSearchText
// idiom (getNoteContentSpec(...).toSearchText) — the same portable-text reducer search
// and .svpack use — so we never re-invent a per-type stringifier here.

import type { AnyAnchor, NoteRecord, SourceRecord } from "../data/entityClient";
import { getNoteContentSpec } from "../../core/notes/contentTypes";

// A note's display record (D10) as it appears on the exported note.
export type NoteDisplayExport = {
  open?: boolean;
  offset?: { dx: number; dy: number };
  size?: { w: number; h: number };
};

export type ExportedNote = {
  id: string;
  contentType: string;
  anchorIds: string[];
  /** The note's structured content, verbatim (round-trippable). */
  content: unknown;
  /** Human-readable reduction via the note type's toSearchText (no structural noise). */
  text: string;
  /** D10 persisted presentation — omitted when the note has none. */
  display?: NoteDisplayExport;
};

export type ExportedAnchor = {
  id: string;
  anchorKind: string;
  quote?: string;
  page?: number;
  rect?: [number, number, number, number];
};

export type NotesExport = {
  app: "ai-study-vault";
  kind: "source-notes-export";
  exportedAt: string;
  source: { id: string; title: string; sourceType: string };
  anchors: ExportedAnchor[];
  notes: ExportedNote[];
};

// Reduce a note's content to readable text through the shared spec idiom; falls back
// to a compact JSON string for an unknown type so the export is never lossy.
function noteReadableText(contentType: string, content: unknown): string {
  const spec = getNoteContentSpec(contentType);
  if (spec) {
    try {
      return spec.toSearchText(content).trim();
    } catch {
      // A malformed content shape — fall through to the JSON fallback.
    }
  }
  if (typeof content === "string") return content.trim();
  try {
    return JSON.stringify(content);
  } catch {
    return "";
  }
}

// The optional per-note display record, normalized to the export shape (dropping any
// stray keys) — undefined when the note carries no display state.
function exportDisplay(note: NoteRecord): NoteDisplayExport | undefined {
  const d = note.display;
  if (!d) return undefined;
  const out: NoteDisplayExport = {};
  if (typeof d.open === "boolean") out.open = d.open;
  if (d.offset && typeof d.offset.dx === "number" && typeof d.offset.dy === "number") {
    out.offset = { dx: d.offset.dx, dy: d.offset.dy };
  }
  if (d.size && typeof d.size.w === "number" && typeof d.size.h === "number") {
    out.size = { w: d.size.w, h: d.size.h };
  }
  return Object.keys(out).length ? out : undefined;
}

// Build the round-trippable JSON model of the source's notes + anchors + positions.
// `anchors`/`notes` are the source's records (the caller filters to the active
// source); bookmark-only anchors can be passed through — the caller decides.
export function buildNotesExport(
  source: Pick<SourceRecord, "id" | "title" | "sourceType">,
  anchors: readonly AnyAnchor[],
  notes: readonly NoteRecord[],
  now: () => Date = () => new Date()
): NotesExport {
  return {
    app: "ai-study-vault",
    kind: "source-notes-export",
    exportedAt: now().toISOString(),
    source: { id: source.id, title: source.title, sourceType: source.sourceType },
    anchors: anchors.map((anchor) => ({
      id: anchor.id,
      anchorKind: anchor.anchorKind,
      quote: "quote" in anchor ? anchor.quote : undefined,
      page: "page" in anchor ? anchor.page : undefined,
      rect: "rect" in anchor ? anchor.rect : undefined
    })),
    notes: notes.map((note) => {
      const display = exportDisplay(note);
      return {
        id: note.id,
        contentType: note.contentType,
        anchorIds: note.anchorIds,
        content: note.content,
        text: noteReadableText(note.contentType, note.content),
        ...(display ? { display } : {})
      };
    })
  };
}

// Render the export as human-readable markdown: a section per anchor (its quote) with
// the notes hanging off it, then any unanchored notes. Pinned-open notes are flagged
// (📌) so the author's remembered layout is visible in the text form too.
export function notesExportToMarkdown(model: NotesExport): string {
  const notesByAnchor = new Map<string, ExportedNote[]>();
  const unanchored: ExportedNote[] = [];
  for (const note of model.notes) {
    if (note.anchorIds.length === 0) unanchored.push(note);
    for (const anchorId of note.anchorIds) {
      const list = notesByAnchor.get(anchorId) ?? [];
      list.push(note);
      notesByAnchor.set(anchorId, list);
    }
  }

  const lines: string[] = [`# ${model.source.title || "Notes"}`, ""];
  const noteBlock = (note: ExportedNote): string[] => {
    const pin = note.display?.open ? " 📌" : "";
    const head = `- **${note.contentType}**${pin}`;
    const body = note.text ? note.text.split("\n").map((line) => `  ${line}`) : [];
    return [head, ...body];
  };

  for (const anchor of model.anchors) {
    const anchorNotes = notesByAnchor.get(anchor.id) ?? [];
    if (!anchorNotes.length) continue;
    const heading = anchor.quote ? anchor.quote.replace(/\s+/g, " ").trim() : anchor.id;
    lines.push(`## ${heading}`);
    if (anchor.page != null) lines.push(`*Page ${anchor.page}*`, "");
    for (const note of anchorNotes) lines.push(...noteBlock(note));
    lines.push("");
  }

  if (unanchored.length) {
    lines.push("## Unanchored notes");
    for (const note of unanchored) lines.push(...noteBlock(note));
    lines.push("");
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

// Trigger a browser/Electron-renderer download of a text blob — the same idiom as
// svpackViews.downloadSvpackFile, kept local so this file stays dependency-light.
export function downloadTextFile(text: string, fileName: string, mime = "text/plain"): void {
  if (typeof document === "undefined" || typeof URL?.createObjectURL !== "function") return;
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// A file-system-safe name from the source title (mirrors svpack.safeFileName).
export function safeExportFileName(title: string): string {
  const cleaned = (title || "").replace(/[\\/:*?"<>|]/g, "_").trim();
  return cleaned.length > 0 ? cleaned : "notes";
}
