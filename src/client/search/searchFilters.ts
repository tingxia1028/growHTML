// SEARCH-2 palette filters (docs/design/global-search.md §3 — "per-type filters") —
// the pure filter model + the query-string serializer the client sends to GET
// /api/search. Kept React-free (the SC-0 engine idiom): the palette owns the state,
// this owns the SHAPE and the wire format (which the server's parseSearchFilters reads
// back — one param contract, tested for parity).
//
// V1 controls (what the seeded vault can meaningfully filter by, per the doc):
//   • family  — 笔记 / 文档 (note / source). The COMMANDS family is client-only, so it
//               is not a server filter; the palette hides its command group when a
//               family filter excludes it (handled in the component).
//   • type    — note contentType allow-list (the doc's `type:错题 浮力`).
// sourceType / sourceId / date bounds exist on the SERVER filter (additive, transport-
// parity) and can be surfaced later without a wire change; V1 UI ships family + type.

export type SearchFamilyFilter = "note" | "source";

export type SearchFilterState = {
  /** Included result families. Empty set ⇒ ALL (the SEARCH-1 default). */
  families: readonly SearchFamilyFilter[];
  /** Allowed note contentTypes. Empty ⇒ all note types. */
  contentTypes: readonly string[];
};

/** The empty filter — its serialization is [], so the server takes the SEARCH-1 path. */
export const EMPTY_FILTERS: SearchFilterState = { families: [], contentTypes: [] };

/** True when nothing is constrained (the palette shows a neutral filter bar). */
export function isEmptyFilter(state: SearchFilterState): boolean {
  return state.families.length === 0 && state.contentTypes.length === 0;
}

/** Toggle a family in/out of the filter (order-stable: note before source). */
export function toggleFamily(state: SearchFilterState, family: SearchFamilyFilter): SearchFilterState {
  const present = state.families.includes(family);
  const families = present
    ? state.families.filter((entry) => entry !== family)
    : ([...state.families, family] as SearchFamilyFilter[]).sort((a, b) => (a === "note" ? -1 : 1) - (b === "note" ? -1 : 1));
  return { ...state, families };
}

/** Toggle a note contentType in/out of the allow-list. */
export function toggleContentType(state: SearchFilterState, contentType: string): SearchFilterState {
  const present = state.contentTypes.includes(contentType);
  const contentTypes = present
    ? state.contentTypes.filter((entry) => entry !== contentType)
    : [...state.contentTypes, contentType];
  return { ...state, contentTypes };
}

/**
 * Serialize the filter state onto URLSearchParams the server reads back verbatim
 * (parseSearchFilters): repeated `family`, comma-joined `type`. An EMPTY filter appends
 * NOTHING, so `?q=…` stays byte-identical to SEARCH-1 (empty-filter parity). Returns the
 * "&k=v…" suffix (empty string when neutral) for appending to the query URL.
 */
export function filterQuerySuffix(state: SearchFilterState): string {
  const params = new URLSearchParams();
  for (const family of state.families) params.append("family", family);
  if (state.contentTypes.length > 0) params.set("type", state.contentTypes.join(","));
  const query = params.toString();
  return query ? `&${query}` : "";
}
