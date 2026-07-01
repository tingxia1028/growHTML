// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { paintDomAnchors, readDomSelection } from "./DomReader";
import type { PaintAnchor } from "./types";

beforeEach(() => {
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

// Put a real selection over a node's text so readDomSelection sees a non-empty
// range, mirroring what a user drag produces in the reader iframe.
function selectText(node: Node, text: string) {
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  const range = document.createRange();
  range.selectNodeContents(node);
  selection.addRange(range);
  void text;
}

describe("readDomSelection", () => {
  it("maps a selection inside a [data-study-id] element to an html quote draft", () => {
    document.body.innerHTML =
      '<article><p data-study-id="p-7">about the render loop here and more</p></article>';
    const p = document.querySelector('[data-study-id="p-7"]')!;
    selectText(p.firstChild!, "about the render loop here and more");

    const draft = readDomSelection(document, "src_1");
    expect(draft).toMatchObject({
      mode: "quote",
      sourceId: "src_1",
      kind: "html",
      studyId: "p-7",
      selector: '[data-study-id="p-7"]',
      quote: "about the render loop here and more"
    });
  });

  it("returns null when the selection is not inside any study-id element", () => {
    document.body.innerHTML = "<p>no study id here</p>";
    selectText(document.querySelector("p")!.firstChild!, "no study id here");
    expect(readDomSelection(document, "src_1")).toBeNull();
  });

  it("falls back to the element's text + a click event target when nothing is selected", () => {
    document.body.innerHTML = '<p data-study-id="p-1">clicked passage</p>';
    const p = document.querySelector('[data-study-id="p-1"]') as HTMLElement;
    document.getSelection()!.removeAllRanges();
    const event = { target: p } as unknown as Event;
    const draft = readDomSelection(document, "src_2", event);
    expect(draft).toMatchObject({ kind: "html", studyId: "p-1", quote: "clicked passage" });
  });

  it("escapes a quote in the study-id when building the selector", () => {
    document.body.innerHTML = '<p data-study-id=\'a"b\'>quoted id passage</p>';
    const p = document.querySelector("[data-study-id]")!;
    selectText(p.firstChild!, "quoted id passage");
    const draft = readDomSelection(document, "s");
    expect(draft?.mode === "quote" && draft.selector).toBe('[data-study-id="a\\"b"]');
  });
});

describe("paintDomAnchors", () => {
  const anchor = (over: Partial<PaintAnchor>): PaintAnchor => ({
    id: "a1",
    anchorKind: "html_selection",
    note: "",
    ...over
  });

  it("paints only html_selection anchors onto their study-id elements", () => {
    document.body.innerHTML = '<p data-study-id="s1">Hello world</p><p data-study-id="s2">Other</p>';
    paintDomAnchors(document, [
      anchor({ id: "a1", studyId: "s1", quote: "Hello world", note: "note A" }),
      // A web anchor must be ignored by the DOM surface.
      anchor({ id: "w1", anchorKind: "web_text_quote", quote: "Other", note: "ignored" })
    ]);
    const s1 = document.querySelector('[data-study-id="s1"]');
    const s2 = document.querySelector('[data-study-id="s2"]');
    expect(s1?.classList.contains("sv-annotated")).toBe(true);
    expect(s1?.getAttribute("data-sv-note")).toBe("note A");
    // The web_text_quote anchor was filtered out → s2 untouched.
    expect(s2?.classList.contains("sv-annotated")).toBe(false);
  });

  it("merges multiple anchors' notes onto the document (idempotent repaint)", () => {
    document.body.innerHTML = '<p data-study-id="s1">Hello world</p>';
    const anchors = [anchor({ studyId: "s1", quote: "Hello world", note: "first" })];
    paintDomAnchors(document, anchors);
    paintDomAnchors(document, anchors); // repaint must not duplicate
    expect(document.querySelectorAll(".sv-annotated").length).toBe(1);
  });

  it("paints preview-card payloads for the floating note card", () => {
    const doc = document.implementation.createHTMLDocument("dom-reader-card");
    doc.body.innerHTML = '<p data-study-id="s1">Hello world</p>';
    paintDomAnchors(doc, [
      anchor({
        id: "a-rich",
        studyId: "s1",
        quote: "Hello world",
        note: "fallback note",
        notePreviews: [
          {
            id: "n1",
            contentType: "markdown",
            text: "first note",
            html: '<div class="sv-annotation-preview"><div class="sv-artifact-card">First card</div></div>'
          },
          {
            id: "n2",
            contentType: "quiz",
            text: "second note",
            html: '<div class="sv-annotation-preview"><div class="sv-artifact-card">Second card</div></div>'
          }
        ]
      })
    ]);

    const target = doc.querySelector('[data-study-id="s1"]') as HTMLElement;
    expect(target.getAttribute("data-sv-note-count")).toBe("2");
    target.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    const card = doc.getElementById("sv-note-card")!;
    expect(card.textContent).toContain("First card");
    expect(card.textContent).toContain("Second card");
    expect(card.textContent).not.toContain("fallback note");
  });

  it("defaults to floating (no gutter); margin mode lays cards into the gutter", () => {
    document.body.innerHTML = '<p data-study-id="s1">Hello world</p>';
    const anchors = [anchor({ studyId: "s1", quote: "Hello world", note: "margin note" })];

    // Default (floating): inline highlight only, no margin layer.
    paintDomAnchors(document, anchors);
    expect(document.querySelector('[data-study-id="s1"]')?.classList.contains("sv-annotated")).toBe(true);
    expect(document.getElementById("sv-margin-layer")).toBeNull();

    // Margin: a gutter card carrying the note text appears; flipping back clears it.
    paintDomAnchors(document, anchors, "margin");
    expect(document.querySelector("#sv-margin-layer .sv-margin-note")?.textContent).toContain("margin note");
    paintDomAnchors(document, anchors, "floating");
    expect(document.getElementById("sv-margin-layer")).toBeNull();
  });
});
