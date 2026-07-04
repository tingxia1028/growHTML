// Global-search ranking core (SEARCH-1; docs/design/global-search.md §2) — the PURE,
// dependency-free half shared by the server engine (notes/sources over toSearchText)
// and the client palette (the commands family). No index, no tokenizer: V1 is a
// case-folded linear scan where plain substring is correct-enough for CJK (design §2 —
// pinyin/fuzzy ride SEARCH-2 with SC-3's table).
//
// Match tiers, best (lowest) first — the SC-0 engine's shape, extended with the
// word-boundary tier the design's "exact > prefix > substring" ordering implies for
// multi-word Latin titles. CJK has no word boundaries, so a mid-string CJK hit lands
// in the substring tier (which is the correct V1 behavior — position is meaningless).

export const RANK_EXACT = 0;
export const RANK_PREFIX = 1;
export const RANK_WORD = 2;
export const RANK_SUBSTRING = 3;

export type TextMatch = {
  /** Match tier: RANK_EXACT | RANK_PREFIX | RANK_WORD | RANK_SUBSTRING. */
  rank: number;
  /** Index of the first occurrence in the ORIGINAL text (for snippet extraction). */
  index: number;
};

/** Case-fold for matching. toLowerCase is a no-op on CJK, so CJK stays byte-exact. */
export function foldSearchText(text: string): string {
  return text.toLowerCase();
}

// A "word start" for the boundary tier: the char before the hit is neither a letter
// nor a digit (space, punctuation, CJK punctuation…). Unicode-aware so "浮力 定律"
// still boundary-matches "定律" while "定律" inside "浮力定律" stays substring.
const WORD_CHAR = /[\p{L}\p{N}]/u;

/**
 * Match one query against one text field. Returns the best tier + first index, or
 * null when the text doesn't contain the query at all. Both sides are case-folded;
 * an empty query never matches (the caller decides what an empty palette shows).
 */
export function matchText(query: string, text: string): TextMatch | null {
  const q = foldSearchText(query.trim());
  if (!q) return null;
  const folded = foldSearchText(text);
  const index = folded.indexOf(q);
  if (index === -1) return null;
  if (folded === q) return { rank: RANK_EXACT, index };
  if (index === 0) return { rank: RANK_PREFIX, index };
  const before = folded[index - 1] ?? "";
  if (!WORD_CHAR.test(before)) return { rank: RANK_WORD, index };
  return { rank: RANK_SUBSTRING, index };
}

/**
 * Match a query against SEVERAL fields of one record (note text + its anchor quotes;
 * a command's title + aliases). Returns the best match and which field produced it —
 * the snippet is cut from THAT field, so a bare anchor hit "shows as its quote"
 * (design §1). Field order breaks tier ties (earlier field wins).
 */
export function matchFields(
  query: string,
  fields: readonly string[]
): (TextMatch & { fieldIndex: number }) | null {
  let best: (TextMatch & { fieldIndex: number }) | null = null;
  for (let fieldIndex = 0; fieldIndex < fields.length; fieldIndex += 1) {
    const match = matchText(query, fields[fieldIndex]);
    if (match && (!best || match.rank < best.rank)) {
      best = { ...match, fieldIndex };
      if (best.rank === RANK_EXACT) break;
    }
  }
  return best;
}

/** Snippet radius: chars kept on each side of the first match. */
export const SNIPPET_RADIUS = 40;

/**
 * A context snippet around the first match: ±SNIPPET_RADIUS chars, whitespace
 * collapsed, ellipses marking truncation. `index`/`length` address the ORIGINAL text
 * (matchText's index), so the cut lands on the real occurrence before collapsing.
 */
export function snippetAround(text: string, index: number, length: number, radius = SNIPPET_RADIUS): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + length + radius);
  const core = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${core}${end < text.length ? "…" : ""}`;
}

/**
 * Order matched records: tier ascending, then recency (updatedAt DESC — the design's
 * tiebreak) via the caller-supplied ISO stamp, then stable input order. Cap applied
 * last. Pure + generic so the server families and client commands share ONE sort.
 */
export function rankMatches<T>(
  matches: readonly { item: T; rank: number; updatedAt?: string }[],
  cap: number
): T[] {
  return matches
    .map((match, index) => ({ ...match, index }))
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") ||
        a.index - b.index
    )
    .slice(0, cap)
    .map((match) => match.item);
}
