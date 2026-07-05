// @vitest-environment jsdom
// bookmarks kit registration: importing the kit lens self-registerViews kind
// "bookmark.list" into the shared global registry (the register-only relocation gate),
// and the `bookmark` contentType stays a CORE spec (the kit owns only the browse lens,
// NOT the type). Mirrors mistake-photo/register.test.tsx after the fold.
import { describe, expect, it } from "vitest";

// The CORE note types register via this side-effect (the bookmark chip is a core built-in,
// NOT a kit plugin — the kit registers no note type of its own).
import "../../client/notes/builtinNoteTypes";
// Side effect: the bookmark.list browse lens self-registerViews (shell-imported at runtime;
// here we pin that moving the file into the kit dir changed nothing about registration).
import "./BookmarkListView";

import { getView } from "../../client/workspace/viewRegistry";
import { getNoteContentSpec, BOOKMARK_CONTENT_TYPE } from "../../core/notes/contentTypes";

describe("bookmarks kit registration", () => {
  it("the bookmark.list lens self-registers into the shared registry (kind unchanged)", () => {
    // Register-only relocation: the view moved into this kit's directory but self-registers
    // into the SAME global registry, so getView(kind) resolves.
    expect(getView("bookmark.list")).toBeTruthy();
  });

  it("the `bookmark` contentType stays a CORE spec (the kit does NOT own it)", () => {
    expect(getNoteContentSpec(BOOKMARK_CONTENT_TYPE)).toBeTruthy();
  });
});
