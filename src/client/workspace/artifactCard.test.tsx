// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

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
// Importing the card also registers the built-in Table viewer (side-effect import in
// ArtifactCard.tsx) — the exclusive-viewer path the card resolves through at runtime.
import { ArtifactCard } from "./ArtifactCard";
import { FocusOverlay } from "./FocusOverlay";
import { ChatMessageBody } from "./ChatMessageBody";
import { getNoteType } from "../notes/noteTypeRegistry";
import { getViewer } from "../notes/viewerRegistry";
import { TABLE_VIEWER_ID } from "../notes/tableViewer";

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
  // SPEECH-1b: ChatMessageBody (assistant bubbles) and the FocusOverlay header now
  // mount a SpeakButton whose shared status probe fetches /api/speech/status — stub
  // fetch to reject so the probe deterministically resolves "unavailable" (the 朗读
  // button renders disabled; its speaking behavior is covered in the speech suites).
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("no network in test")))
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
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
    expect(container.querySelector(".sv-artifact-badge")?.textContent).toBe("Mermaid / Mindmap");
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

describe("ArtifactCard — exclusive viewer resolution on the card body", () => {
  it("registers the built-in Table viewer at runtime (side-effect import)", () => {
    expect(getViewer(TABLE_VIEWER_ID)).toBeTruthy();
  });

  it("a markdown note whose content IS a GFM pipe table renders via the Table viewer", () => {
    const { container, cleanup } = mount(
      <ArtifactCard
        block={{ contentType: "markdown", content: "| Name | Age |\n| --- | --- |\n| Ada | 36 |" }}
      />
    );
    // The Table viewer won resolution → an HTML <table> in the card body.
    const body = container.querySelector(".sv-card-body");
    expect(body?.querySelector("table.note-table-viewer")).toBeTruthy();
    // The header + a body cell made it through.
    expect(container.querySelector("table.note-table-viewer th")?.textContent).toBe("Name");
    expect(container.textContent).toContain("Ada");
    cleanup();
  });

  it("a NON-table markdown note still renders via the markdown NoteType (no table)", () => {
    const { container, cleanup } = mount(
      <ArtifactCard block={{ contentType: "markdown", content: "# Just a heading\n\nsome prose" }} />
    );
    // No viewer matched → fell back to getNoteType("markdown").render (the .note-rendered body).
    expect(container.querySelector("table.note-table-viewer")).toBeNull();
    expect(container.querySelector(".sv-card-body .note-rendered")).toBeTruthy();
    cleanup();
  });

  it("renders standalone (no WorkspaceProvider) without throwing", () => {
    expect(() =>
      mount(
        <ArtifactCard block={{ contentType: "markdown", content: "| a | b |\n| --- | --- |\n| 1 | 2 |" }} />
      ).cleanup()
    ).not.toThrow();
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

  it("keeps the expanded note view narrower than the reader page instead of a long strip", () => {
    const cssPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../styles.css");
    const css = readFileSync(cssPath, "utf8").replace(/\r\n/g, "\n");
    const dialogRule = css.slice(css.indexOf(".sv-focus-dialog.sv-center-dialog"), css.indexOf(".sv-focus-head.sv-center-head"));
    const bodyRule = css.slice(css.indexOf(".sv-center-body .note-rendered"), css.indexOf(".sv-center-body .note-rendered h1"));

    expect(dialogRule).toContain("width: min(760px");
    expect(bodyRule).toContain("width: min(720px, 100%)");
    expect(bodyRule).toContain("margin: 0 auto");
  });
});

describe("chat thread wiring — rich reply → card, plain → markdown", () => {
  it("a HIGH-confidence rich assistant reply (mermaid) renders an ArtifactCard", () => {
    const { container, cleanup } = mount(
      <ChatMessageBody role="assistant" content={"flowchart LR; A --> B"} />
    );
    expect(container.querySelector(".sv-artifact-card")).toBeTruthy();
    expect(container.querySelector(".sv-artifact-badge")?.textContent).toBe("Mermaid / Mindmap");
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
    // …and never carries the 朗读 control (SPEECH-1b reads AI answers, not prompts).
    expect(container.querySelector(".speak-btn")).toBeNull();
    cleanup();
  });
});

describe("chat reply actions — §10 Add as note / Regenerate", () => {
  it("renders the action row with handlers and fires Add as note with the reply content", () => {
    let added: string | null = null;
    const { container, cleanup } = mount(
      <ChatMessageBody
        role="assistant"
        content={"<!doctype html><html><body><canvas></canvas><script>requestAnimationFrame(()=>{})</script></body></html>"}
        onAddNote={(content) => {
          added = content;
        }}
      />
    );
    // The HTML reply still cards…
    expect(container.querySelector(".sv-artifact-card")).toBeTruthy();
    // …and the actions row is present.
    const addBtn = container.querySelector(".chat-artifact-add") as HTMLButtonElement;
    expect(addBtn).toBeTruthy();
    act(() => addBtn.click());
    expect(added).toContain("<canvas>");
    cleanup();
  });

  it("Regenerate fires its handler; no action row when no handlers are passed", () => {
    let regen = 0;
    const withHandler = mount(
      <ChatMessageBody role="assistant" content={"plain reply"} onRegenerate={() => (regen += 1)} />
    );
    const regenBtn = withHandler.container.querySelector(".chat-artifact-regen") as HTMLButtonElement;
    act(() => regenBtn.click());
    expect(regen).toBe(1);
    withHandler.cleanup();

    // No handlers → no Add/Regenerate buttons; the row still carries the 朗读 control
    // (SPEECH-1b: every assistant reply is readable).
    const bare = mount(<ChatMessageBody role="assistant" content={"plain reply"} />);
    expect(bare.container.querySelector(".chat-artifact-add")).toBeNull();
    expect(bare.container.querySelector(".chat-artifact-regen")).toBeNull();
    expect(bare.container.querySelector(".speak-btn")).toBeTruthy();
    bare.cleanup();
  });

  it("disables the actions while busy", () => {
    const { container, cleanup } = mount(
      <ChatMessageBody role="assistant" content={"plain reply"} onAddNote={() => {}} busy />
    );
    const addBtn = container.querySelector(".chat-artifact-add") as HTMLButtonElement;
    expect(addBtn.disabled).toBe(true);
    cleanup();
  });
});
