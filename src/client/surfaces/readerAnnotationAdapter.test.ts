// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  collectAnchorRects,
  createDomRealmAdapter,
  injectCssIntoRealm,
  observeDomLayout,
  type AdapterRect
} from "./readerAnnotationAdapter";
import { ANNOTATION_STYLE_ID } from "../annotationLayer";

type RectStub = { left: number; top: number; right: number; width: number; height: number };

function stubRect(el: Element, rect: RectStub): void {
  Object.defineProperty(el, "getBoundingClientRect", {
    value: () => ({ ...rect, bottom: rect.top + rect.height }),
    configurable: true
  });
}

// A multi-element anchor host: several spans stamped with the SAME data-sv-key —
// the PDF text-layer shape (highlightAnchors stamps every matched span).
function makeMultiSpanHost(): { host: HTMLElement; rects: RectStub[] } {
  const host = document.createElement("div");
  const rects: RectStub[] = [
    { left: 100, top: 50, right: 300, width: 200, height: 16 },
    { left: 80, top: 70, right: 320, width: 240, height: 16 },
    { left: 80, top: 90, right: 180, width: 100, height: 16 }
  ];
  for (const rect of rects) {
    const span = document.createElement("span");
    span.setAttribute("data-sv-key", "a1");
    stubRect(span, rect);
    host.appendChild(span);
  }
  // An unrelated anchor must not leak into a1's rects.
  const other = document.createElement("span");
  other.setAttribute("data-sv-key", "a2");
  stubRect(other, { left: 0, top: 0, right: 10, width: 10, height: 10 });
  host.appendChild(other);
  document.body.appendChild(host);
  return { host, rects };
}

function asAdapterRect(rect: RectStub): AdapterRect {
  return { ...rect, bottom: rect.top + rect.height };
}

describe("collectAnchorRects (D1 rectsFor semantics)", () => {
  it("returns first/last/all over EVERY element carrying the anchor's data-sv-key", () => {
    const { host, rects } = makeMultiSpanHost();
    const result = collectAnchorRects(host, "a1");
    expect(result).not.toBeNull();
    expect(result!.all).toHaveLength(3);
    // first = the FIRST span's rect, last = the LAST span's rect (document order) —
    // not just the single querySelector hit the old overlay measured.
    expect(result!.first).toEqual(asAdapterRect(rects[0]));
    expect(result!.last).toEqual(asAdapterRect(rects[2]));
    expect(result!.all).toEqual(rects.map(asAdapterRect));
    host.remove();
  });

  it("first === last for a single-element anchor (image region / DOM mark)", () => {
    const host = document.createElement("div");
    const box = document.createElement("div");
    box.setAttribute("data-sv-key", "region-1");
    stubRect(box, { left: 10, top: 20, right: 110, width: 100, height: 60 });
    host.appendChild(box);
    const result = collectAnchorRects(host, "region-1");
    expect(result!.all).toHaveLength(1);
    expect(result!.first).toEqual(result!.last);
    expect(result!.first).toEqual({ left: 10, top: 20, right: 110, bottom: 80, width: 100, height: 60 });
  });

  it("returns null when the anchor has no painted element (virtualized out)", () => {
    const host = document.createElement("div");
    expect(collectAnchorRects(host, "missing")).toBeNull();
  });

  it("returns null for a missing root or empty id", () => {
    expect(collectAnchorRects(null, "a1")).toBeNull();
    expect(collectAnchorRects(undefined, "a1")).toBeNull();
    expect(collectAnchorRects(document, "")).toBeNull();
  });

  it("escapes double quotes in the anchor id (no selector injection)", () => {
    const host = document.createElement("div");
    const el = document.createElement("span");
    el.setAttribute("data-sv-key", 'we"ird');
    stubRect(el, { left: 1, top: 2, right: 3, width: 2, height: 4 });
    host.appendChild(el);
    expect(collectAnchorRects(host, 'we"ird')?.all).toHaveLength(1);
  });
});

describe("observeDomLayout", () => {
  it("fires on capture-phase scroll from any descendant and stops after unsubscribe", () => {
    const host = document.createElement("div");
    const child = document.createElement("div");
    host.appendChild(child);
    document.body.appendChild(host);
    const cb = vi.fn();
    const unsubscribe = observeDomLayout(host, cb);

    child.dispatchEvent(new Event("scroll"));
    expect(cb).toHaveBeenCalledTimes(1);

    unsubscribe();
    child.dispatchEvent(new Event("scroll"));
    expect(cb).toHaveBeenCalledTimes(1);
    host.remove();
  });
});

describe("injectCssIntoRealm", () => {
  it("injects once under the annotation style id and refreshes changed css", () => {
    const doc = document.implementation.createHTMLDocument("realm");
    injectCssIntoRealm(doc, ".a{}");
    injectCssIntoRealm(doc, ".a{}");
    expect(doc.querySelectorAll(`#${ANNOTATION_STYLE_ID}`)).toHaveLength(1);
    expect(doc.getElementById(ANNOTATION_STYLE_ID)?.textContent).toBe(".a{}");
    injectCssIntoRealm(doc, ".b{}");
    expect(doc.getElementById(ANNOTATION_STYLE_ID)?.textContent).toBe(".b{}");
  });
});

describe("createDomRealmAdapter", () => {
  it("implements the full D1 contract over a realm document", () => {
    // Use the live jsdom document (it has a defaultView, so revealAnchorInDoc's
    // flash class persists on its timer instead of clearing synchronously).
    const container = document.createElement("div");
    container.innerHTML = '<p><mark data-sv-key="a1">quoted passage</mark></p>';
    document.body.appendChild(container);
    stubRect(container.querySelector("mark")!, { left: 5, top: 6, right: 55, width: 50, height: 14 });

    const painted: unknown[] = [];
    const adapter = createDomRealmAdapter({
      root: () => document,
      paint: (anchors) => painted.push(anchors)
    });

    // rectsFor — the shared collector over the realm root.
    expect(adapter.rectsFor("a1")?.first.right).toBe(55);
    expect(adapter.rectsFor("nope")).toBeNull();

    // injectRealmCss — idempotent stylesheet injection into the realm document.
    adapter.injectRealmCss(".x{}");
    expect(document.getElementById(ANNOTATION_STYLE_ID)?.textContent).toBe(".x{}");

    // paint — delegates to the reader-provided painter.
    adapter.paint([{ id: "a1" } as never]);
    expect(painted).toHaveLength(1);

    // reveal — delegates to the shared revealAnchorInDoc (flash class applied).
    expect(adapter.reveal("a1")).toBe(true);
    expect(container.querySelector("mark")!.classList.contains("sv-active")).toBe(true);
    expect(adapter.reveal("nope")).toBe(false);
    container.remove();
    document.getElementById(ANNOTATION_STYLE_ID)?.remove();
  });

  it("uses the default DOM layout wiring and honors an onLayoutChange override", () => {
    const host = document.createElement("div");
    const child = document.createElement("div");
    host.appendChild(child);
    document.body.appendChild(host);
    const cb = vi.fn();
    const adapter = createDomRealmAdapter({ root: () => host, paint: () => {} });
    const unsubscribe = adapter.onLayoutChange(cb);
    // Scroll a DESCENDANT: only the capture-phase window listener sees it (the
    // host-element listener covers the host's own scrolls).
    child.dispatchEvent(new Event("scroll"));
    expect(cb).toHaveBeenCalledTimes(1);
    unsubscribe();
    child.dispatchEvent(new Event("scroll"));
    expect(cb).toHaveBeenCalledTimes(1);
    host.remove();

    const custom = vi.fn(() => () => {});
    const pdfLike = createDomRealmAdapter({ root: () => host, paint: () => {}, onLayoutChange: custom });
    pdfLike.onLayoutChange(() => {});
    expect(custom).toHaveBeenCalledTimes(1);
  });
});
