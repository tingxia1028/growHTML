// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { applyHighlight, clearAnnotations, ANNOTATION_CSS, MARKER_GLYPHS } from "./annotationLayer";
import { ICONS } from "./notes/noteTypeIcon";

describe("inline-adjacent anchor markers", () => {
  it("paints one anchor glyph + a deduped note-type glyph with a repeat count", () => {
    const doc = document.implementation.createHTMLDocument("markers");
    doc.body.innerHTML = '<p id="t">annotated passage</p>';
    const el = doc.getElementById("t")!;

    applyHighlight(el, "", "k", { noteTypes: ["quiz", "quiz"], noteCount: 2 });

    const markers = el.querySelector(":scope > .sv-anchor-markers");
    expect(markers).not.toBeNull();

    // Two distinct marker slots: the leading anchor glyph + one (deduped) quiz glyph.
    const slots = markers!.querySelectorAll(".sv-anchor-marker");
    expect(slots.length).toBe(2);
    expect(markers!.querySelectorAll("svg").length).toBe(2);

    // The repeated quiz type collapses to one glyph carrying a count superscript.
    const count = markers!.querySelector(".sv-anchor-marker-count");
    expect(count?.textContent).toBe("2");
  });

  it("repaints without stacking marker spans", () => {
    const doc = document.implementation.createHTMLDocument("markers-repaint");
    doc.body.innerHTML = '<p id="t">passage</p>';
    const el = doc.getElementById("t")!;
    applyHighlight(el, "", "k", { noteTypes: ["markdown"], noteCount: 1 });
    applyHighlight(el, "", "k", { noteTypes: ["markdown"], noteCount: 1 });
    expect(el.querySelectorAll(":scope > .sv-anchor-markers").length).toBe(1);
  });

  it("falls back to the anchor + markdown glyph when no note types are given", () => {
    const doc = document.implementation.createHTMLDocument("markers-fallback");
    doc.body.innerHTML = '<p id="t">passage</p>';
    const el = doc.getElementById("t")!;
    applyHighlight(el, "", "k", { noteTypes: [], noteCount: 0 });
    const markers = el.querySelector(":scope > .sv-anchor-markers")!;
    // Anchor glyph + the markdown fallback glyph.
    expect(markers.querySelectorAll(".sv-anchor-marker").length).toBe(2);
  });

  // Regression guard: the markers must carry an EXPLICIT color so they don't inherit
  // `color:transparent` from a PDF.js transparent text-layer span (which made the
  // `stroke="currentColor"` glyphs invisible in the PDF/image realm). jsdom can't
  // reproduce computed inheritance, so assert the explicit style rule + glyph stroke.
  it("sets an explicit (non-inherited) marker color in the stylesheet", () => {
    // The .sv-anchor-markers rule declares a literal color (not `inherit`/`currentColor`).
    expect(ANNOTATION_CSS).toMatch(/\.sv-anchor-markers\s*\{[^}]*color:\s*#3474e6/);
    // The glyph SVGs render with currentColor stroke, resolving to that literal color.
    expect(ANNOTATION_CSS).toMatch(/\.sv-anchor-marker svg\s*\{[^}]*stroke:\s*currentColor/);
    expect(MARKER_GLYPHS.markdown).toContain('stroke="currentColor"');
  });

  // Region/overlay realm (PDF text-layer hit span, image region box): a child chip is
  // hidden + SCALED by the host span's transform (PDF.js `.textLayer span` color +
  // scaleX), which a descendant can't escape. So the chip is attached to the host's
  // PARENT (the text-layer container, not a span) as an absolutely-positioned
  // `.sv-anchor-markers-region` chip, keyed by data-sv-marker-for for repaint/clear.
  it("attaches region markers to the host's parent, not inside the host", () => {
    const doc = document.implementation.createHTMLDocument("markers-region");
    doc.body.innerHTML = '<div id="layer"><span id="hit" class="pdf-anchor-hit">region</span></div>';
    const el = doc.getElementById("hit")!;
    const parent = doc.getElementById("layer")!;

    applyHighlight(el, "", "k", { noteTypes: ["quiz"], noteCount: 1 });

    // The chip is NOT a child of the host span (it would be scaled away there)...
    expect(el.querySelector(":scope > .sv-anchor-markers")).toBeNull();
    // ...it lives on the parent, keyed to the anchor, with the region class.
    const markers = parent.querySelector(":scope > .sv-anchor-markers") as HTMLElement;
    expect(markers).not.toBeNull();
    expect(markers.classList.contains("sv-anchor-markers-region")).toBe(true);
    expect(markers.getAttribute("data-sv-marker-for")).toBe("k");
    // A positioning context was established on the previously-static parent.
    expect(parent.style.position).toBe("relative");
    expect(parent.dataset.svMarkerPos).toBe("1");
    // The absolute-positioned rule exists in the stylesheet.
    expect(ANNOTATION_CSS).toMatch(/\.sv-anchor-markers\.sv-anchor-markers-region\s*\{[^}]*position:\s*absolute/);

    // Repaint must not stack the parent-attached chip.
    applyHighlight(el, "", "k", { noteTypes: ["quiz"], noteCount: 1 });
    expect(parent.querySelectorAll(".sv-anchor-markers").length).toBe(1);

    // clearAnnotations removes the chip and reverts the added position.
    clearAnnotations(doc.body);
    expect(parent.querySelector(".sv-anchor-markers")).toBeNull();
    expect(parent.style.position).toBe("");
    expect(parent.dataset.svMarkerPos).toBeUndefined();
  });

  it("keeps the inline (non-region) branch for a flowing mark host", () => {
    const doc = document.implementation.createHTMLDocument("markers-inline");
    doc.body.innerHTML = '<p><mark id="m">inline passage</mark></p>';
    const el = doc.getElementById("m")!;
    applyHighlight(el, "", "k", { noteTypes: ["markdown"], noteCount: 1 });
    const markers = el.querySelector(":scope > .sv-anchor-markers")!;
    // Inline flowing text: no region class, no injected positioning context.
    expect(markers.classList.contains("sv-anchor-markers-region")).toBe(false);
    expect((el as HTMLElement).dataset.svMarkerPos).toBeUndefined();
  });
});

describe("marker glyph map parity with noteTypeIcon", () => {
  it("has a MARKER_GLYPHS entry for every noteTypeIcon key", () => {
    const missing = Object.keys(ICONS).filter((key) => !(key in MARKER_GLYPHS));
    expect(missing, `MARKER_GLYPHS missing keys: ${missing.join(", ")}`).toEqual([]);
  });
});
