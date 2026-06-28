// @vitest-environment jsdom
// Reveal coverage for DomReader (the reported jump-to-anchor bug): when the host
// sets activeAnchorId / bumps revealSeq, the reader scrolls the matching painted
// data-sv-key element into view. Prop-driven — rendered WITHOUT a FocusProvider —
// proving readers stay unit-testable without useFocus.
import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DomReader } from "./DomReader";
import { applyHighlight } from "../annotationLayer";
import type { PaintAnchor } from "./types";

// React needs this flag to flush effects inside act() under vitest.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const anchors: PaintAnchor[] = [
  { id: "a1", anchorKind: "html_selection", studyId: "s1", quote: "Hello world", note: "n" }
];

function renderDom(root: Root, props: Partial<{ activeAnchorId: string; revealSeq: number }>) {
  act(() =>
    root.render(
      <DomReader
        srcDoc="<p data-study-id='s1'>Hello world</p>"
        sourceId="src_1"
        anchors={anchors}
        onSelect={() => {}}
        {...props}
      />
    )
  );
}

describe("DomReader reveal", () => {
  it("scrolls the focused anchor element into view on [activeAnchorId, revealSeq] change", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    renderDom(root, {});

    // jsdom doesn't parse srcDoc into the iframe; paint the target element (carrying
    // data-sv-key) into the contentDocument ourselves, as the reader's paint would.
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    const doc = iframe.contentDocument!;
    doc.body.innerHTML = "<p data-study-id='s1'>Hello world</p>";
    const el = doc.querySelector("[data-study-id='s1']") as HTMLElement;
    applyHighlight(el, "n", "a1");
    let calls = 0;
    el.scrollIntoView = () => {
      calls += 1;
    };

    // Focus the anchor → the reveal effect scrolls it into view + flashes it.
    renderDom(root, { activeAnchorId: "a1", revealSeq: 1 });
    expect(el.classList.contains("sv-active")).toBe(true);
    expect(calls).toBe(1);

    // Re-clicking the SAME anchor (revealSeq bumps) re-fires the scroll.
    renderDom(root, { activeAnchorId: "a1", revealSeq: 2 });
    expect(calls).toBe(2);

    act(() => root.unmount());
    container.remove();
  });
});
