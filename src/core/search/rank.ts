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
// SEARCH-2: the fuzzy tier — ranks strictly BELOW substring (design §2's
// "exact > prefix > substring > fuzzy-lite"). Reached ONLY when no literal
// occurrence exists, so the four literal tiers above stay byte-stable (SEARCH-1
// tests unchanged); fuzzy is purely additive. Small + pure (subsequence gate +
// a bounded edit-distance window — see fuzzyMatch), no dependency, no index.
export const RANK_FUZZY = 4;

export type TextMatch = {
  /** Match tier: RANK_EXACT | RANK_PREFIX | RANK_WORD | RANK_SUBSTRING | RANK_FUZZY. */
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
 *
 * Order of attempts (best first): the four LITERAL tiers via indexOf (unchanged from
 * SEARCH-1 — byte-stable), then, only when there's no literal occurrence, the additive
 * fuzzy tier (typo/subsequence tolerance). A literal hit ALWAYS wins over a fuzzy one.
 */
export function matchText(query: string, text: string): TextMatch | null {
  const q = foldSearchText(query.trim());
  if (!q) return null;
  const folded = foldSearchText(text);
  const index = folded.indexOf(q);
  if (index === -1) return fuzzyMatch(q, folded);
  if (folded === q) return { rank: RANK_EXACT, index };
  if (index === 0) return { rank: RANK_PREFIX, index };
  const before = folded[index - 1] ?? "";
  if (!WORD_CHAR.test(before)) return { rank: RANK_WORD, index };
  return { rank: RANK_SUBSTRING, index };
}

// —— fuzzy tier (SEARCH-2) ——————————————————————————————————————————————————
// A small, pure typo-tolerant matcher reached ONLY when no literal substring exists.
// Two independent gates, either qualifies the text for RANK_FUZZY:
//   1. SUBSEQUENCE — the query's chars appear in order (not necessarily adjacent),
//      e.g. "byncy" ⊂ "buoyancy", "gsrch" ⊂ "global search". Cheap ordered scan.
//   2. BOUNDED EDIT DISTANCE — a window of the text within ≤ maxEdits(q) edits of the
//      query (Levenshtein cap), catching transposition/substitution typos the pure
//      subsequence gate misses, e.g. "buoancy"/"buoyanci" vs "buoyancy". Windowed so
//      a short query can still fuzzy-hit a long field.
// Design §2 keeps CJK on plain substring (position is meaningless, and a 1-char edit on
// ideographs is a DIFFERENT word) — so fuzzy is gated to queries of ≥ 3 chars that are
// wholly Latin/digit word-chars. `index` reports where the fuzzy region begins (for the
// snippet). Length caps keep this O(text) with a tiny constant — no dep, no index.

const FUZZY_MIN_QUERY = 3;
const FUZZY_MAX_TEXT_SCAN = 4000; // don't fuzz enormous fields; substring already ran

/** Edits tolerated for a query of this length: ~1 per 4 chars, capped at 2. */
function maxEdits(length: number): number {
  return length >= 8 ? 2 : 1;
}

/** True only for a wholly Latin-letter/digit query — the fuzzy tier's eligibility gate. */
function isLatinQuery(q: string): boolean {
  for (const char of q) {
    if (!WORD_CHAR.test(char)) return false;
    // Reject CJK (which WORD_CHAR's \p{L} accepts) — fuzzy is Latin-only (design §2).
    if (char.charCodeAt(0) > 0x24f) return false;
  }
  return true;
}

/** Query chars appear in `text` in order → the fuzzy subsequence gate. Returns the
 *  index of the FIRST matched char (snippet anchor), or -1. */
function subsequenceIndex(q: string, text: string): number {
  let firstIndex = -1;
  let qi = 0;
  for (let ti = 0; ti < text.length && qi < q.length; ti += 1) {
    if (text[ti] === q[qi]) {
      if (qi === 0) firstIndex = ti;
      qi += 1;
    }
  }
  return qi === q.length ? firstIndex : -1;
}

/** Levenshtein distance between a and b, short-circuiting once it exceeds `cap`
 *  (returns cap + 1). Two rolling rows — O(a·b) time, O(b) space. */
function boundedEditDistance(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > cap) return cap + 1; // whole row already over budget — bail
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/** Is any length-|q|(±cap) window of `text` within `cap` edits of `q`? Returns the
 *  window start (snippet anchor) or -1. Word-anchored: only windows that START at a
 *  word boundary are tested, which keeps this near-linear and matches how a user
 *  mis-types a word, not a mid-word fragment. */
function editWindowIndex(q: string, text: string, cap: number): number {
  const target = q.length;
  for (let start = 0; start < text.length; start += 1) {
    const before = text[start - 1] ?? "";
    if (start > 0 && WORD_CHAR.test(before)) continue; // word starts only
    // Try windows sized target-cap … target+cap (edit distance allows length drift).
    for (let len = Math.max(1, target - cap); len <= target + cap; len += 1) {
      if (start + len > text.length) break;
      if (boundedEditDistance(q, text.slice(start, start + len), cap) <= cap) return start;
    }
  }
  return -1;
}

/** The fuzzy tier: null unless a Latin query of ≥ FUZZY_MIN_QUERY chars matches
 *  `folded` by subsequence OR bounded edit distance. Always RANK_FUZZY (below every
 *  literal tier). Caller guarantees no literal occurrence exists. */
export function fuzzyMatch(foldedQuery: string, foldedText: string): TextMatch | null {
  const q = foldedQuery;
  if (q.length < FUZZY_MIN_QUERY || !isLatinQuery(q)) return null;
  if (foldedText.length > FUZZY_MAX_TEXT_SCAN) return null;
  const editIndex = editWindowIndex(q, foldedText, maxEdits(q.length));
  if (editIndex !== -1) return { rank: RANK_FUZZY, index: editIndex };
  const subIndex = subsequenceIndex(q, foldedText);
  if (subIndex !== -1) return { rank: RANK_FUZZY, index: subIndex };
  return null;
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
