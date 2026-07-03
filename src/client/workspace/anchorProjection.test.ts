import { describe, expect, it } from "vitest";
import type { AnyAnchor } from "../data/entityClient";
import { mergeFocusedAnchor } from "./WorkspaceContext";

function anchor(id: string, sourceId = "src_1"): AnyAnchor {
  return {
    id,
    sourceId,
    anchorKind: "html_selection",
    studyId: id,
    quote: "passage",
    contextBefore: "",
    contextAfter: ""
  } as unknown as AnyAnchor;
}

describe("mergeFocusedAnchor", () => {
  it("adds the current focused anchor when the server note-backed list does not include it yet", () => {
    const existing = [anchor("anchor_old")];
    const focused = anchor("anchor_new");

    expect(mergeFocusedAnchor(existing, focused, "src_1").map((item) => item.id)).toEqual([
      "anchor_old",
      "anchor_new"
    ]);
  });

  it("does not duplicate an anchor that is already in the server list", () => {
    const existing = [anchor("anchor_1")];

    expect(mergeFocusedAnchor(existing, anchor("anchor_1"), "src_1")).toBe(existing);
  });

  it("does not leak a focused anchor from another source", () => {
    const existing = [anchor("anchor_1", "src_1")];

    expect(mergeFocusedAnchor(existing, anchor("anchor_other", "src_2"), "src_1")).toBe(existing);
  });
});
