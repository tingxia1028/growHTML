// SEARCH-2 pure filter model: toggles, empty detection, and the query serializer whose
// wire format the server's parseSearchFilters reads back (empty filter ⇒ SEARCH-1 URL).
import { describe, expect, it } from "vitest";
import {
  EMPTY_FILTERS,
  filterQuerySuffix,
  isEmptyFilter,
  toggleContentType,
  toggleFamily
} from "./searchFilters";

describe("searchFilters — model + serializer", () => {
  it("EMPTY_FILTERS is empty and serializes to nothing (SEARCH-1 parity)", () => {
    expect(isEmptyFilter(EMPTY_FILTERS)).toBe(true);
    expect(filterQuerySuffix(EMPTY_FILTERS)).toBe("");
  });

  it("toggleFamily adds then removes, keeping note before source", () => {
    let state = toggleFamily(EMPTY_FILTERS, "source");
    state = toggleFamily(state, "note");
    expect(state.families).toEqual(["note", "source"]);
    state = toggleFamily(state, "source");
    expect(state.families).toEqual(["note"]);
    expect(isEmptyFilter(state)).toBe(false);
  });

  it("toggleContentType adds/removes note types", () => {
    let state = toggleContentType(EMPTY_FILTERS, "quiz");
    expect(state.contentTypes).toEqual(["quiz"]);
    state = toggleContentType(state, "quiz");
    expect(state.contentTypes).toEqual([]);
  });

  it("serializes families (repeated) and types (comma-joined)", () => {
    const state = { families: ["note", "source"] as const, contentTypes: ["quiz", "markdown"] };
    const suffix = filterQuerySuffix(state);
    expect(suffix).toBe("&family=note&family=source&type=quiz%2Cmarkdown");
    // Round-trips through URLSearchParams the way the server parses it.
    const params = new URLSearchParams(suffix.slice(1));
    expect(params.getAll("family")).toEqual(["note", "source"]);
    expect(params.get("type")).toBe("quiz,markdown");
  });
});
