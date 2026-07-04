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
import { matchPinyin } from "../../core/search/pinyin";
import { matchFields, matchText, rankMatches, snippetAround, type TextMatch } from "../../core/search/rank";
import { listSources } from "../../core/store/sources";
import type { StudyVault } from "../../core/vault";
import type { SealedRuntime } from "../svpack";
import { listNotes } from "./notes";

export type SearchDeps = { vault: StudyVault; sealed: SealedRuntime };

/** Per-family result cap (V1 — no paging; the palette shows fewer still). */
export const MAX_HITS_PER_FAMILY = 20;

/** How many chars of a note's search text become its display title. */
const TITLE_MAX = 80;

/**
 * SEARCH-2 filters (docs/design/global-search.md §3 — "per-type filters"). ALL fields
 * optional; an all-absent filter is the SEARCH-1 path byte-for-byte (empty-filter
 * parity). Additive + transport-parity: the direct transport passes the SAME shape.
 *   • families    — which result families to include (note/source). Absent ⇒ both.
 *   • contentType — note contentType allow-list (`type:错题`). Absent ⇒ all note types.
 *   • sourceType  — source sourceType allow-list. Absent ⇒ all source types.
 *   • sourceId    — restrict note hits to one source (in-document narrowing). Absent ⇒ any.
 *   • updatedAfter / updatedBefore — ISO date bounds on updatedAt (inclusive). Absent ⇒ unbounded.
 */
export type SearchFilters = {
  families?: readonly ("note" | "source")[];
  contentType?: readonly string[];
  sourceType?: readonly string[];
  sourceId?: string;
  updatedAfter?: string;
  updatedBefore?: string;
};

/** Split a repeatable/comma-joined query param into a trimmed non-empty list, or
 *  undefined when absent (so an absent param stays the SEARCH-1 "no constraint" path). */
function listParam(raw: string | string[] | null | undefined): string[] | undefined {
  if (raw == null) return undefined;
  const values = (Array.isArray(raw) ? raw : [raw])
    .flatMap((entry) => entry.split(","))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return values.length > 0 ? values : undefined;
}

function scalarParam(raw: string | string[] | null | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Parse the SEARCH-2 filter query params off ONE getter (`name → raw`), so app.ts
 * (Express `req.query[name]`) and the direct transport (URLSearchParams `getAll`) build
 * the SAME filters. Returns undefined when NO filter param is present — the empty-filter
 * byte-identical-to-SEARCH-1 path. Params:
 *   family=note&family=source · type=错题,markdown · sourceType=pdf · sourceId=… ·
 *   after=<iso> · before=<iso>
 */
export function parseSearchFilters(get: (name: string) => string | string[] | null | undefined): SearchFilters | undefined {
  const rawFamilies = listParam(get("family"));
  const families = rawFamilies?.filter((f): f is "note" | "source" => f === "note" || f === "source");
  const filters: SearchFilters = {
    families: families && families.length > 0 ? families : undefined,
    contentType: listParam(get("type")),
    sourceType: listParam(get("sourceType")),
    sourceId: scalarParam(get("sourceId")),
    updatedAfter: scalarParam(get("after")),
    updatedBefore: scalarParam(get("before"))
  };
  const any = Object.values(filters).some((value) => value !== undefined);
  return any ? filters : undefined;
}

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

export type SearchInput = { q: string; filters?: SearchFilters };

/** Family inclusion: absent/empty families ⇒ everything (the SEARCH-1 default). */
function familyIncluded(filters: SearchFilters | undefined, family: "note" | "source"): boolean {
  const families = filters?.families;
  return !families || families.length === 0 || families.includes(family);
}

/** ISO updatedAt within the optional [after, before] bounds (inclusive; string compare
 *  is correct for the vault's canonical ISO stamps). Absent bounds ⇒ always in-range. */
function withinDateRange(updatedAt: string, filters: SearchFilters | undefined): boolean {
  if (filters?.updatedAfter && updatedAt < filters.updatedAfter) return false;
  if (filters?.updatedBefore && updatedAt > filters.updatedBefore) return false;
  return true;
}

/** Allow-list membership; an absent/empty list means "no constraint". */
function inList(list: readonly string[] | undefined, value: string): boolean {
  return !list || list.length === 0 || list.includes(value);
}

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
  const filters = input.filters;

  const [sources, notes, anchors] = await Promise.all([
    listSources(vault),
    listNotes({ vault, sealed }, {}),
    vault.stores.anchors.list()
  ]);
  const sourceTitleById = new Map(sources.map((source) => [source.id, source.title]));
  const quoteByAnchorId = new Map(anchors.map((anchor) => [anchor.id, anchor.quote]));

  const hits: SearchHit[] = [];

  // —— notes ——
  if (familyIncluded(filters, "note")) {
    const noteMatches: { item: NoteSearchHit; rank: number; updatedAt: string }[] = [];
    for (const note of notes) {
      const contentType = note.contentType ?? "markdown";
      // Filter narrowing (cheap gates first — skip the toSearchText cost when excluded).
      if (!inList(filters?.contentType, contentType)) continue;
      if (filters?.sourceId && note.sourceId !== filters.sourceId) continue;
      if (!withinDateRange(note.updatedAt, filters)) continue;
      const text = noteSearchText(contentType, note.content);
      // Field 0 = the spec's search text; fields 1+ = the note's anchor quotes, so a
      // quote-only hit still surfaces (and its snippet IS the quote).
      const fields = [text, ...note.anchorIds.map((anchorId) => quoteByAnchorId.get(anchorId) ?? "")];
      // Literal + fuzzy tiers first; pinyin (roman query → CJK title) is the additive
      // last resort so a genuine text hit always outranks a romanization hit.
      const match: (TextMatch & { fieldIndex: number }) | null =
        matchFields(query, fields) ?? withPinyin(query, text);
      if (!match) continue;
      const matchedField = fields[match.fieldIndex] ?? text;
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
    hits.push(...rankMatches(noteMatches, MAX_HITS_PER_FAMILY));
  }

  // —— sources ——
  if (familyIncluded(filters, "source")) {
    const sourceMatches: { item: SourceSearchHit; rank: number; updatedAt: string }[] = [];
    for (const source of sources) {
      if (!inList(filters?.sourceType, source.sourceType)) continue;
      if (filters?.sourceId && source.id !== filters.sourceId) continue;
      if (!withinDateRange(source.updatedAt, filters)) continue;
      const titleMatch = matchText(query, source.title);
      // Literal title/type, then pinyin over the (CJK) title as the additive last resort.
      const match = titleMatch ?? matchText(query, source.sourceType) ?? matchPinyin(query, source.title);
      if (!match) continue;
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
    hits.push(...rankMatches(sourceMatches, MAX_HITS_PER_FAMILY));
  }

  return hits;
}

/** Pinyin fallback for a note, shaped as a matchFields result (fieldIndex 0 = the
 *  search text, whose first line is the title the snippet is cut from). Null unless the
 *  query is roman and the note's text romanizes to a hit. */
function withPinyin(query: string, text: string): (TextMatch & { fieldIndex: number }) | null {
  const match = matchPinyin(query, text);
  return match ? { ...match, fieldIndex: 0 } : null;
}
