// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  applyHighlight,
  applyPaintStyle,
  clampGeom,
  clearAnnotations,
  clearMarginNotes,
  ensureAnnotationLayer,
  highlightQuote,
  isAllNotesHidden,
  isAnchorNotesHidden,
  packColumn,
  paintMarginNotes,
  readCardGeom,
  restorePinnedNoteCards,
  revealAnchorInDoc,
  setAllNotesHidden,
  setAnchorNotesHidden,
  setCardOpenState,
  setSelectedAnchorInDoc,
  writeCardGeom
} from "./annotationLayer";
import { decorateAnnotations } from "./annotations";
import { resolveAnchorPaintStyle } from "./workspace/paneSelectors";
import type { NoteRecord, StudyLayerRecord } from "./data/entityClient";

beforeEach(() => {
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  window.localStorage.clear();
  // D11 store is now PER-REALM (F-1 follow-up) — reset the main document's flag so one
  // test never leaks into the next. Per-iframe realms are fresh each test (new iframe).
  setAllNotesHidden(document, false);
});

function freshReaderDocument(): Document {
  const frame = document.createElement("iframe");
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc) throw new Error("Expected iframe contentDocument");
  doc.body.innerHTML = "";
  doc.defaultView?.localStorage.clear();
  return doc;
}

describe("highlightQuote", () => {
  it("wraps the matched passage in a <mark> carrying the note text", () => {
    document.body.innerHTML = "<p>Alpha beta gamma delta.</p>";
    const ok = highlightQuote(document, { exact: "beta gamma", prefix: "Alpha ", suffix: " delta" }, "my note");
    expect(ok).toBe(true);
    const mark = document.querySelector('mark[data-sv="1"]');
    expect(mark?.textContent).toBe("beta gamma");
    expect(mark?.classList.contains("sv-annotated")).toBe(true);
    expect(mark?.getAttribute("data-sv-note")).toBe("my note");
  });

  it("returns false when the text is no longer present", () => {
    document.body.innerHTML = "<p>Nothing to see.</p>";
    expect(highlightQuote(document, { exact: "absent quote", prefix: "", suffix: "" }, "n")).toBe(false);
    expect(document.querySelector('mark[data-sv="1"]')).toBeNull();
  });

  it("disambiguates repeated text by surrounding context", () => {
    document.body.innerHTML = "<p>set the value. later set the value again.</p>";
    highlightQuote(document, { exact: "set the value", prefix: "later ", suffix: " again" }, "second one");
    const mark = document.querySelector('mark[data-sv="1"]');
    // The second occurrence (preceded by "later ") is the better match.
    expect(mark?.previousSibling?.textContent?.endsWith("later ")).toBe(true);
  });

  it("stamps the anchor id as data-sv-key so the hover card persists per anchor", () => {
    // The webview guest paints stored anchors via highlightQuote(doc, sel, note, anchor.id).
    // The id must reach the <mark> as data-sv-key, which keys card geometry persistence.
    document.body.innerHTML = "<p>Alpha beta gamma delta.</p>";
    highlightQuote(document, { exact: "beta gamma", prefix: "Alpha ", suffix: " delta" }, "note", "anchor-7");
    const mark = document.querySelector('mark[data-sv="1"]');
    expect(mark?.getAttribute("data-sv-key")).toBe("anchor-7");
    expect(mark?.getAttribute("data-sv-note")).toBe("note");
  });
});

describe("clearAnnotations", () => {
  it("unwraps marks (restoring the text) and clears element highlights", () => {
    document.body.innerHTML =
      '<p data-study-id="s1" class="sv-annotated" data-sv-note="n" data-sv-note-count="1">x <mark data-sv="1" class="sv-annotated" data-sv-note="m" data-sv-note-count="1">y</mark> z</p>';
    clearAnnotations(document.body);
    expect(document.querySelector('mark[data-sv="1"]')).toBeNull();
    expect(document.body.textContent).toBe("x y z");
    const el = document.querySelector('[data-study-id="s1"]');
    expect(el?.classList.contains("sv-annotated")).toBe(false);
    expect(el?.hasAttribute("data-sv-note")).toBe(false);
    expect(el?.hasAttribute("data-sv-note-count")).toBe(false);
  });
});

describe("applyPaintStyle (D3a per-layer paint)", () => {
  it("sets --sv-anchor-color + the sv-deco-* class on the painted element", () => {
    document.body.innerHTML = '<p id="t">x</p>';
    const el = document.getElementById("t") as HTMLElement;
    applyHighlight(el, "note", "a1");
    applyPaintStyle(el, { color: "#ff0000", decoration: "underline" });
    expect(el.style.getPropertyValue("--sv-anchor-color")).toBe("#ff0000");
    expect(el.classList.contains("sv-deco-underline")).toBe(true);
  });

  it("clears the previous decoration class when the shape changes (no stacking)", () => {
    document.body.innerHTML = '<p id="t">x</p>';
    const el = document.getElementById("t") as HTMLElement;
    applyPaintStyle(el, { color: "#00ff00", decoration: "highlight" });
    applyPaintStyle(el, { color: "#0000ff", decoration: "both" });
    expect(el.classList.contains("sv-deco-highlight")).toBe(false);
    expect(el.classList.contains("sv-deco-both")).toBe(true);
    expect(el.style.getPropertyValue("--sv-anchor-color")).toBe("#0000ff");
  });

  it("a null/empty style clears the var + class (revert to the default blue)", () => {
    document.body.innerHTML = '<p id="t">x</p>';
    const el = document.getElementById("t") as HTMLElement;
    applyPaintStyle(el, { color: "#123456", decoration: "both" });
    applyPaintStyle(el, null);
    expect(el.style.getPropertyValue("--sv-anchor-color")).toBe("");
    expect(el.className).not.toContain("sv-deco-");
  });

  it("clearAnnotations strips the paint var + deco class along with the highlight", () => {
    document.body.innerHTML = '<p id="t">x</p>';
    const el = document.getElementById("t") as HTMLElement;
    applyHighlight(el, "note", "a1");
    applyPaintStyle(el, { color: "#abcabc", decoration: "highlight" });
    clearAnnotations(document.body);
    expect(el.style.getPropertyValue("--sv-anchor-color")).toBe("");
    expect(el.className).not.toContain("sv-deco-");
  });

  // R7min (N2 D3a made reachable) — the END-TO-END data path the now-reachable
  // LayerSwitcherView paint control writes into: a layer whose `style` was set (what the
  // control persists) resolves through resolveAnchorPaintStyle for the anchor, then
  // applyPaintStyle paints that resolved style onto the element. This closes the loop
  // "reachable UI writes style -> paint" without a source change.
  it("a layer's persisted style.{color,decoration} resolves + paints onto the anchor element", () => {
    const notes = [
      { id: "n1", sourceId: "s1", anchorIds: ["a1"], conceptIds: [], layerIds: ["L1"], contentType: "markdown", content: "b", visibility: "private" } as NoteRecord
    ];
    // What the LayerSwitcherView paint control persists via patchLayer(id, { style }).
    const layers = [
      { id: "L1", enabled: true, style: { color: "#ff0000", decoration: "underline" } } as StudyLayerRecord
    ];
    const resolved = resolveAnchorPaintStyle(notes, layers, new Set(["L1"]));
    expect(resolved).toEqual({ color: "#ff0000", decoration: "underline" });

    document.body.innerHTML = '<p id="t">x</p>';
    const el = document.getElementById("t") as HTMLElement;
    applyHighlight(el, "note", "a1");
    applyPaintStyle(el, resolved);
    expect(el.style.getPropertyValue("--sv-anchor-color")).toBe("#ff0000");
    expect(el.classList.contains("sv-deco-underline")).toBe(true);
  });
});

describe("revealAnchorInDoc", () => {
  it("scrolls the data-sv-key element into view and adds a transient sv-active flash", () => {
    document.body.innerHTML = '<p data-study-id="s1">Hello world</p>';
    const el = document.querySelector('[data-study-id="s1"]') as HTMLElement;
    applyHighlight(el, "", "a1"); // stamps data-sv-key="a1"
    // jsdom has no scrollIntoView; stub it to assert it's called exactly once.
    let calls = 0;
    el.scrollIntoView = () => {
      calls += 1;
    };
    expect(revealAnchorInDoc(document, "a1")).toBe(true);
    expect(calls).toBe(1);
    expect(el.classList.contains("sv-active")).toBe(true);
  });

  it("is a safe no-op for an unknown id, a missing root, or an empty id", () => {
    document.body.innerHTML = '<p data-study-id="s1">Hello</p>';
    applyHighlight(document.querySelector('[data-study-id="s1"]')!, "", "a1");
    expect(revealAnchorInDoc(document, "nope")).toBe(false);
    expect(revealAnchorInDoc(null, "a1")).toBe(false);
    expect(revealAnchorInDoc(document, undefined)).toBe(false);
  });

  it("escapes a quote in the id (no throw, no selector injection)", () => {
    document.body.innerHTML = "<p>quoted</p>";
    const el = document.querySelector("p") as HTMLElement;
    applyHighlight(el, "", 'a"b');
    el.scrollIntoView = () => {};
    expect(revealAnchorInDoc(document, 'a"b')).toBe(true);
    expect(el.classList.contains("sv-active")).toBe(true);
  });

  it("swallows a missing scrollIntoView (jsdom) and still flashes", () => {
    document.body.innerHTML = "<p>x</p>";
    const el = document.querySelector("p") as HTMLElement & { scrollIntoView?: unknown };
    applyHighlight(el, "", "a1");
    // Ensure scrollIntoView is absent → the try/catch must not throw. Cast through a
    // partial record so `delete` is legal on the (otherwise non-optional) DOM member.
    delete (el as { scrollIntoView?: unknown }).scrollIntoView;
    expect(() => revealAnchorInDoc(document, "a1")).not.toThrow();
    expect(el.classList.contains("sv-active")).toBe(true);
  });
});

describe("setSelectedAnchorInDoc", () => {
  it("paints the blue sv-selected class on the matching anchor element", () => {
    document.body.innerHTML = '<p data-study-id="s1">a</p><p data-study-id="s2">b</p>';
    const a = document.querySelector('[data-study-id="s1"]') as HTMLElement;
    const b = document.querySelector('[data-study-id="s2"]') as HTMLElement;
    applyHighlight(a, "", "a1");
    applyHighlight(b, "", "a2");
    setSelectedAnchorInDoc(document, "a1");
    expect(a.classList.contains("sv-selected")).toBe(true);
    expect(b.classList.contains("sv-selected")).toBe(false);
  });

  it("moves the selection to exactly one anchor (clears the previous one)", () => {
    document.body.innerHTML = '<p data-study-id="s1">a</p><p data-study-id="s2">b</p>';
    const a = document.querySelector('[data-study-id="s1"]') as HTMLElement;
    const b = document.querySelector('[data-study-id="s2"]') as HTMLElement;
    applyHighlight(a, "", "a1");
    applyHighlight(b, "", "a2");
    setSelectedAnchorInDoc(document, "a1");
    setSelectedAnchorInDoc(document, "a2");
    expect(a.classList.contains("sv-selected")).toBe(false);
    expect(b.classList.contains("sv-selected")).toBe(true);
    expect(document.querySelectorAll(".sv-selected")).toHaveLength(1);
  });

  it("clears the selection for an empty/undefined id and is a safe no-op on a null root", () => {
    document.body.innerHTML = '<p data-study-id="s1">a</p>';
    const a = document.querySelector('[data-study-id="s1"]') as HTMLElement;
    applyHighlight(a, "", "a1");
    setSelectedAnchorInDoc(document, "a1");
    setSelectedAnchorInDoc(document, undefined);
    expect(a.classList.contains("sv-selected")).toBe(false);
    expect(() => setSelectedAnchorInDoc(null, "a1")).not.toThrow();
  });

  it("escapes a quote in the id (no throw, no selector injection)", () => {
    document.body.innerHTML = "<p>x</p>";
    const el = document.querySelector("p") as HTMLElement;
    applyHighlight(el, "", 'a"b');
    expect(() => setSelectedAnchorInDoc(document, 'a"b')).not.toThrow();
    expect(el.classList.contains("sv-selected")).toBe(true);
  });
});

describe("card geometry persistence", () => {
  it("round-trips placement + size through storage, keyed by anchor", () => {
    expect(readCardGeom(document, "a1")).toBeNull();
    writeCardGeom(document, "a1", { left: 120, top: 60, width: 280, height: 140 });
    expect(readCardGeom(document, "a1")).toEqual({ left: 120, top: 60, width: 280, height: 140 });
    expect(readCardGeom(document, "other")).toBeNull(); // per-key isolation
  });

  it("returns null for a corrupt entry instead of throwing", () => {
    window.localStorage.setItem("sv-card-geom:bad", "{not json");
    expect(readCardGeom(document, "bad")).toBeNull();
  });

  it("clampGeom keeps a card within a shrunken viewport", () => {
    const g = clampGeom({ left: 900, top: 700, width: 400, height: 300 }, 500, 400);
    expect(g.width).toBeLessThanOrEqual(500 - 16);
    expect(g.height).toBeLessThanOrEqual(400 - 16);
    expect(g.left + g.width).toBeLessThanOrEqual(500);
    expect(g.top + g.height).toBeLessThanOrEqual(400);
  });

  it("applyHighlight stamps the key; clearAnnotations removes it", () => {
    document.body.innerHTML = '<p id="t">hi</p>';
    const el = document.getElementById("t")!;
    applyHighlight(el, "note", "key-9");
    expect(el.getAttribute("data-sv-key")).toBe("key-9");
    clearAnnotations(document.body);
    expect(el.hasAttribute("data-sv-key")).toBe(false);
  });

  it("restores saved size without reusing stale viewport placement", () => {
    const doc = freshReaderDocument();
    doc.body.innerHTML = '<p id="t">hello</p>';
    ensureAnnotationLayer(doc);
    const el = doc.getElementById("t")!;
    Object.defineProperty(el, "getBoundingClientRect", {
      value: () => ({ left: 40, top: 80, right: 90, bottom: 104, width: 50, height: 24 })
    });
    applyHighlight(el, "note A", "k1");
    writeCardGeom(doc, "k1", { left: 300, top: 200, width: 250, height: 150 });
    el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    const card = doc.getElementById("sv-note-card")!;
    expect(card.classList.contains("sv-note-card-show")).toBe(true);
    expect(card.style.left).toBe("40px");
    expect(card.style.top).toBe("110px");
    expect(card.style.width).toBe("250px");
  });

  it("keeps a click-pinned card attached to its text when the document scrolls", () => {
    const doc = freshReaderDocument();
    doc.body.innerHTML = '<p id="t">hello</p>';
    ensureAnnotationLayer(doc);
    const el = doc.getElementById("t")!;
    let rect = { left: 80, top: 120, right: 150, bottom: 140, width: 70, height: 20 };
    Object.defineProperty(el, "getBoundingClientRect", {
      value: () => rect
    });
    applyHighlight(el, "note A", "k-scroll");

    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const card = doc.getElementById("sv-note-card")!;
    expect(card.classList.contains("sv-note-card-show")).toBe(true);
    expect(card.style.left).toBe("80px");
    expect(card.style.top).toBe("146px");

    rect = { left: 80, top: -260, right: 150, bottom: -240, width: 70, height: 20 };
    doc.dispatchEvent(new Event("scroll"));

    expect(card.style.left).toBe("80px");
    expect(card.style.top).toBe("-234px");
  });

  it("renders the content-only preview body from the highlight payload (no card chrome)", () => {
    const doc = document.implementation.createHTMLDocument("rich-card");
    doc.body.innerHTML = '<p id="t">hello</p>';
    ensureAnnotationLayer(doc);
    const el = doc.getElementById("t")!;
    applyHighlight(el, "fallback text", "k-rich", {
      noteCount: 2,
      noteHtml: '<div class="sv-annotation-preview"><div class="sv-note-content">Preview card</div></div>'
    });

    expect(el.getAttribute("data-sv-note-count")).toBe("2");
    el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));

    const card = doc.getElementById("sv-note-card")!;
    expect(card.classList.contains("sv-note-card-show")).toBe(true);
    // Content-only: no title bar / grip chrome, just the rendered note body.
    expect(card.querySelector(".sv-note-card-bar")).toBeNull();
    expect(card.querySelector(".sv-note-content")?.textContent).toContain("Preview card");
    expect(card.querySelector(".sv-note-card-body")?.textContent).not.toContain("fallback text");
  });
});

// D10 — a note's OPEN state persists alongside its geometry (setCardOpenState writes
// the flag into the same per-anchor CardGeom record; restorePinnedNoteCards re-pins
// on the next paint). Composes with N1a (a toggled-off anchor restores nothing) and
// D11 (hide-all restores nothing).
describe("card open-state persistence (D10)", () => {
  it("setCardOpenState round-trips the open flag on the geometry record", () => {
    writeCardGeom(document, "k1", { left: 10, top: 20, width: 100, height: 60 });
    setCardOpenState(document, "k1", true);
    expect(readCardGeom(document, "k1")?.open).toBe(true);
    // Flipping open off clears the flag but preserves the geometry.
    setCardOpenState(document, "k1", false);
    const geom = readCardGeom(document, "k1");
    expect(geom?.open).toBeUndefined();
    expect(geom).toMatchObject({ left: 10, top: 20, width: 100, height: 60 });
  });

  it("creates a minimal record when open is set before any geometry exists", () => {
    expect(readCardGeom(document, "k-new")).toBeNull();
    setCardOpenState(document, "k-new", true);
    expect(readCardGeom(document, "k-new")?.open).toBe(true);
    // Setting open:false on a non-existent record writes nothing (no phantom entry).
    setCardOpenState(document, "k-fresh", false);
    expect(readCardGeom(document, "k-fresh")).toBeNull();
  });

  it("pinning a card writes open:true; un-pinning clears it (reload round-trip)", () => {
    const doc = freshReaderDocument();
    doc.body.innerHTML = '<p id="t">hello</p>';
    ensureAnnotationLayer(doc);
    const el = doc.getElementById("t")!;
    Object.defineProperty(el, "getBoundingClientRect", {
      value: () => ({ left: 40, top: 80, right: 90, bottom: 104, width: 50, height: 24 })
    });
    applyHighlight(el, "note", "k-pin-persist", { noteHtml: "<div>Body</div>", noteCount: 1 });

    el.dispatchEvent(new MouseEvent("click", { bubbles: true })); // pin
    expect(readCardGeom(doc, "k-pin-persist")?.open).toBe(true);

    el.dispatchEvent(new MouseEvent("click", { bubbles: true })); // un-pin (click same target)
    expect(readCardGeom(doc, "k-pin-persist")?.open).toBeUndefined();
  });

  it("restorePinnedNoteCards re-pins the remembered-open card on the next paint", () => {
    const doc = freshReaderDocument();
    doc.body.innerHTML = '<p id="t">hello</p>';
    ensureAnnotationLayer(doc);
    const el = doc.getElementById("t")!;
    Object.defineProperty(el, "getBoundingClientRect", {
      value: () => ({ left: 40, top: 80, right: 90, bottom: 104, width: 50, height: 24 })
    });
    applyHighlight(el, "note", "k-restore", { noteHtml: "<div>Restored body</div>", noteCount: 1 });
    setCardOpenState(doc, "k-restore", true);

    const card = doc.getElementById("sv-note-card")!;
    expect(card.classList.contains("sv-note-card-show")).toBe(false); // not shown until restore

    restorePinnedNoteCards(doc, ["k-restore"]);
    expect(card.classList.contains("sv-note-card-show")).toBe(true);
    expect(card.querySelector(".sv-note-card-body")!.innerHTML).toContain("Restored body");
    // The card is PINNED (survives a mouse-out — proves it's not a transient hover).
    el.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    expect(card.classList.contains("sv-note-card-show")).toBe(true);
  });

  it("does NOT restore a note-hidden (N1a) anchor, and none while hide-all (D11) is on", () => {
    const doc = freshReaderDocument();
    doc.body.innerHTML = '<p id="t">hello</p>';
    ensureAnnotationLayer(doc);
    const el = doc.getElementById("t")!;
    Object.defineProperty(el, "getBoundingClientRect", {
      value: () => ({ left: 40, top: 80, right: 90, bottom: 104, width: 50, height: 24 })
    });
    applyHighlight(el, "note", "k-guard", { noteHtml: "<div>Body</div>", noteCount: 1 });
    setCardOpenState(doc, "k-guard", true);
    const card = doc.getElementById("sv-note-card")!;

    setAnchorNotesHidden(doc, "k-guard", true);
    restorePinnedNoteCards(doc, ["k-guard"]);
    expect(card.classList.contains("sv-note-card-show")).toBe(false);
    setAnchorNotesHidden(doc, "k-guard", false);

    setAllNotesHidden(doc, true);
    restorePinnedNoteCards(doc, ["k-guard"]);
    expect(card.classList.contains("sv-note-card-show")).toBe(false);
    setAllNotesHidden(doc, false);
  });
});

// D11 — the per-source "hide all notes" flag masks every card (hover/pinned/margin)
// via the shared annotationLayer store, distinct from N1a's glyph switch (which hides
// anchor GLYPHS). Composes with the N1a per-anchor toggle and N1b card-open state.
describe("setAllNotesHidden (D11 hide-all)", () => {
  it("suppresses hover + click-pin for EVERY anchor while on; restores all on off", () => {
    const doc = freshReaderDocument();
    doc.body.innerHTML = '<p id="a">one</p><p id="b">two</p>';
    ensureAnnotationLayer(doc);
    const a = doc.getElementById("a")!;
    const b = doc.getElementById("b")!;
    applyHighlight(a, "n1", "ha-a", { noteHtml: "<div>Body A</div>", noteCount: 1 });
    applyHighlight(b, "n2", "ha-b", { noteHtml: "<div>Body B</div>", noteCount: 1 });
    const card = doc.getElementById("sv-note-card")!;

    setAllNotesHidden(doc, true);
    expect(isAllNotesHidden(doc)).toBe(true);
    a.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(card.classList.contains("sv-note-card-show")).toBe(false);
    b.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(card.classList.contains("sv-note-card-show")).toBe(false);

    setAllNotesHidden(doc, false);
    a.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(card.classList.contains("sv-note-card-show")).toBe(true);
    expect(card.querySelector(".sv-note-card-body")!.innerHTML).toContain("Body A");
  });

  // F-1 follow-up: the hide-all flag is PER-REALM. Setting it on realm A must NOT hide
  // realm B's notes — the leak the F1 multi-doc split otherwise produced.
  it("is scoped PER-REALM: hide-all in docA leaves docB unhidden and still painting", () => {
    const docA = freshReaderDocument();
    const docB = freshReaderDocument();
    docA.body.innerHTML = '<p id="a">alpha</p>';
    docB.body.innerHTML = '<p id="b">beta</p>';
    ensureAnnotationLayer(docA);
    ensureAnnotationLayer(docB);
    const a = docA.getElementById("a")!;
    const b = docB.getElementById("b")!;
    applyHighlight(a, "n1", "ra-a", { noteHtml: "<div>Body A</div>", noteCount: 1 });
    applyHighlight(b, "n2", "rb-b", { noteHtml: "<div>Body B</div>", noteCount: 1 });
    const cardA = docA.getElementById("sv-note-card")!;
    const cardB = docB.getElementById("sv-note-card")!;

    // Hide-all in A only.
    setAllNotesHidden(docA, true);
    expect(isAllNotesHidden(docA)).toBe(true);
    expect(isAllNotesHidden(docB)).toBe(false); // B independent

    // A's card is suppressed; B still paints on hover.
    a.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(cardA.classList.contains("sv-note-card-show")).toBe(false);
    b.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(cardB.classList.contains("sv-note-card-show")).toBe(true);
    expect(cardB.querySelector(".sv-note-card-body")!.innerHTML).toContain("Body B");

    setAllNotesHidden(docA, false);
  });

  // Margin gutters in two realms are independent too — hide-all in A drops A's gutter
  // while B's stays.
  it("PER-REALM margin gutters: hide-all in docA drops A's gutter, docB's stays", () => {
    const docA = freshReaderDocument();
    const docB = freshReaderDocument();
    docA.body.innerHTML = '<p id="a">alpha</p>';
    docB.body.innerHTML = '<p id="b">beta</p>';
    ensureAnnotationLayer(docA);
    ensureAnnotationLayer(docB);
    paintMarginNotes(docA, [{ element: docA.getElementById("a")!, noteText: "a", noteHtml: "<p>a</p>", key: "ma" }]);
    paintMarginNotes(docB, [{ element: docB.getElementById("b")!, noteText: "b", noteHtml: "<p>b</p>", key: "mb" }]);
    expect(docA.getElementById("sv-margin-layer")).not.toBeNull();
    expect(docB.getElementById("sv-margin-layer")).not.toBeNull();

    setAllNotesHidden(docA, true);
    expect(docA.getElementById("sv-margin-layer")).toBeNull(); // A dropped
    expect(docB.getElementById("sv-margin-layer")).not.toBeNull(); // B stays
    setAllNotesHidden(docA, false);
  });

  it("dismisses an OPEN pinned card the instant hide-all turns on", () => {
    const doc = freshReaderDocument();
    doc.body.innerHTML = '<p id="t">hello</p>';
    ensureAnnotationLayer(doc);
    const el = doc.getElementById("t")!;
    applyHighlight(el, "note", "ha-pin", { noteHtml: "<div>Pinned</div>", noteCount: 1 });
    el.dispatchEvent(new MouseEvent("click", { bubbles: true })); // pin
    const card = doc.getElementById("sv-note-card")!;
    expect(card.classList.contains("sv-note-card-show")).toBe(true);

    setAllNotesHidden(doc, true);
    expect(card.classList.contains("sv-note-card-show")).toBe(false);
    setAllNotesHidden(doc, false);
  });

  it("drops the margin gutter while on and re-packs it on off (composing with N1a filtering)", () => {
    document.body.innerHTML = '<p id="a">one</p><p id="b">two</p>';
    // The margin re-pack on a hide-all flip rides the wired card's subscriber, which
    // production always establishes via ensureAnnotationLayer before a margin paint.
    ensureAnnotationLayer(document);
    paintMarginNotes(document, [
      { element: document.getElementById("a")!, noteText: "first", noteHtml: "<p>first</p>", key: "hm-a" },
      { element: document.getElementById("b")!, noteText: "second", noteHtml: "<p>second</p>", key: "hm-b" }
    ]);
    expect(document.querySelectorAll("#sv-margin-layer .sv-margin-note")).toHaveLength(2);

    setAllNotesHidden(document, true);
    expect(document.getElementById("sv-margin-layer")).toBeNull();

    // N1a toggle applied WHILE hidden: on restore, m-a stays filtered, only m-b returns.
    setAnchorNotesHidden(document, "hm-a", true);
    setAllNotesHidden(document, false);
    const cards = document.querySelectorAll("#sv-margin-layer .sv-margin-note");
    expect(cards).toHaveLength(1);
    expect(cards[0].getAttribute("data-sv-key")).toBe("hm-b");
    setAnchorNotesHidden(document, "hm-a", false);
  });
});

describe("packColumn (marginalia stacking)", () => {
  it("keeps cards at their desired tops when they don't collide", () => {
    expect(packColumn([{ top: 0, height: 20 }, { top: 100, height: 20 }], 8, 0)).toEqual([0, 100]);
  });

  it("pushes overlapping cards down by height + gap, preserving order", () => {
    expect(packColumn([{ top: 0, height: 20 }, { top: 5, height: 20 }, { top: 10, height: 20 }], 4, 0)).toEqual([
      0, 24, 48
    ]);
  });

  it("respects minTop and handles out-of-order input", () => {
    // Second item wants top 0 but the column starts at 50.
    expect(packColumn([{ top: 200, height: 20 }, { top: 0, height: 20 }], 5, 50)).toEqual([200, 50]);
  });

  it("compacts upward when the column overflows maxBottom", () => {
    const tops = packColumn([{ top: 90, height: 20 }, { top: 95, height: 20 }], 5, 0, 100);
    // Both must fit within [0,100]: bottom item ends at 100, top item above it.
    expect(tops[1] + 20).toBeLessThanOrEqual(100);
    expect(tops[0] + 20 + 5).toBeLessThanOrEqual(tops[1]);
  });
});

describe("paintMarginNotes", () => {
  it("builds a gutter with one card per item, reserves body space, draws connectors", () => {
    document.body.innerHTML = '<p id="a">one</p><p id="b">two</p>';
    paintMarginNotes(document, [
      // Content-only: the sanctioned preview HTML renders directly (no fallback
      // markdown pass over noteText).
      { element: document.getElementById("a")!, noteText: "first", noteHtml: "<strong>first</strong>", key: "k1" },
      { element: document.getElementById("b")!, noteText: "second", noteHtml: "<p>second</p>", key: "k2" }
    ]);
    expect(document.body.classList.contains("sv-annot-margin")).toBe(true);
    const cards = document.querySelectorAll("#sv-margin-layer .sv-margin-note");
    expect(cards).toHaveLength(2);
    // The preview body renders as-is: the first note's <strong> is present.
    expect(cards[0].querySelector("strong")?.textContent).toBe("first");
    expect(cards[0].getAttribute("data-sv-key")).toBe("k1");
    expect(document.querySelectorAll("#sv-margin-connectors path")).toHaveLength(2);
  });

  it("clearMarginNotes removes the gutter and the reserved padding marker", () => {
    document.body.innerHTML = '<p id="a">one</p>';
    paintMarginNotes(document, [{ element: document.getElementById("a")!, noteText: "n", key: "k" }]);
    clearMarginNotes(document);
    expect(document.getElementById("sv-margin-layer")).toBeNull();
    expect(document.getElementById("sv-margin-connectors")).toBeNull();
    expect(document.body.classList.contains("sv-annot-margin")).toBe(false);
  });

  it("decorateAnnotations in margin mode lays notes into the gutter", () => {
    // Our decorateAnnotations takes mode in the context (the React layer threads it),
    // rather than module-level state; the WorkspaceContext owns the persisted mode.
    document.body.innerHTML = '<p data-study-id="s1">Hello world</p>';
    decorateAnnotations(document, {
      anchors: [{ id: "a1", anchorKind: "html_selection", studyId: "s1", quote: "Hello world" }],
      notes: [{ anchorIds: ["a1"], content: "margin note", previewHtml: "<p>margin note</p>" }],
      mode: "margin"
    });
    expect(document.querySelector("#sv-margin-layer .sv-margin-note")?.textContent).toContain("margin note");
    // The element is still highlighted inline so the reader sees what's annotated.
    expect(document.querySelector('[data-study-id="s1"]')?.classList.contains("sv-annotated")).toBe(true);
  });

  it("repaints idempotently: re-decorating margin mode keeps a single gutter", () => {
    document.body.innerHTML = '<p data-study-id="s1">Hello world</p>';
    const ctx = {
      anchors: [{ id: "a1", anchorKind: "html_selection", studyId: "s1", quote: "Hello world" }],
      notes: [{ anchorIds: ["a1"], content: "margin note" }],
      mode: "margin" as const
    };
    decorateAnnotations(document, ctx);
    decorateAnnotations(document, ctx);
    expect(document.querySelectorAll("#sv-margin-layer").length).toBe(1);
    expect(document.querySelectorAll("#sv-margin-layer .sv-margin-note").length).toBe(1);
  });

  it("toggling margin → floating clears the gutter (default stays floating)", () => {
    document.body.innerHTML = '<p data-study-id="s1">Hello world</p>';
    const anchors = [{ id: "a1", anchorKind: "html_selection", studyId: "s1", quote: "Hello world" }];
    const notes = [{ anchorIds: ["a1"], content: "margin note" }];
    decorateAnnotations(document, { anchors, notes, mode: "margin" });
    expect(document.getElementById("sv-margin-layer")).not.toBeNull();
    // No mode → defaults to floating; the gutter must be gone, highlight remains.
    decorateAnnotations(document, { anchors, notes });
    expect(document.getElementById("sv-margin-layer")).toBeNull();
    expect(document.body.classList.contains("sv-annot-margin")).toBe(false);
    expect(document.querySelector('[data-study-id="s1"]')?.classList.contains("sv-annotated")).toBe(true);
  });
});

// D2 per-anchor toggle (user-amended 2026-07-04): clicking an anchor's left glyph
// chip hides that anchor's notes — the shared hover/pinned card AND its margin
// card — via setAnchorNotesHidden; a second toggle restores them. The store lives
// here in annotationLayer so the card + margin machinery consult the same state
// the MarkerOverlay flips.
describe("setAnchorNotesHidden (per-anchor notes toggle)", () => {
  it("suppresses the hover card and click-pin for a hidden anchor, and restores them", () => {
    const doc = freshReaderDocument();
    doc.body.innerHTML = '<p id="t">hello</p>';
    ensureAnnotationLayer(doc);
    const el = doc.getElementById("t")!;
    applyHighlight(el, "note", "k-tog", { noteHtml: "<div>Toggle body</div>", noteCount: 1 });
    const card = doc.getElementById("sv-note-card")!;

    setAnchorNotesHidden(doc, "k-tog", true);
    expect(isAnchorNotesHidden(doc, "k-tog")).toBe(true);
    el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(card.classList.contains("sv-note-card-show")).toBe(false);
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(card.classList.contains("sv-note-card-show")).toBe(false);

    setAnchorNotesHidden(doc, "k-tog", false);
    expect(isAnchorNotesHidden(doc, "k-tog")).toBe(false);
    el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(card.classList.contains("sv-note-card-show")).toBe(true);
    expect(card.querySelector(".sv-note-card-body")!.innerHTML).toContain("Toggle body");
  });

  it("dismisses an OPEN pinned card when its anchor is toggled hidden", () => {
    const doc = freshReaderDocument();
    doc.body.innerHTML = '<p id="t">hello</p>';
    ensureAnnotationLayer(doc);
    const el = doc.getElementById("t")!;
    applyHighlight(el, "note", "k-pin", { noteHtml: "<div>Pinned</div>", noteCount: 1 });
    el.dispatchEvent(new MouseEvent("click", { bubbles: true })); // pin
    const card = doc.getElementById("sv-note-card")!;
    expect(card.classList.contains("sv-note-card-show")).toBe(true);

    setAnchorNotesHidden(doc, "k-pin", true);
    expect(card.classList.contains("sv-note-card-show")).toBe(false);
  });

  it("filters a hidden anchor's margin card out (column re-packs) and restores it on toggle", () => {
    document.body.innerHTML = '<p id="a">one</p><p id="b">two</p>';
    paintMarginNotes(document, [
      { element: document.getElementById("a")!, noteText: "first", noteHtml: "<p>first</p>", key: "m1" },
      { element: document.getElementById("b")!, noteText: "second", noteHtml: "<p>second</p>", key: "m2" }
    ]);
    expect(document.querySelectorAll("#sv-margin-layer .sv-margin-note")).toHaveLength(2);

    // Toggle m1 off: the gutter re-packs from the remembered paint input.
    setAnchorNotesHidden(document, "m1", true);
    const cards = document.querySelectorAll("#sv-margin-layer .sv-margin-note");
    expect(cards).toHaveLength(1);
    expect(cards[0].getAttribute("data-sv-key")).toBe("m2");

    // Toggle back on: the card returns without any caller re-decorating.
    setAnchorNotesHidden(document, "m1", false);
    expect(document.querySelectorAll("#sv-margin-layer .sv-margin-note")).toHaveLength(2);
  });

  it("never resurrects a stale gutter after a margin → floating mode switch", () => {
    document.body.innerHTML = '<p data-study-id="s1">Hello world</p>';
    const anchors = [{ id: "st1", anchorKind: "html_selection", studyId: "s1", quote: "Hello world" }];
    const notes = [{ anchorIds: ["st1"], content: "n", previewHtml: "<p>n</p>" }];
    decorateAnnotations(document, { anchors, notes, mode: "margin" });
    expect(document.getElementById("sv-margin-layer")).not.toBeNull();

    // Floating repaint clears the gutter AND the margin memo.
    decorateAnnotations(document, { anchors, notes });
    expect(document.getElementById("sv-margin-layer")).toBeNull();

    setAnchorNotesHidden(document, "st1", true);
    setAnchorNotesHidden(document, "st1", false);
    expect(document.getElementById("sv-margin-layer")).toBeNull();
  });
});

describe("card-open suppression attribute (D2 — data-sv-card-open)", () => {
  it("stamps the shown anchor's id on the realm body (hover), and clears it on mouse-out", () => {
    const doc = freshReaderDocument();
    doc.body.innerHTML = '<p id="t">hello</p>';
    ensureAnnotationLayer(doc);
    const el = doc.getElementById("t")!;
    applyHighlight(el, "note", "k-open", { noteHtml: "<div>Body</div>", noteCount: 1 });

    expect(doc.body.getAttribute("data-sv-card-open")).toBeNull();
    el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(doc.body.getAttribute("data-sv-card-open")).toBe("k-open");
    el.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    expect(doc.body.getAttribute("data-sv-card-open")).toBeNull();
  });

  it("keeps the attribute while PINNED (mouse-out included); dismiss and unpin clear it", () => {
    const doc = freshReaderDocument();
    doc.body.innerHTML = '<p id="t">hello</p>';
    ensureAnnotationLayer(doc);
    const el = doc.getElementById("t")!;
    applyHighlight(el, "note", "k-pin2", { noteHtml: "<div>Body</div>", noteCount: 1 });

    el.dispatchEvent(new MouseEvent("click", { bubbles: true })); // pin
    expect(doc.body.getAttribute("data-sv-card-open")).toBe("k-pin2");
    el.dispatchEvent(new MouseEvent("mouseout", { bubbles: true })); // pinned survives hover-out
    expect(doc.body.getAttribute("data-sv-card-open")).toBe("k-pin2");

    doc.body.dispatchEvent(new MouseEvent("click", { bubbles: true })); // outside click dismisses
    expect(doc.body.getAttribute("data-sv-card-open")).toBeNull();

    // Pin again, then UNPIN by clicking the same target — the attribute clears too.
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(doc.body.getAttribute("data-sv-card-open")).toBe("k-pin2");
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(doc.body.getAttribute("data-sv-card-open")).toBeNull();
  });

  it("a notes-hidden anchor (N1a toggle) opens no card, so no attribute ever appears", () => {
    const doc = freshReaderDocument();
    doc.body.innerHTML = '<p id="t">hello</p>';
    ensureAnnotationLayer(doc);
    const el = doc.getElementById("t")!;
    applyHighlight(el, "note", "k-hid", { noteHtml: "<div>Body</div>", noteCount: 1 });
    setAnchorNotesHidden(doc, "k-hid", true);
    el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(doc.body.getAttribute("data-sv-card-open")).toBeNull();
    setAnchorNotesHidden(doc, "k-hid", false);
  });
});

describe("decorateAnnotations (HTML renderer)", () => {
  it("highlights the study-id element when it still exists", () => {
    document.body.innerHTML = '<p data-study-id="s1">Hello world</p>';
    decorateAnnotations(document, {
      anchors: [{ id: "a1", anchorKind: "html_selection", studyId: "s1", quote: "Hello world" }],
      notes: [{ anchorIds: ["a1"], content: "note A" }]
    });
    const el = document.querySelector('[data-study-id="s1"]');
    expect(el?.classList.contains("sv-annotated")).toBe(true);
    expect(el?.getAttribute("data-sv-note")).toBe("note A");
    expect(document.querySelector('mark[data-sv="1"]')).toBeNull(); // fast path, no fallback
  });

  it("falls back to re-finding by text when the study-id is gone (edit-resilient)", () => {
    // The element's study-id changed (e.g. an edit), but the text is unchanged.
    document.body.innerHTML = '<p data-study-id="CHANGED">Hello world</p>';
    decorateAnnotations(document, {
      anchors: [{ id: "a1", anchorKind: "html_selection", studyId: "s1", quote: "Hello world" }],
      notes: [{ anchorIds: ["a1"], content: "note A" }]
    });
    const mark = document.querySelector('mark[data-sv="1"]');
    expect(mark?.textContent).toBe("Hello world");
    expect(mark?.getAttribute("data-sv-note")).toBe("note A");
  });
});
