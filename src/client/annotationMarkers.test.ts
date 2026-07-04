// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { applyHighlight, clearAnnotations, ANNOTATION_CSS, MARKER_GLYPHS } from "./annotationLayer";
import { ICONS } from "./notes/noteTypeIcon";

// Markers now live in a VIEW-LAYER overlay (see markerOverlay.test.ts for the glyph-
// building + positioning coverage). applyHighlight must therefore inject NO marker
// into the annotated content — even for a region/overlay host that used to get a
// parent-attached chip.
describe("applyHighlight no longer injects markers into content", () => {
  it("paints the highlight but adds NO marker span to a flowing mark host", () => {
    const doc = document.implementation.createHTMLDocument("markers-inline");
    doc.body.innerHTML = '<p><mark id="m">inline passage</mark></p>';
    const el = doc.getElementById("m")!;
    applyHighlight(el, "", "k", { noteTypes: ["markdown"], noteCount: 1 });
    expect(el.classList.contains("sv-annotated")).toBe(true);
    expect(el.querySelector(".sv-anchor-markers")).toBeNull();
  });

  it("injects NO marker into a region host, and adds no positioning context", () => {
    const doc = document.implementation.createHTMLDocument("markers-region");
    doc.body.innerHTML = '<div id="layer"><span id="hit" class="pdf-anchor-hit">region</span></div>';
    const el = doc.getElementById("hit")!;
    const parent = doc.getElementById("layer")!;

    applyHighlight(el, "", "k", { noteTypes: ["quiz"], noteCount: 1 });

    // No chip is placed inside the host, on its parent, or anywhere in the document...
    expect(el.querySelector(".sv-anchor-markers")).toBeNull();
    expect(parent.querySelector(".sv-anchor-markers")).toBeNull();
    expect(doc.querySelector(".sv-anchor-markers")).toBeNull();
    // ...and no positioning context / marker-pos marker was ever added to content.
    expect(parent.style.position).toBe("");
    expect(parent.dataset.svMarkerPos).toBeUndefined();
    expect(doc.querySelector("[data-sv-marker-pos]")).toBeNull();

    // clearAnnotations still cleans the highlight and doesn't choke on the region.
    clearAnnotations(doc.body);
    expect(el.classList.contains("sv-annotated")).toBe(false);
  });

  // Regression guard: the overlay marker chip must carry an EXPLICIT color so it
  // doesn't inherit `color:transparent` from a realm's text-layer span (which made
  // the `stroke="currentColor"` glyphs invisible). jsdom can't reproduce computed
  // inheritance, so assert the explicit style rule + glyph stroke. This now points at
  // the OVERLAY `.sv-anchor-markers` rule (position:absolute chip).
  it("sets an explicit (non-inherited) marker color in the stylesheet", () => {
    // The .sv-anchor-markers rule declares a literal color (not `inherit`/`currentColor`).
    expect(ANNOTATION_CSS).toMatch(/\.sv-anchor-markers\s*\{[^}]*color:\s*#3474e6/);
    // The glyph SVGs render with currentColor stroke, resolving to that literal color.
    expect(ANNOTATION_CSS).toMatch(/\.sv-anchor-marker svg\s*\{[^}]*stroke:\s*currentColor/);
    expect(MARKER_GLYPHS.markdown).toContain('stroke="currentColor"');
  });

  // The overlay layer must exist and be an absolutely-positioned, click-through,
  // clipped sibling layer.
  it("declares the .sv-marker-overlay layer rule", () => {
    expect(ANNOTATION_CSS).toMatch(/\.sv-marker-overlay\s*\{[^}]*position:\s*absolute/);
    expect(ANNOTATION_CSS).toMatch(/\.sv-marker-overlay\s*\{[^}]*pointer-events:\s*none/);
  });

  // D2 two-slot rules: the LEFT slot pulls fully into the left margin (translateX
  // -100% — chip width isn't known at layout time), and a toggled-off anchor's
  // chip is dimmed via the data attribute the overlay stamps.
  it("declares the left-slot transform and the toggled-off dim rule", () => {
    expect(ANNOTATION_CSS).toMatch(/\.sv-anchor-markers\.sv-slot-anchor\s*\{[^}]*-100%/);
    expect(ANNOTATION_CSS).toMatch(/\.sv-anchor-markers\[data-sv-notes-hidden="1"\]/);
  });
});

describe("marker glyph map parity with noteTypeIcon", () => {
  it("has a MARKER_GLYPHS entry for every noteTypeIcon key", () => {
    const missing = Object.keys(ICONS).filter((key) => !(key in MARKER_GLYPHS));
    expect(missing, `MARKER_GLYPHS missing keys: ${missing.join(", ")}`).toEqual([]);
  });
});
