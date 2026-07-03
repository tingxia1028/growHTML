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

function pushAnchors(anchors: GuestAnchor[]): void {
  const handler = ipc.handlers.get("sv:anchors");
  expect(handler, "preload must register an sv:anchors handler").toBeDefined();
  handler!(null, anchors);
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
  it("paints the quote and hosts the marker chip in a body-mounted overlay, NOT inline in the mark", async () => {
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
    const chip = overlay!.querySelector('[data-sv-marker-for="w1"]');
    expect(chip).not.toBeNull();
    // Same glyph contract as every other reader: role-marked anchor + note buttons.
    const roles = Array.from(chip!.querySelectorAll("[data-sv-marker-role]")).map((el) =>
      el.getAttribute("data-sv-marker-role")
    );
    expect(roles).toEqual(["anchor", "note"]);
  });

  it("bridges an anchor-marker click to the host over sv:marker-action", async () => {
    pushAnchors([ANCHOR]);
    await flushFrame();

    const button = document.querySelector(
      '.sv-marker-overlay [data-sv-marker-for="w1"] [data-sv-marker-role="anchor"]'
    ) as HTMLElement;
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(ipc.sendToHost).toHaveBeenCalledWith("sv:marker-action", { anchorId: "w1", role: "anchor" });
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
    expect(document.querySelectorAll(".sv-anchor-markers")).toHaveLength(1);

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
