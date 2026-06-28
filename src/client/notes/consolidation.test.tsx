// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { getNoteType, listNoteTypes } from "./noteTypeRegistry";

// contentType consolidation (§2.5) backward-compat. plain-text is folded into markdown
// and the static mindmap is dropped in favor of markmap — both REMOVED from the
// composer's NEW-note picker, but EXISTING notes of those types must still OPEN
// (render) without crashing. This is the "old type still renders" guard the plan
// requires the consolidation PR to carry.

vi.mock("../DiagramNote", () => ({
  DiagramNote: ({ contentType, content }: { contentType: string; content: string }) => (
    <div className="mock-diagram" data-content-type={contentType}>
      {content}
    </div>
  )
}));

import "./builtinNoteTypes";

function renderToHtml(node: React.ReactNode): string {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(node as React.ReactElement));
  const html = container.innerHTML;
  act(() => root.unmount());
  return html;
}

describe("consolidation §2.5 — plain-text & static mindmap dropped from the picker", () => {
  it("plain-text and mindmap are HIDDEN from the composer's type picker", () => {
    const visible = listNoteTypes()
      .filter((p) => !p.hidden)
      .map((p) => p.contentType);
    expect(visible).not.toContain("plain-text");
    expect(visible).not.toContain("mindmap");
    // The survivors people author into are still offered.
    expect(visible).toContain("markdown");
    expect(visible).toContain("markmap");
  });

  it("their plugins are STILL registered (so stored notes resolve a renderer)", () => {
    expect(getNoteType("plain-text")).toBeTruthy();
    expect(getNoteType("mindmap")).toBeTruthy();
  });
});

describe("consolidation §2.5 — existing notes of the dropped types still render", () => {
  it("an old plain-text note renders as inert escaped text (no crash)", () => {
    const html = renderToHtml(
      getNoteType("plain-text")!.render({ content: "old plain note **literal**" })
    );
    expect(html).toContain("sv-plain");
    expect(html).toContain("old plain note **literal**"); // not interpreted as markdown
  });

  it("an old mindmap note renders the static nested tree (no crash)", () => {
    const content = { title: "Root", children: [{ title: "Child A" }, { title: "Child B" }] };
    const html = renderToHtml(getNoteType("mindmap")!.render({ content }));
    expect(html).toContain("sv-mindmap");
    expect(html).toContain("Root");
    expect(html).toContain("Child A");
  });

  it("a mis-shaped old note of a dropped type does not throw (inert fallback)", () => {
    expect(() => renderToHtml(getNoteType("plain-text")!.render({ content: 123 }))).not.toThrow();
    expect(() => renderToHtml(getNoteType("mindmap")!.render({ content: "not json" }))).not.toThrow();
  });
});
