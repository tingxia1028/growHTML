// SEARCH-2 recent searches (docs/design/global-search.md §3 — "recent searches") —
// the pure, storage-injectable half of the palette's empty state. When the query is
// blank the palette shows what you searched last (a one-keystroke redo), the SC-0
// bare-palette idiom extended. localStorage-backed (the design's "workspace prefs,
// field-group safe" — a plain string list is trivially forward-compatible); the store
// is INJECTED so jsdom tests drive an in-memory Map and no real storage is touched.
//
// No React, no fetch: a value module the palette wires once. Kept to recent QUERIES
// (not opened items) for V1 — a query redo covers the "get me back there" need and
// sidesteps stale-id rendering (an opened note may be deleted; a query never dangles).

const STORAGE_KEY = "growte.search.recents";
/** How many recent queries we keep / surface (a short, glanceable list). */
export const RECENTS_LIMIT = 6;

/** The tiny storage surface we depend on — `window.localStorage` satisfies it, and a
 *  test Map wrapper does too. Both methods degrade silently (private mode / SSR). */
export type RecentsStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

/** Read the recent-query list newest-first. Corrupt/absent storage ⇒ []. */
export function readRecentSearches(store: RecentsStore | undefined): string[] {
  if (!store) return [];
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).slice(0, RECENTS_LIMIT);
  } catch {
    return [];
  }
}

/**
 * Record a query at the FRONT of the list (deduped case-insensitively, capped). Returns
 * the new list so a caller can update in-memory state without a re-read. Blank queries
 * are ignored (the empty palette never records itself). Never throws.
 */
export function recordRecentSearch(store: RecentsStore | undefined, query: string): string[] {
  const trimmed = query.trim();
  if (!store || !trimmed) return readRecentSearches(store);
  const existing = readRecentSearches(store);
  const deduped = existing.filter((entry) => entry.toLowerCase() !== trimmed.toLowerCase());
  const next = [trimmed, ...deduped].slice(0, RECENTS_LIMIT);
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage may be unavailable — the in-memory list is still returned.
  }
  return next;
}

/** Clear the recent-query list. Returns the empty list. Never throws. */
export function clearRecentSearches(store: RecentsStore | undefined): string[] {
  try {
    store?.setItem(STORAGE_KEY, JSON.stringify([]));
  } catch {
    // ignore
  }
  return [];
}

/** The real store, or undefined when localStorage is unreachable (SSR / hardened). */
export function defaultRecentsStore(): RecentsStore | undefined {
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    return undefined;
  }
}
