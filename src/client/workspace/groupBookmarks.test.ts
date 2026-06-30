import { describe, expect, it } from "vitest";
import type { NoteRecord } from "../data/entityClient";
import { distinctCategories, groupBookmarksByCategory, UNGROUPED_CATEGORY } from "./groupBookmarks";

function bm(id: string, label: string, category?: string, order?: number): NoteRecord {
  return {
    id,
    anchorIds: ["a_" + id],
    contentType: "bookmark",
    content: { label, ...(category !== undefined ? { category } : {}), ...(order !== undefined ? { order } : {}) },
    layerIds: []
  } as unknown as NoteRecord;
}

describe("groupBookmarksByCategory", () => {
  it("groups by category, named alpha first, ungrouped last", () => {
    const groups = groupBookmarksByCategory([
      bm("1", "z", "Summary"),
      bm("2", "y", "Exam"),
      bm("3", "x"),
      bm("4", "w", "Exam")
    ]);
    expect(groups.map((g) => g.category)).toEqual(["Exam", "Summary", UNGROUPED_CATEGORY]);
    expect(groups[groups.length - 1].ungrouped).toBe(true);
    expect(groups[0].bookmarks.map((b) => b.id)).toEqual(["4", "2"]); // w before y
  });

  it("treats blank/whitespace category as ungrouped", () => {
    const groups = groupBookmarksByCategory([bm("1", "a", "   "), bm("2", "b", "")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].category).toBe(UNGROUPED_CATEGORY);
    expect(groups[0].bookmarks).toHaveLength(2);
  });

  it("sorts within a group by order then label", () => {
    const groups = groupBookmarksByCategory([
      bm("1", "B", "G", 2),
      bm("2", "A", "G", 2),
      bm("3", "C", "G", 1),
      bm("4", "D", "G") // no order → last
    ]);
    expect(groups[0].bookmarks.map((b) => b.id)).toEqual(["3", "2", "1", "4"]);
  });

  it("omits empty groups (only present bookmarks form groups)", () => {
    expect(groupBookmarksByCategory([])).toEqual([]);
  });

  it("distinctCategories returns sorted present categories without ungrouped", () => {
    const cats = distinctCategories([bm("1", "a", "Z"), bm("2", "b", "A"), bm("3", "c"), bm("4", "d", "A")]);
    expect(cats).toEqual(["A", "Z"]);
  });
});
