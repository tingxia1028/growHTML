// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyHighlight,
  buildAnchorSlotHtml,
  buildNoteSlotHtml,
  ensureAnnotationLayer,
  isAnchorNotesHidden,
  MARKER_GLYPHS,
  rectToOverlayLocal,
  setAnchorNotesHidden
} from "./annotationLayer";
import {
  getAnchorGlyphVisibility,
  MarkerOverlay,
  mountRealmMarkerOverlay,
  setAnchorGlyphVisibility
} from "./markerOverlay";
import type { AnchorRects } from "./surfaces/readerAnnotationAdapter";

// reposition() is rAF-throttled; jsdom provides requestAnimationFrame on a timer.
// Flush a frame so the layout runs before we assert.
function flushFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
    else resolve();
  });
}

afterEach(() => {
  // The glyph-visibility store is module-level (realm-local); restore the default.
  setAnchorGlyphVisibility(true);
});

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

function el(html: string): HTMLElement {
  const doc = document.implementation.createHTMLDocument("m");
  doc.body.innerHTML = html;
  return doc.body;
}

describe("buildAnchorSlotHtml (D2 left slot)", () => {
  it("is exactly ONE anchor-role toggle button with the anchor glyph and no count", () => {
    const body = el(buildAnchorSlotHtml());
    expect(body.querySelectorAll(".sv-anchor-marker").length).toBe(1);
    expect(body.querySelectorAll("svg").length).toBe(1);
    expect(body.querySelector(".sv-anchor-marker-count")).toBeNull();
    const button = body.querySelector("[data-sv-marker-role]")!;
    expect(button.getAttribute("data-sv-marker-role")).toBe("anchor");
    // User-amended semantics: the left slot TOGGLES the anchor's notes.
    expect(button.getAttribute("title")).toBe("Toggle this anchor's notes");
  });
});

describe("buildNoteSlotHtml (D2 right slot)", () => {
  it("dedupes a repeated type into one glyph carrying a count superscript", () => {
    const body = el(buildNoteSlotHtml({ noteTypes: ["quiz", "quiz"], noteCount: 2 }));
    expect(body.querySelectorAll(".sv-anchor-marker").length).toBe(1);
    expect(body.querySelectorAll("svg").length).toBe(1);
    expect(body.querySelector(".sv-anchor-marker-count")?.textContent).toBe("2");
  });

  it("emits one glyph per DISTINCT type in first-seen order (no leading anchor glyph)", () => {
    const body = el(buildNoteSlotHtml({ noteTypes: ["markdown", "quiz", "quiz", "flashcard"], noteCount: 4 }));
    // markdown + quiz + flashcard = 3 slots — the anchor glyph moved to the left slot.
    expect(body.querySelectorAll(".sv-anchor-marker").length).toBe(3);
    // Only the repeated quiz carries a superscript.
    expect(body.querySelectorAll(".sv-anchor-marker-count").length).toBe(1);
    expect(body.querySelector(".sv-anchor-marker-count")?.textContent).toBe("2");
  });

  it("returns an EMPTY string when there are no visible notes (no right chip at all)", () => {
    expect(buildNoteSlotHtml({ noteTypes: [], noteCount: 0 })).toBe("");
    expect(buildNoteSlotHtml()).toBe("");
  });

  it("carries the note count on the markdown fallback when >1", () => {
    const body = el(buildNoteSlotHtml({ noteTypes: [], noteCount: 3 }));
    expect(body.querySelector(".sv-anchor-marker-count")?.textContent).toBe("3");
  });

  it("uses the markdown glyph (stroke=currentColor) for the fallback", () => {
    expect(MARKER_GLYPHS.markdown).toContain('stroke="currentColor"');
  });

  it("marks every glyph as a note action", () => {
    const body = el(buildNoteSlotHtml({ noteTypes: ["markdown", "quiz"], noteCount: 2 }));
    const roles = Array.from(body.querySelectorAll("[data-sv-marker-role]")).map((item) =>
      item.getAttribute("data-sv-marker-role")
    );
    expect(roles).toEqual(["note", "note"]);
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

  function stubOverlayRect(host: HTMLElement): void {
    const overlayDiv = host.querySelector(".sv-marker-overlay") as HTMLElement;
    Object.defineProperty(overlayDiv, "getBoundingClientRect", {
      value: () => ({ left: 100, top: 50, right: 900, bottom: 650, width: 800, height: 600 }),
      configurable: true
    });
  }

  const slots = (payload?: Parameters<typeof buildNoteSlotHtml>[0]) => ({
    anchorSlotHtml: buildAnchorSlotHtml(),
    noteSlotHtml: buildNoteSlotHtml(payload)
  });

  it("setMarkers creates TWO slot chips per noted anchor (one for a note-less anchor)", () => {
    const host = makeHost();
    const overlay = new MarkerOverlay(host);
    overlay.setMarkers([
      { anchorId: "a1", ...slots({ noteTypes: ["quiz"], noteCount: 1 }) },
      { anchorId: "bare", ...slots({ noteTypes: [], noteCount: 0 }) }
    ]);
    const overlayDiv = host.querySelector(".sv-marker-overlay");
    expect(overlayDiv).not.toBeNull();
    expect(host.querySelectorAll(".sv-marker-overlay").length).toBe(1);
    // a1: anchor + note chips; bare: anchor chip only (empty note slot ⇒ no chip).
    expect(overlayDiv!.querySelectorAll(".sv-anchor-markers").length).toBe(3);
    expect(overlayDiv!.querySelector('[data-sv-marker-for="a1"][data-sv-slot="anchor"]')).not.toBeNull();
    expect(overlayDiv!.querySelector('[data-sv-marker-for="a1"][data-sv-slot="note"]')).not.toBeNull();
    expect(overlayDiv!.querySelector('[data-sv-marker-for="bare"][data-sv-slot="anchor"]')).not.toBeNull();
    expect(overlayDiv!.querySelector('[data-sv-marker-for="bare"][data-sv-slot="note"]')).toBeNull();
    overlay.destroy();
  });

  it("clear removes all chips", () => {
    const host = makeHost();
    const overlay = new MarkerOverlay(host);
    overlay.setMarkers([{ anchorId: "a1", anchorSlotHtml: "<span></span>", noteSlotHtml: "<span></span>" }]);
    overlay.clear();
    expect(host.querySelectorAll(".sv-anchor-markers").length).toBe(0);
    overlay.destroy();
  });

  it("reposition places the anchor chip at the FIRST line's left and the note chip at the LAST line's right (single rect: first === last)", async () => {
    const host = makeHost();
    stubAnchor(host, "a1", { left: 200, top: 120, right: 260, width: 60, height: 18 });
    const overlay = new MarkerOverlay(host);
    overlay.setMarkers([{ anchorId: "a1", anchorSlotHtml: "<span></span>", noteSlotHtml: "<span></span>" }]);
    // layout() references the OVERLAY div's rect (the chip's offset parent), not the
    // host's — the overlay is inset:0 in the host and scrolls with content, so stub its
    // rect to the host's box (jsdom has no layout).
    stubOverlayRect(host);
    overlay.reposition();
    await flushFrame();
    const anchorChip = host.querySelector('[data-sv-marker-for="a1"][data-sv-slot="anchor"]') as HTMLElement;
    const noteChip = host.querySelector('[data-sv-marker-for="a1"][data-sv-slot="note"]') as HTMLElement;
    // Anchor slot: left(200) - overlayLeft(100) = 100 ; top(120) - overlayTop(50) = 70
    // (the stylesheet's translateX(-100%) pulls the chip into the left margin).
    expect(anchorChip.style.left).toBe("100px");
    expect(anchorChip.style.top).toBe("70px");
    expect(anchorChip.style.display).not.toBe("none");
    // Note slot: right(260) - overlayLeft(100) = 160 ; same line (first === last).
    expect(noteChip.style.left).toBe("160px");
    expect(noteChip.style.top).toBe("70px");
    expect(noteChip.style.display).not.toBe("none");
    overlay.destroy();
  });

  it("reposition hides both chips when the anchor element is missing (virtualized out)", async () => {
    const host = makeHost();
    const overlay = new MarkerOverlay(host);
    // No anchor element exists for a1.
    overlay.setMarkers([{ anchorId: "a1", anchorSlotHtml: "<span></span>", noteSlotHtml: "<span></span>" }]);
    overlay.reposition();
    await flushFrame();
    const anchorChip = host.querySelector('[data-sv-slot="anchor"]') as HTMLElement;
    const noteChip = host.querySelector('[data-sv-slot="note"]') as HTMLElement;
    expect(anchorChip.style.display).toBe("none");
    expect(noteChip.style.display).toBe("none");
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
    overlay.setMarkers([{ anchorId: "a1", ...slots({ noteTypes: ["markdown"], noteCount: 1 }) }]);

    const noteButton = host.querySelector('[data-sv-marker-role="note"]') as HTMLElement;
    noteButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(anchorClicks).toBe(1);
    expect(actions).toEqual(["note:a1"]);
    overlay.destroy();
  });

  it("clicking the anchor marker emits an anchor action without opening the note card", () => {
    const host = makeHost();
    const anchor = stubAnchor(host, "act-a1", { left: 200, top: 120, right: 260, width: 60, height: 18 });
    let anchorClicks = 0;
    const actions: string[] = [];
    anchor.addEventListener("click", () => {
      anchorClicks += 1;
    });
    const overlay = new MarkerOverlay(host, {
      onAction: ({ anchorId, role }) => actions.push(`${role}:${anchorId}`)
    });
    overlay.setMarkers([{ anchorId: "act-a1", ...slots({ noteTypes: ["markdown"], noteCount: 1 }) }]);

    const anchorButton = host.querySelector('[data-sv-marker-role="anchor"]') as HTMLElement;
    anchorButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(anchorClicks).toBe(0);
    expect(actions).toEqual(["anchor:act-a1"]);
    overlay.destroy();
    setAnchorNotesHidden(document, "act-a1", false); // the click also toggled — reset
  });

  // —— D2 per-anchor toggle (user-amended: anchor chip = hide/show that anchor's notes) ——

  it("anchor-chip click toggles the anchor's note chip + cards; second click restores; other anchors unaffected", async () => {
    ensureAnnotationLayer(document);
    const host = makeHost();
    const a1 = stubAnchor(host, "tg-a1", { left: 200, top: 120, right: 260, width: 60, height: 18 });
    const a2 = stubAnchor(host, "tg-a2", { left: 200, top: 220, right: 260, width: 60, height: 18 });
    applyHighlight(a1, "note one", "tg-a1", { noteHtml: "<div>Card one</div>", noteCount: 1, noteTypes: ["markdown"] });
    applyHighlight(a2, "note two", "tg-a2", { noteHtml: "<div>Card two</div>", noteCount: 1, noteTypes: ["quiz"] });
    const overlay = new MarkerOverlay(host);
    overlay.setMarkers([
      { anchorId: "tg-a1", ...slots({ noteTypes: ["markdown"], noteCount: 1 }) },
      { anchorId: "tg-a2", ...slots({ noteTypes: ["quiz"], noteCount: 1 }) }
    ]);
    stubOverlayRect(host);
    overlay.reposition();
    await flushFrame();

    const anchorBtn1 = host.querySelector(
      '[data-sv-marker-for="tg-a1"][data-sv-slot="anchor"] [data-sv-marker-role="anchor"]'
    ) as HTMLElement;
    const anchorChip1 = host.querySelector('[data-sv-marker-for="tg-a1"][data-sv-slot="anchor"]') as HTMLElement;
    const noteChip1 = host.querySelector('[data-sv-marker-for="tg-a1"][data-sv-slot="note"]') as HTMLElement;
    const noteChip2 = host.querySelector('[data-sv-marker-for="tg-a2"][data-sv-slot="note"]') as HTMLElement;
    const card = document.getElementById("sv-note-card")!;

    // Toggle OFF: the note chip hides, the anchor chip flags the collapsed state.
    anchorBtn1.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await flushFrame();
    expect(isAnchorNotesHidden(document, "tg-a1")).toBe(true);
    expect(noteChip1.style.display).toBe("none");
    expect(anchorChip1.getAttribute("data-sv-notes-hidden")).toBe("1");
    expect(noteChip2.style.display).not.toBe("none"); // other anchor untouched
    expect(isAnchorNotesHidden(document, "tg-a2")).toBe(false);

    // The toggled-off anchor shows NO card — hover and click-pin both suppressed.
    a1.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(card.classList.contains("sv-note-card-show")).toBe(false);
    a1.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(card.classList.contains("sv-note-card-show")).toBe(false);

    // The OTHER anchor's hover card still works.
    a2.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(card.classList.contains("sv-note-card-show")).toBe(true);
    expect(card.querySelector(".sv-note-card-body")!.innerHTML).toContain("Card two");
    a2.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));

    // Toggle ON: everything restores.
    anchorBtn1.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await flushFrame();
    expect(isAnchorNotesHidden(document, "tg-a1")).toBe(false);
    expect(noteChip1.style.display).not.toBe("none");
    expect(anchorChip1.getAttribute("data-sv-notes-hidden")).toBeNull();
    a1.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(card.classList.contains("sv-note-card-show")).toBe(true);
    expect(card.querySelector(".sv-note-card-body")!.innerHTML).toContain("Card one");

    // Dismiss the shared card so it doesn't leak into other tests.
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    overlay.destroy();
  });

  it("toggling OFF dismisses an OPEN pinned card for that anchor", async () => {
    ensureAnnotationLayer(document);
    const host = makeHost();
    const a1 = stubAnchor(host, "tg-pin", { left: 200, top: 120, right: 260, width: 60, height: 18 });
    applyHighlight(a1, "note", "tg-pin", { noteHtml: "<div>Pinned body</div>", noteCount: 1, noteTypes: ["markdown"] });
    const overlay = new MarkerOverlay(host);
    overlay.setMarkers([{ anchorId: "tg-pin", ...slots({ noteTypes: ["markdown"], noteCount: 1 }) }]);
    await flushFrame();

    a1.dispatchEvent(new MouseEvent("click", { bubbles: true })); // pin the card
    const card = document.getElementById("sv-note-card")!;
    expect(card.classList.contains("sv-note-card-show")).toBe(true);

    const anchorBtn = host.querySelector(
      '[data-sv-marker-for="tg-pin"][data-sv-slot="anchor"] [data-sv-marker-role="anchor"]'
    ) as HTMLElement;
    anchorBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(card.classList.contains("sv-note-card-show")).toBe(false);

    overlay.destroy();
    setAnchorNotesHidden(document, "tg-pin", false); // session state — reset for other tests
  });

  // —— Global anchor-glyph switch (显示锚点标记) ——

  it("disabling the global switch hides ALL anchor chips; note slots stay; re-enable restores", async () => {
    const host = makeHost();
    stubAnchor(host, "gv-1", { left: 200, top: 120, right: 260, width: 60, height: 18 });
    stubAnchor(host, "gv-2", { left: 200, top: 220, right: 260, width: 60, height: 18 });
    const overlay = new MarkerOverlay(host);
    overlay.setMarkers([
      { anchorId: "gv-1", ...slots({ noteTypes: ["markdown"], noteCount: 1 }) },
      { anchorId: "gv-2", ...slots({ noteTypes: ["quiz"], noteCount: 1 }) }
    ]);
    stubOverlayRect(host);
    overlay.reposition();
    await flushFrame();

    const anchorChips = Array.from(host.querySelectorAll('[data-sv-slot="anchor"]')) as HTMLElement[];
    const noteChips = Array.from(host.querySelectorAll('[data-sv-slot="note"]')) as HTMLElement[];
    expect(anchorChips).toHaveLength(2);
    for (const chip of anchorChips) expect(chip.style.display).not.toBe("none");

    setAnchorGlyphVisibility(false); // the overlay subscribed — no manual reposition
    await flushFrame();
    expect(getAnchorGlyphVisibility()).toBe(false);
    for (const chip of anchorChips) expect(chip.style.display).toBe("none");
    for (const chip of noteChips) expect(chip.style.display).not.toBe("none");

    setAnchorGlyphVisibility(true);
    await flushFrame();
    for (const chip of anchorChips) expect(chip.style.display).not.toBe("none");
    overlay.destroy();
  });

  it("destroy removes the overlay div", () => {
    const host = makeHost();
    const overlay = new MarkerOverlay(host);
    overlay.setMarkers([{ anchorId: "a1", anchorSlotHtml: "<span></span>", noteSlotHtml: "<span></span>" }]);
    overlay.destroy();
    expect(host.querySelector(".sv-marker-overlay")).toBeNull();
  });

  // —— D1 adapter-driven positioning ——

  const rect = (left: number, top: number, right: number, height = 18): AnchorRects["first"] => ({
    left,
    top,
    right,
    bottom: top + height,
    width: right - left,
    height
  });

  it("routes measurement through the adapter: anchor chip at `.first`, note chip at `.last` (multi-line passage)", async () => {
    const host = makeHost();
    // No [data-sv-key] element exists in the host — the adapter alone measures.
    const rects: AnchorRects = {
      first: rect(200, 120, 260),
      last: rect(180, 180, 220),
      all: [rect(200, 120, 260), rect(180, 180, 220)]
    };
    const rectsFor = vi.fn((anchorId: string) => (anchorId === "a1" ? rects : null));
    const overlay = new MarkerOverlay(host, { adapter: { rectsFor } });
    overlay.setMarkers([{ anchorId: "a1", anchorSlotHtml: "<span></span>", noteSlotHtml: "<span></span>" }]);
    stubOverlayRect(host);
    overlay.reposition();
    await flushFrame();
    const anchorChip = host.querySelector('[data-sv-slot="anchor"]') as HTMLElement;
    const noteChip = host.querySelector('[data-sv-slot="note"]') as HTMLElement;
    // Anchor slot ← FIRST line: left(200) - 100 = 100 ; top(120) - 50 = 70.
    expect(anchorChip.style.left).toBe("100px");
    expect(anchorChip.style.top).toBe("70px");
    // Note slot ← LAST line: right(220) - 100 = 120 ; top(180) - 50 = 130.
    expect(noteChip.style.left).toBe("120px");
    expect(noteChip.style.top).toBe("130px");
    expect(rectsFor).toHaveBeenCalledWith("a1");
    overlay.destroy();
  });

  it("hides both chips when the adapter reports the anchor unpainted (rectsFor → null)", async () => {
    const host = makeHost();
    const overlay = new MarkerOverlay(host, { adapter: { rectsFor: () => null } });
    overlay.setMarkers([{ anchorId: "a1", anchorSlotHtml: "<span></span>", noteSlotHtml: "<span></span>" }]);
    overlay.reposition();
    await flushFrame();
    expect((host.querySelector('[data-sv-slot="anchor"]') as HTMLElement).style.display).toBe("none");
    expect((host.querySelector('[data-sv-slot="note"]') as HTMLElement).style.display).toBe("none");
    overlay.destroy();
  });

  it("default (adapter-less) path measures FIRST and LAST of several elements sharing the key", async () => {
    const host = makeHost();
    // A multi-span anchor (the PDF text-layer shape): both spans carry a1's key.
    stubAnchor(host, "a1", { left: 200, top: 120, right: 260, width: 60, height: 18 });
    stubAnchor(host, "a1", { left: 150, top: 160, right: 400, width: 250, height: 18 });
    const overlay = new MarkerOverlay(host);
    overlay.setMarkers([{ anchorId: "a1", anchorSlotHtml: "<span></span>", noteSlotHtml: "<span></span>" }]);
    stubOverlayRect(host);
    overlay.reposition();
    await flushFrame();
    const anchorChip = host.querySelector('[data-sv-slot="anchor"]') as HTMLElement;
    const noteChip = host.querySelector('[data-sv-slot="note"]') as HTMLElement;
    // First span's left edge / last span's right edge.
    expect(anchorChip.style.left).toBe("100px");
    expect(anchorChip.style.top).toBe("70px");
    expect(noteChip.style.left).toBe("300px");
    expect(noteChip.style.top).toBe("110px");
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
    overlay.setMarkers([{ anchorId: "a1", anchorSlotHtml: "<span></span>", noteSlotHtml: "<span></span>" }]);
    stubOverlayRect(host);
    overlay.reposition();
    await flushFrame();

    // The realm re-laid-out (e.g. PDF zoom): the adapter's signal must reposition.
    current = rect(300, 220, 380);
    for (const cb of listeners) cb();
    await flushFrame();
    const noteChip = host.querySelector('[data-sv-slot="note"]') as HTMLElement;
    expect(noteChip.style.left).toBe("280px"); // 380 - 100
    expect(noteChip.style.top).toBe("170px"); // 220 - 50

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
    overlay.setMarkers([{ anchorId: "a1", anchorSlotHtml: "<span></span>", noteSlotHtml: "<span></span>" }]);
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
