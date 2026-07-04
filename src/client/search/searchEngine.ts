// Global-search client engine (SEARCH-1) — the PURE half of the palette (the SC-0
// engine idiom: no React, no registry imports; entries/hits are INJECTED). It owns:
//   • the server-hit DTO the palette consumes (mirrors services/search.ts SearchHit —
//     the client never imports server modules),
//   • ranking the COMMANDS family (same shared tiers as the server families),
//   • assembling the grouped row model (笔记 → 文档 → 命令) with display caps,
//   • the keyboard mapping (slashPaletteKeyDown's shape: arrows wrap, Enter picks;
//     Escape stays the parent's business).

import { matchFields, rankMatches } from "../../core/search/rank";
import { t } from "../i18n";
import type { SearchCommandEntry } from "./commandEntries";

// —— server hit DTO (GET /api/search) ————————————————————————————————————————
export type NoteHitDto = {
  family: "note";
  id: string;
  contentType: string;
  title: string;
  snippet: string;
  sourceId?: string;
  sourceTitle?: string;
  anchorId?: string;
  updatedAt: string;
};

export type SourceHitDto = {
  family: "source";
  id: string;
  title: string;
  sourceType: string;
  snippet: string;
  updatedAt: string;
};

export type SearchHitDto = NoteHitDto | SourceHitDto;

// —— palette rows ————————————————————————————————————————————————————————————
export type PaletteRow =
  | { family: "note"; hit: NoteHitDto }
  | { family: "source"; hit: SourceHitDto }
  | { family: "command"; command: SearchCommandEntry };

export type PaletteGroup = {
  family: PaletteRow["family"];
  /** Index of the group's first row in the FLAT row list (keyboard nav is flat). */
  startIndex: number;
  rows: PaletteRow[];
};

// Display caps — the palette stays keyboard-navigable (the server already caps at
// MAX_HITS_PER_FAMILY=20 per family; these trim further for the overlay list).
export const NOTE_DISPLAY_CAP = 8;
export const SOURCE_DISPLAY_CAP = 6;
export const COMMAND_DISPLAY_CAP = 6;

/** Debounce for the server query while typing (design §2 "debounced palette query"). */
export const SEARCH_DEBOUNCE_MS = 150;

/**
 * Rank the commands family: shared tiers over title (active locale) + aliases + id.
 * Empty query → ALL entries (the bare palette doubles as a navigation menu, the
 * SC-0 bare-"/" behavior). No recency for commands — ties keep the input order.
 */
export function rankCommandEntries(
  query: string,
  entries: readonly SearchCommandEntry[],
  cap = COMMAND_DISPLAY_CAP
): SearchCommandEntry[] {
  if (!query.trim()) return entries.slice(0, cap);
  const matches: { item: SearchCommandEntry; rank: number }[] = [];
  for (const entry of entries) {
    const match = matchFields(query, [t(entry.title), ...entry.aliases, entry.id]);
    if (match) matches.push({ item: entry, rank: match.rank });
  }
  return rankMatches(matches, cap);
}

/**
 * Assemble the grouped row model from the (already ranked) server hits + the ranked
 * commands. Group order is the design's: 笔记 → 文档 → 命令; empty groups are omitted.
 * Returns both the groups (for headers) and the flat rows (for keyboard nav).
 */
export function buildPaletteGroups(
  hits: readonly SearchHitDto[],
  commands: readonly SearchCommandEntry[]
): { groups: PaletteGroup[]; rows: PaletteRow[] } {
  const noteRows: PaletteRow[] = hits
    .filter((hit): hit is NoteHitDto => hit.family === "note")
    .slice(0, NOTE_DISPLAY_CAP)
    .map((hit) => ({ family: "note", hit }));
  const sourceRows: PaletteRow[] = hits
    .filter((hit): hit is SourceHitDto => hit.family === "source")
    .slice(0, SOURCE_DISPLAY_CAP)
    .map((hit) => ({ family: "source", hit }));
  const commandRows: PaletteRow[] = commands
    .slice(0, COMMAND_DISPLAY_CAP)
    .map((command) => ({ family: "command", command }));

  const groups: PaletteGroup[] = [];
  const rows: PaletteRow[] = [];
  for (const family of [noteRows, sourceRows, commandRows]) {
    if (family.length === 0) continue;
    groups.push({ family: family[0].family, startIndex: rows.length, rows: family });
    rows.push(...family);
  }
  return { groups, rows };
}

/**
 * Map one keydown onto palette intents (slashPaletteKeyDown's exact shape so the two
 * palettes keep ONE muscle memory): ArrowDown/ArrowUp move with wrap, Enter picks the
 * active row. Returns true when consumed (caller preventDefault()s). Escape is NOT
 * handled here — closing is the parent's state, not the list's.
 */
export function searchPaletteKeyDown(
  key: string,
  palette: {
    rows: readonly PaletteRow[];
    activeIndex: number;
    onNavigate(nextIndex: number): void;
    onPick(row: PaletteRow): void;
  }
): boolean {
  const count = palette.rows.length;
  if (count === 0) return false;
  if (key === "ArrowDown") {
    palette.onNavigate((palette.activeIndex + 1) % count);
    return true;
  }
  if (key === "ArrowUp") {
    palette.onNavigate((palette.activeIndex - 1 + count) % count);
    return true;
  }
  if (key === "Enter") {
    const active = palette.rows[palette.activeIndex];
    if (!active) return false;
    palette.onPick(active);
    return true;
  }
  return false;
}
