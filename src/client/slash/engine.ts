// Slash composer engine (SC-0; docs/design/slash-composer.md §2/§5) — the PURE
// parse/resolve/rank half of the `/类型` entry. No React, no registry imports:
// palette entries are INJECTED by the mount (SC-1 wires the live note-type /
// operation sources through adapters.ts), so the engine stays unit-testable and
// source-agnostic ("one entry enumerates every type" — the enumeration itself is
// the caller's).

/** What a palette row stands for. "operation" rows arrive with SC-3. */
export type SlashEntryKind = "noteType" | "operation";

// One palette entry, DERIVED from a registry (never hardcoded — design §2).
//   id      — the stable key the pick dispatches on (a note contentType, or an
//             operation id later).
//   title   — the natural display name (中文 for the built-ins; falls back to the
//             id upstream in the adapter when a registration carries none).
//   aliases — the extra match keys (中文 synonyms + English shorthands).
//   icon    — an optional glyph STRING (kept React-free; the palette component
//             falls back to the central noteTypeIcon map when absent).
//   kitId   — the owning kit for the row badge (absent for built-ins).
export type SlashEntry = {
  kind: SlashEntryKind;
  id: string;
  title: string;
  aliases: string[];
  icon?: string;
  kitId?: string;
};

export type SlashInput = {
  /** The type/operation being addressed — everything after "/" up to the first whitespace. */
  query: string;
  /** The remainder after the query — the AI instruction ("" = bare → manual mode). */
  instruction: string;
};

/**
 * Parse a composer draft as a slash command.
 *   "/quiz 三道压强题" → { query: "quiz", instruction: "三道压强题" }
 *   "/quiz"           → { query: "quiz", instruction: "" }        (bare → manual mode)
 *   "/"               → { query: "", instruction: "" }            (open palette, unfiltered)
 *   "quiz …"          → null                                       (not a slash input)
 * The query ends at the FIRST whitespace (any Unicode whitespace — \s, never \w, so
 * CJK queries like "/判断题" work); the instruction keeps its internal spacing but
 * drops the separator run and trailing whitespace.
 */
export function parseSlashInput(raw: string): SlashInput | null {
  if (!raw.startsWith("/")) return null;
  const rest = raw.slice(1);
  const separator = rest.match(/\s/);
  if (!separator || separator.index === undefined) {
    return { query: rest, instruction: "" };
  }
  return {
    query: rest.slice(0, separator.index),
    instruction: rest.slice(separator.index).trim()
  };
}

// Match tiers, best (lowest) first. Secondary order is the caller's input order,
// so the injected list's own ranking (active kit first, memory recency later —
// design §2) survives resolution untouched.
const RANK_EXACT_ID = 0;
const RANK_EXACT_ALIAS = 1;
const RANK_PREFIX = 2;
const RANK_SUBSTRING = 3;

// All matching is case-folded (English ids/aliases are case-insensitive; toLowerCase
// is a no-op on CJK). Exact-title matches are covered by the prefix tier.
function matchRank(query: string, entry: SlashEntry): number | null {
  const id = entry.id.toLowerCase();
  const title = entry.title.toLowerCase();
  const aliases = entry.aliases.map((alias) => alias.toLowerCase());
  if (id === query) return RANK_EXACT_ID;
  if (aliases.includes(query)) return RANK_EXACT_ALIAS;
  if (id.startsWith(query) || title.startsWith(query) || aliases.some((a) => a.startsWith(query))) {
    return RANK_PREFIX;
  }
  if (id.includes(query) || title.includes(query) || aliases.some((a) => a.includes(query))) {
    return RANK_SUBSTRING;
  }
  return null;
}

/**
 * Rank the injected entries against a parsed query:
 *   (1) exact id → (2) exact alias → (3) id/title/alias PREFIX → (4) substring.
 * Ties keep the input order (stable). Empty query → ALL entries (the bare-"/"
 * palette). No match → [].
 */
export function resolveSlashEntries(
  query: string,
  entries: readonly SlashEntry[]
): SlashEntry[] {
  const folded = query.trim().toLowerCase();
  if (!folded) return [...entries];
  const matched: { entry: SlashEntry; rank: number; index: number }[] = [];
  entries.forEach((entry, index) => {
    const rank = matchRank(folded, entry);
    if (rank !== null) matched.push({ entry, rank, index });
  });
  matched.sort((a, b) => a.rank - b.rank || a.index - b.index);
  return matched.map((m) => m.entry);
}
