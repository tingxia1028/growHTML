// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { buildMarkerHtml, rectToOverlayLocal, MARKER_GLYPHS } from "./annotationLayer";
import { MarkerOverlay, mountRealmMarkerOverlay } from "./markerOverlay";
import type { AnchorRects } from "./surfaces/readerAnnotationAdapter";

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

  // —— D1 adapter-driven positioning ——

  function stubOverlayRect(host: HTMLElement): void {
    const overlayDiv = host.querySelector(".sv-marker-overlay") as HTMLElement;
    Object.defineProperty(overlayDiv, "getBoundingClientRect", {
      value: () => ({ left: 100, top: 50, right: 900, bottom: 650, width: 800, height: 600 }),
      configurable: true
    });
  }

  const rect = (left: number, top: number, right: number, height = 18): AnchorRects["first"] => ({
    left,
    top,
    right,
    bottom: top + height,
    width: right - left,
    height
  });

  it("routes measurement through the adapter's rectsFor and places the chip at `.first`", async () => {
    const host = makeHost();
    // No [data-sv-key] element exists in the host — the adapter alone measures.
    const rects: AnchorRects = { first: rect(200, 120, 260), last: rect(180, 180, 220), all: [rect(200, 120, 260), rect(180, 180, 220)] };
    const rectsFor = vi.fn((anchorId: string) => (anchorId === "a1" ? rects : null));
    const overlay = new MarkerOverlay(host, { adapter: { rectsFor } });
    overlay.setMarkers([{ anchorId: "a1", glyphHtml: "<span></span>" }]);
    stubOverlayRect(host);
    overlay.reposition();
    await flushFrame();
    const chip = host.querySelector('[data-sv-marker-for="a1"]') as HTMLElement;
    // first.right(260) - overlayLeft(100) = 160 ; first.top(120) - overlayTop(50) = 70
    // — the FIRST rect drives today's single chip, NOT the last.
    expect(chip.style.left).toBe("160px");
    expect(chip.style.top).toBe("70px");
    expect(chip.style.display).not.toBe("none");
    expect(rectsFor).toHaveBeenCalledWith("a1");
    overlay.destroy();
  });

  it("hides the chip when the adapter reports the anchor unpainted (rectsFor → null)", async () => {
    const host = makeHost();
    const overlay = new MarkerOverlay(host, { adapter: { rectsFor: () => null } });
    overlay.setMarkers([{ anchorId: "a1", glyphHtml: "<span></span>" }]);
    overlay.reposition();
    await flushFrame();
    const chip = host.querySelector('[data-sv-marker-for="a1"]') as HTMLElement;
    expect(chip.style.display).toBe("none");
    overlay.destroy();
  });

  it("default (adapter-less) path measures the FIRST of several elements sharing the key", async () => {
    const host = makeHost();
    // A multi-span anchor (the PDF text-layer shape): both spans carry a1's key.
    stubAnchor(host, "a1", { left: 200, top: 120, right: 260, width: 60, height: 18 });
    stubAnchor(host, "a1", { left: 150, top: 160, right: 400, width: 250, height: 18 });
    const overlay = new MarkerOverlay(host);
    overlay.setMarkers([{ anchorId: "a1", glyphHtml: "<span></span>" }]);
    stubOverlayRect(host);
    overlay.reposition();
    await flushFrame();
    const chip = host.querySelector('[data-sv-marker-for="a1"]') as HTMLElement;
    expect(chip.style.left).toBe("160px");
    expect(chip.style.top).toBe("70px");
    overlay.destroy();
  });

  it("repositions on the adapter's onLayoutChange signal and unsubscribes on destroy", async () => {
    const host = makeHost();
    let current = rect(200, 120, 260);
    const listeners = new Set<() => void>();
    const unsubscribe = vi.fn();
    const overlay = new MarkerOverlay(host, {
      adapter: {
        rectsFor: () => ({ first: current, last: current, all: [current] }),
        onLayoutChange: (cb) => {
          listeners.add(cb);
          return () => {
            listeners.delete(cb);
            unsubscribe();
          };
        }
      }
    });
    expect(listeners.size).toBe(1);
    overlay.setMarkers([{ anchorId: "a1", glyphHtml: "<span></span>" }]);
    stubOverlayRect(host);
    overlay.reposition();
    await flushFrame();

    // The realm re-laid-out (e.g. PDF zoom): the adapter's signal must reposition.
    current = rect(300, 220, 380);
    for (const cb of listeners) cb();
    await flushFrame();
    const chip = host.querySelector('[data-sv-marker-for="a1"]') as HTMLElement;
    expect(chip.style.left).toBe("280px"); // 380 - 100
    expect(chip.style.top).toBe("170px"); // 220 - 50

    overlay.destroy();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
  });
});

describe("mountRealmMarkerOverlay", () => {
  it("mounts the overlay on the realm body and forces a positioning context", () => {
    const doc = document.implementation.createHTMLDocument("realm");
    const overlay = mountRealmMarkerOverlay(doc);
    // createHTMLDocument has no defaultView/getComputedStyle → the static-body
    // fallback promotes the body to relative.
    expect(doc.body.style.position).toBe("relative");
    overlay.setMarkers([{ anchorId: "a1", glyphHtml: "<span></span>" }]);
    expect(doc.body.querySelector(".sv-marker-overlay")).not.toBeNull();
    overlay.destroy();
    expect(doc.body.querySelector(".sv-marker-overlay")).toBeNull();
  });

  it("keeps an already-positioned body untouched", () => {
    document.body.style.position = "absolute";
    const overlay = mountRealmMarkerOverlay(document);
    expect(document.body.style.position).toBe("absolute");
    overlay.destroy();
    document.body.style.position = "";
  });
});
