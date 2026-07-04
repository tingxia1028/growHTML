// @vitest-environment jsdom
//
// Guest-realm D1 alignment (F3): the webview preload must host a REAL MarkerOverlay
// on the guest body — not the old divergent inline chip appended inside the <mark> —
// and bridge marker clicks to the host over the existing sv:marker-action channel.
// The preload imports electron's ipcRenderer, so the module is loaded against a
// mocked ipcRenderer whose registered channel handlers we drive directly (the same
// fake-IPC idiom as webviewSelection.test.ts, from the guest side).
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const ipc = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => void>();
  const sendToHost = vi.fn();
  return { handlers, sendToHost };
});

vi.mock("electron", () => ({
  ipcRenderer: {
    on: (channel: string, handler: (event: unknown, ...args: unknown[]) => void) => {
      ipc.handlers.set(channel, handler);
    },
    sendToHost: (...args: unknown[]) => ipc.sendToHost(...args)
  }
}));

type GuestAnchor = {
  id: string;
  quote: string;
  contextBefore: string;
  contextAfter: string;
  note?: string;
  noteHtml?: string;
  noteCount?: number;
  noteTypes?: string[];
};

function pushAnchors(anchors: GuestAnchor[], prefs?: { anchorGlyphsVisible?: boolean }): void {
  const handler = ipc.handlers.get("sv:anchors");
  expect(handler, "preload must register an sv:anchors handler").toBeDefined();
  handler!(null, anchors, prefs);
}

const ANCHOR: GuestAnchor = {
  id: "w1",
  quote: "bravo",
  contextBefore: "alpha ",
  contextAfter: " charlie",
  note: "guest note",
  noteHtml: "<div>Card body</div>",
  noteCount: 1,
  noteTypes: ["markdown"]
};

// jsdom lacks rAF by default in this path; flush one frame if it exists so the
// overlay's rAF-throttled layout has run before assertions.
function flushFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
    else resolve();
  });
}

beforeAll(async () => {
  await import("./webview-preload");
});

beforeEach(() => {
  ipc.sendToHost.mockClear();
  // Fresh passage per test; the overlay + note card survive (module-level state),
  // and each repaint re-resolves the quote in the fresh paragraph.
  document.querySelectorAll("p").forEach((p) => p.remove());
  const p = document.createElement("p");
  p.textContent = "alpha bravo charlie";
  document.body.appendChild(p);
});

describe("webview guest annotation surface (D1)", () => {
  it("paints the quote and hosts the D2 two-slot chips in a body-mounted overlay, NOT inline in the mark", async () => {
    pushAnchors([ANCHOR]);
    await flushFrame();

    const mark = document.querySelector('mark[data-sv="1"][data-sv-key="w1"]');
    expect(mark).not.toBeNull();
    // The old divergent inline chip is gone: nothing marker-ish inside the mark.
    expect(mark!.querySelector(".sv-anchor-markers")).toBeNull();

    // A real MarkerOverlay hangs off the guest body (positioning context forced).
    const overlay = document.body.querySelector(":scope > .sv-marker-overlay");
    expect(overlay).not.toBeNull();
    expect(document.body.style.position).toBe("relative");
    // Same slot contract as every other reader: the anchor-glyph chip (left slot)
    // and the note-type chip (right slot) are SEPARATE chips for one anchor.
    const anchorChip = overlay!.querySelector('[data-sv-marker-for="w1"][data-sv-slot="anchor"]');
    const noteChip = overlay!.querySelector('[data-sv-marker-for="w1"][data-sv-slot="note"]');
    expect(anchorChip).not.toBeNull();
    expect(noteChip).not.toBeNull();
    expect(anchorChip!.querySelector('[data-sv-marker-role="anchor"]')).not.toBeNull();
    expect(noteChip!.querySelector('[data-sv-marker-role="note"]')).not.toBeNull();
  });

  it("bridges an anchor-marker click to the host over sv:marker-action", async () => {
    pushAnchors([ANCHOR]);
    await flushFrame();

    const button = document.querySelector(
      '.sv-marker-overlay [data-sv-marker-for="w1"] [data-sv-marker-role="anchor"]'
    ) as HTMLElement;
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(ipc.sendToHost).toHaveBeenCalledWith("sv:marker-action", { anchorId: "w1", role: "anchor" });
    // The click also toggled w1's notes hidden (guest-local session state) — click
    // again so the toggle doesn't leak into the other tests.
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });

  it("anchor-chip click TOGGLES the anchor's notes IN the guest realm (note chip + card), second click restores", async () => {
    pushAnchors([ANCHOR]);
    await flushFrame();

    const anchorButton = document.querySelector(
      '.sv-marker-overlay [data-sv-marker-for="w1"][data-sv-slot="anchor"] [data-sv-marker-role="anchor"]'
    ) as HTMLElement;
    const noteChip = document.querySelector(
      '.sv-marker-overlay [data-sv-marker-for="w1"][data-sv-slot="note"]'
    ) as HTMLElement;
    const mark = document.querySelector('mark[data-sv-key="w1"]') as HTMLElement;
    const card = document.getElementById("sv-note-card")!;

    // Toggle OFF: the note-slot chip hides and the card is suppressed in-guest.
    anchorButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await flushFrame();
    expect(noteChip.style.display).toBe("none");
    mark.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(card.classList.contains("sv-note-card-show")).toBe(false);
    mark.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(card.classList.contains("sv-note-card-show")).toBe(false);

    // Toggle ON: the note chip returns and the card hovers again.
    anchorButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await flushFrame();
    expect(noteChip.style.display).not.toBe("none");
    mark.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(card.classList.contains("sv-note-card-show")).toBe(true);
    // Dismiss (outside click) so the card doesn't leak into other tests.
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  it("mirrors the host's 显示锚点标记 switch from the additive sv:anchors prefs payload", async () => {
    pushAnchors([ANCHOR], { anchorGlyphsVisible: false });
    await flushFrame();

    const anchorChip = document.querySelector(
      '.sv-marker-overlay [data-sv-marker-for="w1"][data-sv-slot="anchor"]'
    ) as HTMLElement;
    const noteChip = document.querySelector(
      '.sv-marker-overlay [data-sv-marker-for="w1"][data-sv-slot="note"]'
    ) as HTMLElement;
    // The global switch hides the anchor glyph chip; the note slot STAYS.
    expect(anchorChip.style.display).toBe("none");
    expect(noteChip.style.display).not.toBe("none");

    // Flipping back on over the same channel restores the glyph chips.
    pushAnchors([ANCHOR], { anchorGlyphsVisible: true });
    await flushFrame();
    const restored = document.querySelector(
      '.sv-marker-overlay [data-sv-marker-for="w1"][data-sv-slot="anchor"]'
    ) as HTMLElement;
    expect(restored.style.display).not.toBe("none");
  });

  it("a prefs-less sv:anchors push (older host) leaves the glyph visibility unchanged", async () => {
    pushAnchors([ANCHOR], { anchorGlyphsVisible: false });
    await flushFrame();
    pushAnchors([ANCHOR]); // no prefs — must NOT reset to visible
    await flushFrame();
    const anchorChip = document.querySelector(
      '.sv-marker-overlay [data-sv-marker-for="w1"][data-sv-slot="anchor"]'
    ) as HTMLElement;
    expect(anchorChip.style.display).toBe("none");
    // Restore the module-level default for the remaining tests.
    pushAnchors([ANCHOR], { anchorGlyphsVisible: true });
    await flushFrame();
  });

  it("note-marker click bridges sv:marker-action AND opens the shared in-guest note card", async () => {
    pushAnchors([ANCHOR]);
    await flushFrame();

    const button = document.querySelector(
      '.sv-marker-overlay [data-sv-marker-for="w1"] [data-sv-marker-role="note"]'
    ) as HTMLElement;
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(ipc.sendToHost).toHaveBeenCalledWith("sv:marker-action", { anchorId: "w1", role: "note" });
    // MarkerOverlay synthesized the anchor click → the shared #sv-note-card pinned.
    const card = document.getElementById("sv-note-card");
    expect(card).not.toBeNull();
    expect(card!.classList.contains("sv-note-card-show")).toBe(true);
    expect(card!.querySelector(".sv-note-card-body")!.innerHTML).toContain("Card body");
    // Dismiss (outside click) so the card doesn't leak into other tests.
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  it("a repaint with no anchors clears the overlay chips (single overlay reused)", async () => {
    pushAnchors([ANCHOR]);
    await flushFrame();
    // Two slot chips for the one anchor (anchor glyph + note types).
    expect(document.querySelectorAll(".sv-anchor-markers")).toHaveLength(2);

    pushAnchors([]);
    await flushFrame();
    expect(document.querySelectorAll(".sv-anchor-markers")).toHaveLength(0);
    expect(document.querySelectorAll(".sv-marker-overlay")).toHaveLength(1);
  });

  it("sv:reveal delegates to the shared reveal (flash class on the painted mark)", async () => {
    pushAnchors([ANCHOR]);
    await flushFrame();
    ipc.handlers.get("sv:reveal")!(null, "w1");
    const mark = document.querySelector('[data-sv-key="w1"]')!;
    expect(mark.classList.contains("sv-active")).toBe(true);
  });
});
