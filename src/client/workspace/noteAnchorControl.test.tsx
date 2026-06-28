// @vitest-environment jsdom
// Unit coverage for NoteAnchorControl (Multi-anchor note UX V1, Stage 2): the
// note-card "anchored at N places" indicator + per-anchor jump buttons. A
// single-anchor note shows only the link button (unchanged); a multi-anchor note
// surfaces the count + one jump button per anchor, each resolving its anchor record
// from ctx.anchors and calling focus.setAnchor (mirrors the bookmark jump guard).
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { AnyAnchor, NoteRecord } from "../data/entityClient";
import type { WorkspaceContext } from "./viewRegistry";
import { NoteAnchorControl } from "./noteAnchorControl";

function anchor(id: string, quote: string): AnyAnchor {
  return {
    id,
    sourceId: "src_1",
    anchorKind: "html_selection",
    studyId: id,
    selector: `[data-study-id="${id}"]`,
    quote
  } as unknown as AnyAnchor;
}

function note(id: string, anchorIds: string[]): NoteRecord {
  return { id, anchorIds, contentType: "markdown", content: "a note", layerIds: [] } as unknown as NoteRecord;
}

function focusWith(over: Partial<WorkspaceContext["focus"]> = {}): WorkspaceContext["focus"] {
  return { setAnchor: vi.fn(), draft: undefined, anchor: undefined, ...over } as unknown as WorkspaceContext["focus"];
}

function render(el: React.ReactElement): { container: HTMLElement; cleanup: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(el));
  return { container, cleanup: () => { act(() => root.unmount()); container.remove(); } };
}

describe("NoteAnchorControl (anchored-at-N indicator + jump)", () => {
  it("single-anchor note shows only the link button — no count, no jumps", () => {
    const { container, cleanup } = render(
      <NoteAnchorControl note={note("n1", ["a1"])} anchors={[anchor("a1", "first")]} focus={focusWith()} onLink={() => {}} />
    );
    expect(container.querySelector(".note-anchor-link")).toBeTruthy();
    expect(container.querySelector(".note-anchor-count")).toBeNull();
    expect(container.querySelectorAll(".note-anchor-jump").length).toBe(0);
    cleanup();
  });

  it("multi-anchor note shows the count and one jump button per anchor", () => {
    const { container, cleanup } = render(
      <NoteAnchorControl
        note={note("n1", ["a1", "a2"])}
        anchors={[anchor("a1", "first"), anchor("a2", "second")]}
        focus={focusWith()}
        onLink={() => {}}
      />
    );
    expect(container.querySelector(".note-anchor-count")?.textContent).toContain("Anchored at 2 places");
    expect(container.querySelectorAll(".note-anchor-jump").length).toBe(2);
    cleanup();
  });

  it("multi-anchor note with 3+ anchors shows the full count and one jump per anchor", () => {
    const { container, cleanup } = render(
      <NoteAnchorControl
        note={note("n1", ["a1", "a2", "a3", "a4"])}
        anchors={[anchor("a1", "first"), anchor("a2", "second"), anchor("a3", "third"), anchor("a4", "fourth")]}
        focus={focusWith()}
        onLink={() => {}}
      />
    );
    expect(container.querySelector(".note-anchor-count")?.textContent).toContain("Anchored at 4 places");
    expect(container.querySelectorAll(".note-anchor-jump").length).toBe(4);
    cleanup();
  });

  it("clicking a jump button focuses that anchor's record", () => {
    const setAnchor = vi.fn();
    const a2 = anchor("a2", "second");
    const { container, cleanup } = render(
      <NoteAnchorControl
        note={note("n1", ["a1", "a2"])}
        anchors={[anchor("a1", "first"), a2]}
        focus={focusWith({ setAnchor })}
        onLink={() => {}}
      />
    );
    const jumps = container.querySelectorAll<HTMLButtonElement>(".note-anchor-jump");
    act(() => jumps[1].click());
    expect(setAnchor).toHaveBeenCalledWith(a2);
    cleanup();
  });

  it("disables a jump whose anchor is filtered out of the visible set (no setAnchor)", () => {
    const setAnchor = vi.fn();
    const { container, cleanup } = render(
      <NoteAnchorControl
        note={note("n1", ["a1", "a_hidden"])}
        anchors={[anchor("a1", "first")]}
        focus={focusWith({ setAnchor })}
        onLink={() => {}}
      />
    );
    const jumps = container.querySelectorAll<HTMLButtonElement>(".note-anchor-jump");
    expect(jumps[1].disabled).toBe(true);
    act(() => jumps[1].click());
    expect(setAnchor).not.toHaveBeenCalled();
    cleanup();
  });

  it("link button is disabled without a focused passage and enabled with a draft", () => {
    const onLink = vi.fn();
    const off = render(
      <NoteAnchorControl note={note("n1", ["a1"])} anchors={[anchor("a1", "first")]} focus={focusWith()} onLink={onLink} />
    );
    expect((off.container.querySelector(".note-anchor-link") as HTMLButtonElement).disabled).toBe(true);
    off.cleanup();

    const on = render(
      <NoteAnchorControl
        note={note("n1", ["a1"])}
        anchors={[anchor("a1", "first")]}
        focus={focusWith({ draft: {} as never })}
        onLink={onLink}
      />
    );
    const link = on.container.querySelector(".note-anchor-link") as HTMLButtonElement;
    expect(link.disabled).toBe(false);
    act(() => link.click());
    expect(onLink).toHaveBeenCalled();
    on.cleanup();
  });
});
