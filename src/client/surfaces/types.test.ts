import { describe, expect, it } from "vitest";
import { anchorsOfKind, type PaintAnchor } from "./types";

const pa = (id: string, anchorKind: PaintAnchor["anchorKind"]): PaintAnchor => ({ id, anchorKind, note: "" });

describe("anchorsOfKind", () => {
  const anchors: PaintAnchor[] = [
    pa("h1", "html_selection"),
    pa("w1", "web_text_quote"),
    pa("p1", "pdf_selection"),
    pa("i1", "image_region"),
    pa("w2", "web_text_quote")
  ];

  it("filters to a single kind", () => {
    expect(anchorsOfKind(anchors, "html_selection").map((a) => a.id)).toEqual(["h1"]);
    expect(anchorsOfKind(anchors, "image_region").map((a) => a.id)).toEqual(["i1"]);
  });

  it("filters to several kinds, preserving order", () => {
    expect(anchorsOfKind(anchors, "web_text_quote", "pdf_selection").map((a) => a.id)).toEqual(["w1", "p1", "w2"]);
  });

  it("returns an empty list when nothing matches", () => {
    expect(anchorsOfKind([pa("h1", "html_selection")], "image_region")).toEqual([]);
  });
});
