// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  applyHighlight,
  clampGeom,
  clearAnnotations,
  clearMarginNotes,
  ensureAnnotationLayer,
  highlightQuote,
  packColumn,
  paintMarginNotes,
  readCardGeom,
  revealAnchorInDoc,
  setSelectedAnchorInDoc,
  writeCardGeom
} from "./annotationLayer";
import { decorateAnnotations } from "./annotations";

beforeEach(() => {
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  window.localStorage.clear();
});

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
      '<p data-study-id="s1" class="sv-annotated" data-sv-note="n">x <mark data-sv="1" class="sv-annotated" data-sv-note="m">y</mark> z</p>';
    clearAnnotations(document.body);
    expect(document.querySelector('mark[data-sv="1"]')).toBeNull();
    expect(document.body.textContent).toBe("x y z");
    const el = document.querySelector('[data-study-id="s1"]');
    expect(el?.classList.contains("sv-annotated")).toBe(false);
    expect(el?.hasAttribute("data-sv-note")).toBe(false);
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

  it("restores the saved placement when its anchor's highlight is hovered", () => {
    document.body.innerHTML = '<p id="t">hello</p>';
    ensureAnnotationLayer(document);
    const el = document.getElementById("t")!;
    applyHighlight(el, "note A", "k1");
    writeCardGeom(document, "k1", { left: 300, top: 200, width: 250, height: 150 });
    el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    const card = document.getElementById("sv-note-card")!;
    expect(card.classList.contains("sv-note-card-show")).toBe(true);
    expect(card.style.left).toBe("300px");
    expect(card.style.top).toBe("200px");
    expect(card.style.width).toBe("250px");
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
      { element: document.getElementById("a")!, noteText: "**first**", key: "k1" },
      { element: document.getElementById("b")!, noteText: "second", key: "k2" }
    ]);
    expect(document.body.classList.contains("sv-annot-margin")).toBe(true);
    const cards = document.querySelectorAll("#sv-margin-layer .sv-margin-note");
    expect(cards).toHaveLength(2);
    // Markdown is rendered (not raw): the first note becomes a <strong>.
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
      notes: [{ anchorIds: ["a1"], content: "margin note" }],
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
