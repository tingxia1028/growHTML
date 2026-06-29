// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

// Phase 1b — the shared "card → centered interactive overlay" capability. Covers:
//   • mode routing — getNoteType().render receives mode:"card" (light) vs "full".
//   • ArtifactCard click → opens the FocusOverlay; Esc / backdrop close it.
//   • the diagram plugin's "card" mode renders a LIGHT preview (no live diagram).
//
// DiagramNote is stubbed so the heavy mermaid/markmap libs never load in jsdom; we
// assert the FULL render DELEGATES to it (mounted only inside the overlay) and the
// CARD render does NOT mount it.
vi.mock("../DiagramNote", () => ({
  DiagramNote: ({ contentType, content }: { contentType: string; content: string }) => (
    <div className="mock-diagram" data-content-type={contentType}>
      {content}
    </div>
  )
}));

import "../notes/builtinNoteTypes";
import { ArtifactCard } from "./ArtifactCard";
import { FocusOverlay } from "./FocusOverlay";
import { ChatMessageBody } from "./ChatMessageBody";
import { getNoteType } from "../notes/noteTypeRegistry";

function mount(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node as React.ReactElement));
  return {
    container,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    }
  };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("mode routing on the render contract", () => {
  it("markmap render('card') is a LIGHT preview (no live DiagramNote), render('full') mounts it", () => {
    const plugin = getNoteType("markmap")!;
    const card = mount(<>{plugin.render({ content: "# Root\n## Child", mode: "card" })}</>);
    expect(card.container.querySelector(".sv-diagram-card")).toBeTruthy();
    expect(card.container.querySelector(".mock-diagram")).toBeNull(); // not mounted in a card
    card.cleanup();

    const full = mount(<>{plugin.render({ content: "# Root\n## Child", mode: "full" })}</>);
    expect(full.container.querySelector(".mock-diagram")).toBeTruthy(); // mounted in full
    full.cleanup();
  });

  it("a plugin that ignores mode (markdown) still renders for a card", () => {
    const plugin = getNoteType("markdown")!;
    const { container, cleanup } = mount(<>{plugin.render({ content: "# Hi", mode: "card" })}</>);
    expect(container.querySelector(".note-rendered")).toBeTruthy();
    cleanup();
  });
});

describe("ArtifactCard — click opens the centered overlay", () => {
  it("renders a compact card with a form badge + title and NO overlay until clicked", () => {
    const { container, cleanup } = mount(
      <ArtifactCard block={{ contentType: "mermaid", content: "flowchart LR; A-->B" }} />
    );
    const card = container.querySelector(".sv-artifact-card") as HTMLButtonElement;
    expect(card).toBeTruthy();
    expect(container.querySelector(".sv-artifact-badge")?.textContent).toBe("mermaid");
    // The light card preview, not a live diagram, is in the thumbnail.
    expect(container.querySelector(".sv-diagram-card")).toBeTruthy();
    expect(container.querySelector(".mock-diagram")).toBeNull();
    // No overlay yet.
    expect(document.querySelector(".sv-focus-overlay")).toBeNull();
    cleanup();
  });

  it("clicking the card opens a FocusOverlay that mounts the FULL interactive render", () => {
    const { container, cleanup } = mount(
      <ArtifactCard block={{ contentType: "mermaid", content: "flowchart LR; A-->B" }} />
    );
    const card = container.querySelector(".sv-artifact-card") as HTMLButtonElement;
    act(() => card.click());
    const overlay = document.querySelector(".sv-focus-overlay");
    expect(overlay).toBeTruthy();
    // The overlay renders the FULL view = the live (mocked) diagram.
    expect(overlay!.querySelector(".mock-diagram")).toBeTruthy();
    expect(overlay!.querySelector('[role="dialog"][aria-modal="true"]')).toBeTruthy();
    cleanup();
  });
});

describe("FocusOverlay — accessibility + close affordances", () => {
  it("Esc closes; the close button closes; a backdrop click closes", () => {
    let closed = 0;
    const onClose = () => {
      closed += 1;
    };
    const { cleanup } = mount(
      <FocusOverlay block={{ contentType: "markdown", content: "hello" }} onClose={onClose} />
    );
    const dialog = document.querySelector(".sv-focus-dialog") as HTMLElement;
    // Esc.
    act(() => dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(closed).toBe(1);
    // Close button.
    const closeBtn = document.querySelector(".sv-focus-close") as HTMLButtonElement;
    act(() => closeBtn.click());
    expect(closed).toBe(2);
    // Backdrop (mousedown on the overlay itself, not the dialog).
    const overlay = document.querySelector(".sv-focus-overlay") as HTMLElement;
    act(() => {
      const ev = new MouseEvent("mousedown", { bubbles: true });
      Object.defineProperty(ev, "target", { value: overlay });
      Object.defineProperty(ev, "currentTarget", { value: overlay });
      overlay.dispatchEvent(ev);
    });
    expect(closed).toBe(3);
    cleanup();
  });

  it("renders an unknown contentType as an inert fallback (never crashes)", () => {
    const { cleanup } = mount(
      <FocusOverlay block={{ contentType: "not-a-real-type", content: "x" }} onClose={() => {}} />
    );
    expect(document.querySelector(".sv-focus-body .sv-plain")).toBeTruthy();
    cleanup();
  });
});

describe("chat thread wiring — rich reply → card, plain → markdown", () => {
  it("a HIGH-confidence rich assistant reply (mermaid) renders an ArtifactCard", () => {
    const { container, cleanup } = mount(
      <ChatMessageBody role="assistant" content={"flowchart LR; A --> B"} />
    );
    expect(container.querySelector(".sv-artifact-card")).toBeTruthy();
    expect(container.querySelector(".sv-artifact-badge")?.textContent).toBe("mermaid");
    cleanup();
  });

  it("a LOW-confidence (plain prose) assistant reply renders inline markdown, NOT a card", () => {
    const { container, cleanup } = mount(
      <ChatMessageBody role="assistant" content={"just a normal sentence reply"} />
    );
    expect(container.querySelector(".sv-artifact-card")).toBeNull();
    expect(container.querySelector(".note-rendered")).toBeTruthy();
    cleanup();
  });

  it("a USER message is never carded (it renders as markdown text)", () => {
    const { container, cleanup } = mount(
      <ChatMessageBody role="user" content={"flowchart LR; A --> B"} />
    );
    expect(container.querySelector(".sv-artifact-card")).toBeNull();
    expect(container.querySelector(".note-rendered")).toBeTruthy();
    cleanup();
  });
});
