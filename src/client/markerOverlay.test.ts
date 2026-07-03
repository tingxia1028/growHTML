// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildMarkerHtml, rectToOverlayLocal, MARKER_GLYPHS } from "./annotationLayer";
import { MarkerOverlay } from "./markerOverlay";

// reposition() is rAF-throttled; jsdom provides requestAnimationFrame on a timer.
// Flush a frame so the layout runs before we assert.
function flushFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
    else resolve();
  });
}

describe("rectToOverlayLocal", () => {
  it("returns the anchor's TOP-RIGHT corner translated into overlay-local space", () => {
    const anchorRect = { left: 120, top: 200, right: 180, width: 60, height: 20 };
    const overlayRect = { left: 100, top: 150 };
    expect(rectToOverlayLocal(anchorRect, overlayRect)).toEqual({ x: 80, y: 50, w: 60, h: 20 });
  });

  it("handles a zero overlay origin (identity translate)", () => {
    const anchorRect = { left: 10, top: 10, right: 40, width: 30, height: 12 };
    expect(rectToOverlayLocal(anchorRect, { left: 0, top: 0 })).toEqual({ x: 40, y: 10, w: 30, h: 12 });
  });

  it("produces negative locals when the anchor is above/left of the overlay origin", () => {
    const anchorRect = { left: -5, top: -8, right: 5, width: 10, height: 6 };
    expect(rectToOverlayLocal(anchorRect, { left: 20, top: 30 })).toEqual({ x: -15, y: -38, w: 10, h: 6 });
  });
});

describe("buildMarkerHtml", () => {
  function slots(html: string): number {
    const doc = document.implementation.createHTMLDocument("m");
    doc.body.innerHTML = html;
    return doc.body.querySelectorAll(".sv-anchor-marker").length;
  }
  function el(html: string): HTMLElement {
    const doc = document.implementation.createHTMLDocument("m");
    doc.body.innerHTML = html;
    return doc.body;
  }

  it("builds one anchor glyph + a deduped note-type glyph with a repeat count", () => {
    const body = el(buildMarkerHtml({ noteTypes: ["quiz", "quiz"], noteCount: 2 }));
    // Leading anchor glyph + one (deduped) quiz glyph.
    expect(body.querySelectorAll(".sv-anchor-marker").length).toBe(2);
    expect(body.querySelectorAll("svg").length).toBe(2);
    // The repeated quiz type collapses to one glyph carrying a count superscript.
    expect(body.querySelector(".sv-anchor-marker-count")?.textContent).toBe("2");
  });

  it("emits one glyph per DISTINCT type in first-seen order", () => {
    const body = el(buildMarkerHtml({ noteTypes: ["markdown", "quiz", "quiz", "flashcard"], noteCount: 4 }));
    // anchor + markdown + quiz + flashcard = 4 slots.
    expect(body.querySelectorAll(".sv-anchor-marker").length).toBe(4);
    // Only the repeated quiz carries a superscript.
    expect(body.querySelectorAll(".sv-anchor-marker-count").length).toBe(1);
    expect(body.querySelector(".sv-anchor-marker-count")?.textContent).toBe("2");
  });

  it("renders only the anchor glyph when there are no visible notes", () => {
    expect(slots(buildMarkerHtml({ noteTypes: [], noteCount: 0 }))).toBe(1);
  });

  it("carries the note count on the markdown fallback when >1", () => {
    const body = el(buildMarkerHtml({ noteTypes: [], noteCount: 3 }));
    expect(body.querySelector(".sv-anchor-marker-count")?.textContent).toBe("3");
  });

  it("uses the markdown glyph (stroke=currentColor) for the fallback", () => {
    expect(MARKER_GLYPHS.markdown).toContain('stroke="currentColor"');
  });

  it("marks the leading glyph as anchor and note glyphs as note actions", () => {
    const body = el(buildMarkerHtml({ noteTypes: ["markdown", "quiz"], noteCount: 2 }));
    const roles = Array.from(body.querySelectorAll("[data-sv-marker-role]")).map((item) =>
      item.getAttribute("data-sv-marker-role")
    );
    expect(roles).toEqual(["anchor", "note", "note"]);
  });
});

describe("MarkerOverlay", () => {
  // A host whose getBoundingClientRect and children we control, since jsdom has no
  // layout. reposition() runs synchronously here (jsdom has no rAF by default in
  // the test path — but if present, it's still driven by our anchor stub).
  function makeHost(): HTMLElement {
    const host = document.createElement("div");
    Object.defineProperty(host, "getBoundingClientRect", {
      value: () => ({ left: 100, top: 50, right: 900, bottom: 650, width: 800, height: 600 }),
      configurable: true
    });
    document.body.appendChild(host);
    return host;
  }

  function stubAnchor(host: HTMLElement, key: string, rect: { left: number; top: number; right: number; width: number; height: number }): HTMLElement {
    const anchor = document.createElement("span");
    anchor.setAttribute("data-sv-key", key);
    Object.defineProperty(anchor, "getBoundingClientRect", {
      value: () => ({ ...rect, bottom: rect.top + rect.height }),
      configurable: true
    });
    host.appendChild(anchor);
    return anchor;
  }

  it("setMarkers creates one chip per item inside a single overlay div", () => {
    const host = makeHost();
    const overlay = new MarkerOverlay(host);
    overlay.setMarkers([
      { anchorId: "a1", glyphHtml: buildMarkerHtml({ noteTypes: ["quiz"], noteCount: 1 }) },
      { anchorId: "a2", glyphHtml: buildMarkerHtml({ noteTypes: ["markdown"], noteCount: 1 }) }
    ]);
    const overlayDiv = host.querySelector(".sv-marker-overlay");
    expect(overlayDiv).not.toBeNull();
    expect(host.querySelectorAll(".sv-marker-overlay").length).toBe(1);
    expect(overlayDiv!.querySelectorAll(".sv-anchor-markers").length).toBe(2);
    expect(overlayDiv!.querySelector('[data-sv-marker-for="a1"]')).not.toBeNull();
    overlay.destroy();
  });

  it("clear removes all chips", () => {
    const host = makeHost();
    const overlay = new MarkerOverlay(host);
    overlay.setMarkers([{ anchorId: "a1", glyphHtml: "<span></span>" }]);
    overlay.clear();
    expect(host.querySelectorAll(".sv-anchor-markers").length).toBe(0);
    overlay.destroy();
  });

  it("reposition places a chip at its anchor's overlay-local top-right", async () => {
    const host = makeHost();
    stubAnchor(host, "a1", { left: 200, top: 120, right: 260, width: 60, height: 18 });
    const overlay = new MarkerOverlay(host);
    overlay.setMarkers([{ anchorId: "a1", glyphHtml: "<span></span>" }]);
    // layout() references the OVERLAY div's rect (the chip's offset parent), not the
    // host's — the overlay is inset:0 in the host and scrolls with content, so stub its
    // rect to the host's box (jsdom has no layout).
    const overlayDiv = host.querySelector(".sv-marker-overlay") as HTMLElement;
    Object.defineProperty(overlayDiv, "getBoundingClientRect", {
      value: () => ({ left: 100, top: 50, right: 900, bottom: 650, width: 800, height: 600 }),
      configurable: true
    });
    overlay.reposition();
    await flushFrame();
    const chip = host.querySelector('[data-sv-marker-for="a1"]') as HTMLElement;
    // right(260) - overlayLeft(100) = 160 ; top(120) - overlayTop(50) = 70.
    expect(chip.style.left).toBe("160px");
    expect(chip.style.top).toBe("70px");
    expect(chip.style.display).not.toBe("none");
    overlay.destroy();
  });

  it("reposition hides a chip whose anchor element is missing (virtualized out)", async () => {
    const host = makeHost();
    const overlay = new MarkerOverlay(host);
    // No anchor element exists for a1.
    overlay.setMarkers([{ anchorId: "a1", glyphHtml: "<span></span>" }]);
    overlay.reposition();
    await flushFrame();
    const chip = host.querySelector('[data-sv-marker-for="a1"]') as HTMLElement;
    expect(chip.style.display).toBe("none");
    overlay.destroy();
  });

  it("clicking the note marker dispatches a click to the live anchor and emits a note action", () => {
    const host = makeHost();
    const anchor = stubAnchor(host, "a1", { left: 200, top: 120, right: 260, width: 60, height: 18 });
    let anchorClicks = 0;
    const actions: string[] = [];
    anchor.addEventListener("click", () => {
      anchorClicks += 1;
    });
    const overlay = new MarkerOverlay(host, {
      onAction: ({ anchorId, role }) => actions.push(`${role}:${anchorId}`)
    });
    overlay.setMarkers([{ anchorId: "a1", glyphHtml: buildMarkerHtml({ noteTypes: ["markdown"], noteCount: 1 }) }]);

    const noteButton = host.querySelector('[data-sv-marker-role="note"]') as HTMLElement;
    noteButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(anchorClicks).toBe(1);
    expect(actions).toEqual(["note:a1"]);
    overlay.destroy();
  });

  it("clicking the anchor marker emits an anchor action without opening the note card", () => {
    const host = makeHost();
    const anchor = stubAnchor(host, "a1", { left: 200, top: 120, right: 260, width: 60, height: 18 });
    let anchorClicks = 0;
    const actions: string[] = [];
    anchor.addEventListener("click", () => {
      anchorClicks += 1;
    });
    const overlay = new MarkerOverlay(host, {
      onAction: ({ anchorId, role }) => actions.push(`${role}:${anchorId}`)
    });
    overlay.setMarkers([{ anchorId: "a1", glyphHtml: buildMarkerHtml({ noteTypes: ["markdown"], noteCount: 1 }) }]);

    const anchorButton = host.querySelector('[data-sv-marker-role="anchor"]') as HTMLElement;
    anchorButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(anchorClicks).toBe(0);
    expect(actions).toEqual(["anchor:a1"]);
    overlay.destroy();
  });

  it("destroy removes the overlay div", () => {
    const host = makeHost();
    const overlay = new MarkerOverlay(host);
    overlay.setMarkers([{ anchorId: "a1", glyphHtml: "<span></span>" }]);
    overlay.destroy();
    expect(host.querySelector(".sv-marker-overlay")).toBeNull();
  });
});
