// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  applyHighlight,
  clampGeom,
  clearAnnotations,
  ensureAnnotationLayer,
  highlightQuote,
  readCardGeom,
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
