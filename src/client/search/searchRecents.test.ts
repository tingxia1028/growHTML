// SEARCH-2 recent searches: the localStorage round-trip (injected in-memory store),
// front-insert dedupe, the cap, blank-query no-op, corrupt-storage resilience, clear.
import { describe, expect, it } from "vitest";
import {
  clearRecentSearches,
  readRecentSearches,
  recordRecentSearch,
  RECENTS_LIMIT,
  type RecentsStore
} from "./searchRecents";

function memoryStore(seed?: string): RecentsStore {
  const map = new Map<string, string>();
  if (seed !== undefined) map.set("growte.search.recents", seed);
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value)
  };
}

describe("searchRecents — round-trip + dedupe + cap", () => {
  it("records newest-first and reads it back", () => {
    const store = memoryStore();
    recordRecentSearch(store, "浮力");
    recordRecentSearch(store, "压强");
    expect(readRecentSearches(store)).toEqual(["压强", "浮力"]);
  });

  it("dedupes case-insensitively, moving the repeat to the front", () => {
    const store = memoryStore();
    recordRecentSearch(store, "buoyancy");
    recordRecentSearch(store, "pressure");
    const next = recordRecentSearch(store, "BUOYANCY");
    expect(next).toEqual(["BUOYANCY", "pressure"]);
  });

  it("ignores blank queries and caps the list", () => {
    const store = memoryStore();
    expect(recordRecentSearch(store, "   ")).toEqual([]);
    for (let i = 0; i < RECENTS_LIMIT + 3; i += 1) recordRecentSearch(store, `q${i}`);
    expect(readRecentSearches(store).length).toBe(RECENTS_LIMIT);
  });

  it("degrades to [] on missing/corrupt storage; clear empties it", () => {
    expect(readRecentSearches(undefined)).toEqual([]);
    expect(readRecentSearches(memoryStore("not json"))).toEqual([]);
    const store = memoryStore();
    recordRecentSearch(store, "浮力");
    expect(clearRecentSearches(store)).toEqual([]);
    expect(readRecentSearches(store)).toEqual([]);
  });
});
