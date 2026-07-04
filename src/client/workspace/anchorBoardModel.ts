// Anchor Focus board — PURE model (D12, note-presentation-unified.md §10). Kept in its
// own React-free module so the two layouts + the filters are unit-testable WITHOUT the
// heavy view chain (readerForSource → PdfReader → pdfjs). The board is a read-only
// CONSUMER of the shipped data: anchors (document order), notes (with layerIds), and the
// source's stage layers (F7a stagePresetForKits seed + user-editable ones). It invents
// no card renderer — the view maps each note to a §10 PreviewCard block.
//
// Two layouts (§D12):
//   A — by document order: rows = anchors in reading order; each row carries the anchor's
//       passage/quote + the PreviewCards of that anchor's notes.
//   B — by stage layer: columns = the source's ENABLED stage layers; notes bucketed by
//       layerId (a note with no layer, or in no enabled column, falls to the "未分层"
//       bucket so it is never lost). Columns are DATA-DRIVEN — never a hardcoded taxonomy.

import type { AnyAnchor, NoteRecord, StudyLayerRecord } from "../data/entityClient";
import { BOOKMARK_CONTENT_TYPE } from "../../core/notes/contentTypes";

// A note as it appears on the board — the whole record plus a plain-text search haystack
// so the filter never re-derives it per keystroke.
export type BoardNote = {
  note: NoteRecord;
  /** Lowercased searchable text: the note's content (+ its anchor's quote, added by the row). */
  haystack: string;
};

// Layout A: one row per anchor in document order, carrying its quote + its notes.
export type AnchorRow = {
  anchor: AnyAnchor;
  /** The anchored passage/quote (region anchors have none → empty string). */
  quote: string;
  notes: BoardNote[];
};

// Layout B: one column per enabled stage layer (+ the trailing "未分层" bucket).
export type LayerColumn = {
  /** The layer id, or the sentinel UNLAYERED_COLUMN_ID for the catch-all bucket. */
  id: string;
  title: string;
  /** The layer's chip color (undefined for the catch-all). */
  color?: string;
  notes: BoardNote[];
};

export const UNLAYERED_COLUMN_ID = "__unlayered__";

function quoteOf(anchor: AnyAnchor): string {
  return "quote" in anchor && typeof anchor.quote === "string" ? anchor.quote : "";
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  try {
    return JSON.stringify(content ?? {});
  } catch {
    return "";
  }
}

// Bookmarks are markers, not content cards (mirrors noteCardsFrom / the reader's paint
// exclusion) — the board never shows them as PreviewCards.
export function boardNotesFrom(notes: NoteRecord[]): NoteRecord[] {
  return notes.filter((note) => (note.contentType ?? "markdown") !== BOOKMARK_CONTENT_TYPE);
}

// The stage layers a source's board shows as Layout-B columns: the ENABLED subset of the
// source's layers, in `order` (the F7a axis order), then by title. When an enabledIds set
// is passed we honor the 只看当前Layer / Lens filter; without it every layer shows. Preset
// (kit-seeded) + custom + owned + imported layers all qualify — the board reflects the
// LIVE axis, never a hardcoded 预习/学习/练习/错题/复习.
export function boardStageColumns(
  layers: StudyLayerRecord[],
  enabledIds?: ReadonlySet<string>
): StudyLayerRecord[] {
  return layers
    .filter((layer) => (enabledIds ? enabledIds.has(layer.id) : layer.enabled))
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title));
}

// Does a board note match the search query? (empty query matches everything.)
export function noteMatchesQuery(entry: BoardNote, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q === "" || entry.haystack.includes(q);
}

// Layout A — anchors in document order, each with its (bookmark-free, search-filtered)
// notes. `notesByAnchorId` maps an anchor id → its notes (already layer-filtered by the
// caller when 只看当前Layer is on). Rows with no surviving notes are KEPT (the passage is
// still useful for 顺着读/整理补充) unless `hideEmpty` is set. Anchors arrive in the order
// the server returns them, which IS reading order (projection order) for the surface.
export function buildAnchorRows(
  anchors: AnyAnchor[],
  notesByAnchorId: ReadonlyMap<string, NoteRecord[]>,
  options: { query?: string; hideEmpty?: boolean } = {}
): AnchorRow[] {
  const query = options.query ?? "";
  const rows: AnchorRow[] = [];
  for (const anchor of anchors) {
    const quote = quoteOf(anchor);
    const quoteHay = quote.toLowerCase();
    const entries: BoardNote[] = (notesByAnchorId.get(anchor.id) ?? [])
      .map((note) => ({ note, haystack: `${contentText(note.content).toLowerCase()}\n${quoteHay}` }))
      .filter((entry) => noteMatchesQuery(entry, query));
    if (options.hideEmpty && entries.length === 0) continue;
    rows.push({ anchor, quote, notes: entries });
  }
  return rows;
}

// Layout B — bucket notes into the stage-layer columns by layerId. A note lands in EVERY
// enabled column it belongs to (layerIds is multi); a note in no enabled column (or with
// no layers at all) falls into the trailing "未分层" bucket so it is never lost. The search
// query narrows the notes inside every column. `unlayeredTitle` is passed in (bilingual).
export function buildLayerColumns(
  notes: NoteRecord[],
  columns: StudyLayerRecord[],
  options: { query?: string; unlayeredTitle: string; anchorQuoteById?: ReadonlyMap<string, string> } = {
    unlayeredTitle: "未分层"
  }
): LayerColumn[] {
  const query = options.query ?? "";
  const columnIds = new Set(columns.map((column) => column.id));
  const quoteById = options.anchorQuoteById;

  const toEntry = (note: NoteRecord): BoardNote => {
    const anchorQuote = quoteById
      ? note.anchorIds.map((id) => quoteById.get(id) ?? "").join(" ")
      : "";
    return { note, haystack: `${contentText(note.content).toLowerCase()}\n${anchorQuote.toLowerCase()}` };
  };

  const buckets = new Map<string, BoardNote[]>();
  for (const column of columns) buckets.set(column.id, []);
  const unlayered: BoardNote[] = [];

  for (const note of notes) {
    const entry = toEntry(note);
    if (!noteMatchesQuery(entry, query)) continue;
    const targets = note.layerIds.filter((id) => columnIds.has(id));
    if (targets.length === 0) {
      unlayered.push(entry);
      continue;
    }
    for (const id of targets) buckets.get(id)!.push(entry);
  }

  const out: LayerColumn[] = columns.map((column) => ({
    id: column.id,
    title: column.title,
    color: column.color,
    notes: buckets.get(column.id) ?? []
  }));
  // The catch-all trails only when it actually holds notes (an empty board still shows
  // its real stage columns).
  if (unlayered.length > 0) {
    out.push({ id: UNLAYERED_COLUMN_ID, title: options.unlayeredTitle, notes: unlayered });
  }
  return out;
}

// A note → the §10 PreviewCard footer "extra"/page/layer are host-threaded elsewhere; the
// board only needs the content + contentType + the whole note (the card resolves its own
// title/body through getNoteType().render). This tiny mapper keeps the view declarative.
export function noteToCardBlock(note: NoteRecord): {
  contentType: string;
  content: unknown;
  note: NoteRecord;
} {
  return { contentType: note.contentType ?? "markdown", content: note.content, note };
}
