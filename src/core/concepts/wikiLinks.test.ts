// CG-2 [[双链]] parser — the pure half of "writing IS linking".

import { describe, expect, it } from "vitest";
import { WIKI_LINK_MAX_PER_NOTE, extractWikiLinks } from "./wikiLinks";

describe("extractWikiLinks", () => {
  it("extracts names in first-appearance order", () => {
    expect(extractWikiLinks("浮力由 [[阿基米德原理]] 决定，与 [[密度]] 有关")).toEqual([
      "阿基米德原理",
      "密度"
    ]);
  });

  it("collapses whitespace and dedupes case/whitespace-insensitively", () => {
    expect(extractWikiLinks("[[ Render   Thread ]] meets [[render thread]] and [[RENDER THREAD]]")).toEqual([
      "Render Thread"
    ]);
  });

  it("ignores empty, nested-bracket, and multi-line candidates", () => {
    expect(extractWikiLinks("[[]] [[   ]] [[a[[b]]]] [[line\nbreak]]")).toEqual(["b"]);
    expect(extractWikiLinks("no links here")).toEqual([]);
  });

  it("caps the distinct names per note", () => {
    const text = Array.from({ length: WIKI_LINK_MAX_PER_NOTE + 5 }, (_, i) => `[[概念${i}]]`).join(" ");
    expect(extractWikiLinks(text)).toHaveLength(WIKI_LINK_MAX_PER_NOTE);
  });
});
