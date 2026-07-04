// Global-search service (SEARCH-1; docs/design/global-search.md §2) — the X0a-idiom
// engine behind `GET /api/search?q=`: transport-agnostic (deps, input) → typed hits,
// wired identically by app.ts and the direct transport (mobile searches identically).
//
// V1 is DELIBERATELY index-free: the vault fits in memory, so this is one linear scan —
//   • notes  — via each content spec's `toSearchText` (the registry-driven idiom: a new
//     note type is searchable the moment its spec registers, zero search code) PLUS the
//     note's anchor quotes, so anchors surface through their notes (design §1 — a bare
//     anchor hit shows as its quote). Sealed/layer visibility rides listNotes (one
//     source of truth with every other note read).
//   • sources — title (+ sourceType keyword).
// Rank = the shared pure core (exact > prefix > word-boundary > substring; recency
// tiebreak); cap = MAX_HITS_PER_FAMILY per family. The services seam lets an inverted
// map slot in later without any API change (design §2's honest perf gate).

import { getNoteContentSpec } from "../../core/notes/contentTypes";
import { matchFields, matchText, rankMatches, snippetAround } from "../../core/search/rank";
import { listSources } from "../../core/store/sources";
import type { StudyVault } from "../../core/vault";
import type { SealedRuntime } from "../svpack";
import { listNotes } from "./notes";

export type SearchDeps = { vault: StudyVault; sealed: SealedRuntime };

/** Per-family result cap (V1 — no paging; the palette shows fewer still). */
export const MAX_HITS_PER_FAMILY = 20;

/** How many chars of a note's search text become its display title. */
const TITLE_MAX = 80;

export type NoteSearchHit = {
  family: "note";
  id: string;
  contentType: string;
  /** First line of the note's search text (or the matched quote when text is empty). */
  title: string;
  /** Context snippet around the first match — cut from the FIELD that matched. */
  snippet: string;
  /** The source hop: where Enter navigates (absent for standalone notes). */
  sourceId?: string;
  sourceTitle?: string;
  /** The note's first anchor — the reveal target for the focus contract. */
  anchorId?: string;
  updatedAt: string;
};

export type SourceSearchHit = {
  family: "source";
  id: string;
  title: string;
  sourceType: string;
  snippet: string;
  updatedAt: string;
};

export type SearchHit = NoteSearchHit | SourceSearchHit;

export type SearchInput = { q: string };

function firstLine(text: string): string {
  const line = text.split("\n").find((candidate) => candidate.trim().length > 0) ?? "";
  const collapsed = line.replace(/\s+/g, " ").trim();
  return collapsed.length > TITLE_MAX ? `${collapsed.slice(0, TITLE_MAX)}…` : collapsed;
}

// A note's searchable text via its registered spec. Stored content was validated at
// write time, but a spec change could still throw on old data — degrade to "" so one
// bad record never breaks the whole scan.
function noteSearchText(contentType: string, content: unknown): string {
  const spec = getNoteContentSpec(contentType);
  if (!spec) return "";
  try {
    return spec.toSearchText(content);
  } catch {
    return "";
  }
}

/**
 * The one search entry point: `q` → ranked typed hits across BOTH server families
 * (notes first, then sources; each family ranked + capped independently). An
 * empty/blank query returns [] — the palette's empty state is the client's business.
 */
export async function searchVault({ vault, sealed }: SearchDeps, input: SearchInput): Promise<SearchHit[]> {
  const query = input.q.trim();
  if (!query) return [];

  const [sources, notes, anchors] = await Promise.all([
    listSources(vault),
    listNotes({ vault, sealed }, {}),
    vault.stores.anchors.list()
  ]);
  const sourceTitleById = new Map(sources.map((source) => [source.id, source.title]));
  const quoteByAnchorId = new Map(anchors.map((anchor) => [anchor.id, anchor.quote]));

  // —— notes ——
  const noteMatches: { item: NoteSearchHit; rank: number; updatedAt: string }[] = [];
  for (const note of notes) {
    const contentType = note.contentType ?? "markdown";
    const text = noteSearchText(contentType, note.content);
    // Field 0 = the spec's search text; fields 1+ = the note's anchor quotes, so a
    // quote-only hit still surfaces (and its snippet IS the quote).
    const fields = [text, ...note.anchorIds.map((anchorId) => quoteByAnchorId.get(anchorId) ?? "")];
    const match = matchFields(query, fields);
    if (!match) continue;
    const matchedField = fields[match.fieldIndex];
    noteMatches.push({
      rank: match.rank,
      updatedAt: note.updatedAt,
      item: {
        family: "note",
        id: note.id,
        contentType,
        title: firstLine(text) || firstLine(matchedField) || contentType,
        snippet: snippetAround(matchedField, match.index, query.length),
        sourceId: note.sourceId,
        sourceTitle: note.sourceId ? sourceTitleById.get(note.sourceId) : undefined,
        anchorId: note.anchorIds[0],
        updatedAt: note.updatedAt
      }
    });
  }

  // —— sources ——
  const sourceMatches: { item: SourceSearchHit; rank: number; updatedAt: string }[] = [];
  for (const source of sources) {
    const match = matchText(query, source.title) ?? matchText(query, source.sourceType);
    if (!match) continue;
    const titleMatch = matchText(query, source.title);
    sourceMatches.push({
      rank: match.rank,
      updatedAt: source.updatedAt,
      item: {
        family: "source",
        id: source.id,
        title: source.title,
        sourceType: source.sourceType,
        snippet: titleMatch ? snippetAround(source.title, titleMatch.index, query.length) : source.sourceType,
        updatedAt: source.updatedAt
      }
    });
  }

  return [
    ...rankMatches(noteMatches, MAX_HITS_PER_FAMILY),
    ...rankMatches(sourceMatches, MAX_HITS_PER_FAMILY)
  ];
}
