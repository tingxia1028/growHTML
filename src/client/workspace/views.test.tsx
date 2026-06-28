// Unit coverage for the StudyView note-list exclusion (Bookmark V1). The core
// requirement is that bookmarks are FILTERED OUT of the main note-card list so they
// read as markers, not content cards — they surface only in the Bookmarks pane. The
// filter is the pure `noteCardsFrom` helper StudyView applies, asserted here in isolation.
import { describe, expect, it } from "vitest";
import type { NoteRecord } from "../data/entityClient";
import { BOOKMARK_CONTENT_TYPE } from "../../core/notes/contentTypes";
import { noteCardsFrom } from "./noteCards";

function note(id: string, contentType: string): NoteRecord {
  return { id, anchorIds: ["anchor_1"], contentType, content: "x", layerIds: [] } as unknown as NoteRecord;
}

describe("noteCardsFrom (StudyView note-list exclusion)", () => {
  it("keeps non-bookmark notes in the card list", () => {
    const cards = noteCardsFrom([note("n1", "markdown"), note("n2", "flashcard")]);
    expect(cards.map((c) => c.id)).toEqual(["n1", "n2"]);
  });

  it("filters bookmark notes out of the card list", () => {
    const cards = noteCardsFrom([note("b1", BOOKMARK_CONTENT_TYPE)]);
    expect(cards).toHaveLength(0);
  });

  it("excludes only bookmarks while keeping every other type", () => {
    const cards = noteCardsFrom([
      note("n1", "markdown"),
      note("b1", BOOKMARK_CONTENT_TYPE),
      note("n2", "quiz"),
      note("b2", BOOKMARK_CONTENT_TYPE),
      note("n3", "code-snippet")
    ]);
    expect(cards.map((c) => c.id)).toEqual(["n1", "n2", "n3"]);
  });

  it("treats a missing contentType as markdown (kept as a card)", () => {
    const legacy = { id: "n0", anchorIds: [], content: "x", layerIds: [] } as unknown as NoteRecord;
    expect(noteCardsFrom([legacy]).map((c) => c.id)).toEqual(["n0"]);
  });
});
