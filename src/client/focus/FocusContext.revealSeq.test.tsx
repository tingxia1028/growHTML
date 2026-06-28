// @vitest-environment jsdom
// Reveal-nonce coverage for FocusProvider (the jump-to-anchor fix): focusing an
// anchor bumps `revealSeq` EVERY time — even re-selecting the SAME anchor (a
// bookmark row / a multi-anchor jump button) — so the readers' reveal effect, keyed
// on [activeAnchorId, revealSeq], re-fires and re-scrolls. Selecting a draft or
// clearing must NOT bump it (no passage to scroll to).
import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { FocusProvider, useFocus, type AnchorDraft, type FocusContextValue } from "./FocusContext";
import type { AnyAnchor } from "../data/entityClient";

const anchorA: AnyAnchor = {
  id: "a1",
  sourceId: "src_1",
  anchorKind: "html_selection",
  studyId: "p1",
  selector: '[data-study-id="p1"]',
  quote: "first"
} as unknown as AnyAnchor;

const draft: AnchorDraft = { mode: "quote", sourceId: "src_1", kind: "html", quote: "draft" };

// Render the provider with a consumer that publishes the live context value so the
// test can call setAnchor/setDraft/clear and read revealSeq back.
function mount(): { ctx: () => FocusContextValue; cleanup: () => void } {
  let latest: FocusContextValue | null = null;
  function Consumer() {
    latest = useFocus();
    return null;
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <FocusProvider>
        <Consumer />
      </FocusProvider>
    )
  );
  return {
    ctx: () => latest!,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    }
  };
}

describe("FocusProvider revealSeq", () => {
  it("starts at 0", () => {
    const { ctx, cleanup } = mount();
    expect(ctx().revealSeq).toBe(0);
    cleanup();
  });

  it("bumps on setAnchor(non-null)", () => {
    const { ctx, cleanup } = mount();
    act(() => ctx().setAnchor(anchorA));
    expect(ctx().revealSeq).toBe(1);
    expect(ctx().anchor?.id).toBe("a1");
    cleanup();
  });

  it("bumps again when re-selecting the SAME anchor (the re-click case)", () => {
    const { ctx, cleanup } = mount();
    act(() => ctx().setAnchor(anchorA));
    act(() => ctx().setAnchor(anchorA));
    expect(ctx().revealSeq).toBe(2);
    cleanup();
  });

  it("does NOT bump on setAnchor(null), setDraft, or clear", () => {
    const { ctx, cleanup } = mount();
    act(() => ctx().setAnchor(anchorA)); // → 1
    act(() => ctx().setAnchor(null));
    act(() => ctx().setDraft(draft));
    act(() => ctx().clear());
    expect(ctx().revealSeq).toBe(1);
    cleanup();
  });
});
