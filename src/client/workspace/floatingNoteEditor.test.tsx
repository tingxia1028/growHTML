// @vitest-environment jsdom
// D5 — FloatingNoteEditor: the floating card editor that replaced the pane-bottom
// GenerationPreview. Covered here:
//   • manual create round-trip: openManualEditor(type) → the card opens NEXT TO the
//     passage in EDIT mode seeded with createDefault() → type → Save dispatches
//     anchor.add-note (client.createNote) and the card closes;
//   • close (✕) KEEPS the local autosave draft and a reopen restores it; explicit
//     Discard clears it;
//   • a GENERATED draft opens in PREVIEW mode with the `.generation-preview` /
//     `.gen-preview-*` structural classes (the preview loop's e2e contract) and
//     offers Regenerate (manual drafts don't);
//   • placeEditor placement math (below the passage rect, flip, fallbacks).
// Real WorkspaceProvider + mocked entityClient (the generatingState.test idiom).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// Reader-module stubs (keep the import graph jsdom-safe).
vi.mock("../PdfReader", () => ({ PdfReader: () => null }));
vi.mock("../ImageReader", () => ({ ImageReader: () => null }));
vi.mock("../WebviewReader", () => ({ WebviewReader: () => null }));
vi.mock("../LocalHtmlReader", () => ({ LocalHtmlReader: () => null }));

vi.mock("../data/entityClient", () => ({
  entityClient: {
    sources: vi.fn(() =>
      Promise.resolve({ sources: [{ id: "src1", title: "Doc", sourceType: "html", path: "doc.html", metadata: {} }] })
    ),
    operations: vi.fn(() => Promise.resolve({ operations: [] })),
    operationPrefs: vi.fn(() => Promise.resolve({ prefs: { order: [], disabled: [], params: {} } })),
    pluginPrefs: vi.fn(() => Promise.resolve({ prefs: { disabledContributions: [] } })),
    generateBlock: vi.fn(() =>
      Promise.resolve({ contentType: "markdown", content: "generated body", provider: "mock" })
    ),
    createNote: vi.fn(() =>
      Promise.resolve({ note: { id: "n1", anchorIds: [], layerIds: [], contentType: "markdown", content: "x" } })
    )
  }
}));

import { entityClient } from "../data/entityClient";
import { FocusProvider } from "../focus/FocusContext";
import { WorkspaceProvider, useWorkspace, type WorkspaceContextValue } from "./WorkspaceContext";
import { FloatingNoteEditor, placeEditor } from "./FloatingNoteEditor";
// Register the built-in client NoteType plugins (render/edit) — in the app views.tsx
// does this; the editor body needs getNoteType("markdown") to resolve.
import "../notes/builtinNoteTypes";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let ctx: WorkspaceContextValue;

function Capture() {
  ctx = useWorkspace();
  return null;
}

async function mount() {
  await act(async () => {
    root.render(
      <FocusProvider>
        <WorkspaceProvider>
          <Capture />
          <FloatingNoteEditor />
        </WorkspaceProvider>
      </FocusProvider>
    );
  });
}

// Drive a controlled React textarea: the native value setter + an input event.
function typeInto(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
  setter.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

const editor = () => document.querySelector(".floating-note-editor") as HTMLElement | null;

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1400 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  const current = root;
  await act(async () => current.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe("placeEditor — placement math (pure)", () => {
  const viewport = { width: 1000, height: 800 };
  const size = { width: 320, height: 240 };

  it("places the card below the passage rect, left-aligned and viewport-clamped", () => {
    const rect = { left: 200, top: 300, width: 220, height: 40, bottom: 340 };
    expect(placeEditor(rect, size, viewport)).toEqual({ left: 200, top: 350 });
    // Clamp: a passage hugging the right edge keeps the card on-screen.
    const edge = { left: 900, top: 300, width: 80, height: 40, bottom: 340 };
    expect(placeEditor(edge, size, viewport).left).toBe(1000 - 320 - 8);
  });

  it("flips ABOVE the passage when below would overflow the bottom", () => {
    const rect = { left: 100, top: 640, width: 200, height: 40, bottom: 680 };
    expect(placeEditor(rect, size, viewport).top).toBe(640 - 240 - 10);
  });

  it("falls back to the reader panel's top-right, then to a centered spot", () => {
    const reader = { left: 300, top: 60, right: 900 };
    expect(placeEditor(null, size, viewport, reader)).toEqual({ left: 900 - 320 - 24, top: 116 });
    expect(placeEditor(null, size, viewport, null)).toEqual({ left: (1000 - 320) / 2, top: 160 });
  });
});

describe("FloatingNoteEditor — manual create round-trip (D5)", () => {
  it("renders nothing while no draft is pending", async () => {
    await mount();
    expect(editor()).toBeNull();
  });

  it("openManualEditor opens in EDIT mode; Save persists via anchor.add-note and closes", async () => {
    await mount();
    await act(async () => ctx.openManualEditor("markdown"));

    const card = editor()!;
    expect(card).not.toBeNull();
    expect(card.getAttribute("data-manual")).toBe("1");
    expect(card.getAttribute("data-content-type")).toBe("markdown");
    // Straight into the registry editor (no preview step for manual creation) and
    // no Regenerate (nothing to re-run).
    const textarea = card.querySelector("textarea.note-edit") as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();
    expect(card.querySelector(".gen-preview-regenerate")).toBeNull();

    await act(async () => typeInto(textarea, "hello floating note"));
    await act(async () => (card.querySelector(".gen-preview-save") as HTMLButtonElement).click());

    expect(entityClient.createNote).toHaveBeenCalledTimes(1);
    expect(vi.mocked(entityClient.createNote).mock.calls[0][0]).toMatchObject({
      sourceId: "src1",
      anchorIds: [], // no focused passage in this harness → unanchored on the source
      contentType: "markdown",
      content: "hello floating note"
    });
    expect(editor()).toBeNull(); // the draft cleared on Save
    // Save also clears the local autosave draft.
    expect(window.localStorage.getItem("sv-edit-draft:src1:markdown")).toBeNull();
  });

  it("✕ close KEEPS the autosaved local draft and a reopen restores it; Discard clears it", async () => {
    await mount();
    await act(async () => ctx.openManualEditor("markdown"));
    const textarea = editor()!.querySelector("textarea.note-edit") as HTMLTextAreaElement;
    await act(async () => typeInto(textarea, "half-written thought"));
    // Let the 400ms autosave debounce fire.
    await act(async () => await new Promise((resolve) => setTimeout(resolve, 450)));

    await act(async () => (editor()!.querySelector(".floating-note-editor-close") as HTMLButtonElement).click());
    expect(editor()).toBeNull();
    expect(window.localStorage.getItem("sv-edit-draft:src1:markdown")).toContain("half-written thought");
    expect(entityClient.createNote).not.toHaveBeenCalled();

    // Reopen the same type → the kept draft seeds the editor.
    await act(async () => ctx.openManualEditor("markdown"));
    const reopened = editor()!.querySelector("textarea.note-edit") as HTMLTextAreaElement;
    expect(reopened.value).toBe("half-written thought");

    // Explicit 丢弃 clears both the pending draft AND the local copy.
    await act(async () => (editor()!.querySelector(".gen-preview-discard") as HTMLButtonElement).click());
    expect(editor()).toBeNull();
    expect(window.localStorage.getItem("sv-edit-draft:src1:markdown")).toBeNull();
  });

  it("a GENERATED draft opens in PREVIEW mode with the .generation-preview contract + Regenerate", async () => {
    await mount();
    // note.generate-block parks its draft through onGenerated → the floating editor.
    await act(async () => await ctx.dispatch("note.generate-block", { text: "explain osmosis" }));

    const card = editor()!;
    expect(card).not.toBeNull();
    // The preview-loop structural classes live INSIDE the floating card (e2e contract).
    expect(card.classList.contains("generation-preview")).toBe(true);
    expect(card.querySelector(".generation-preview-type")?.textContent).toBe("markdown");
    expect(card.querySelector(".generation-preview-body")).not.toBeNull();
    // Preview (render) first — no editor textarea until Edit is clicked.
    expect(card.querySelector("textarea.note-edit")).toBeNull();
    expect(card.querySelector(".gen-preview-regenerate")).not.toBeNull();

    // Edit toggles the registry editor in place.
    await act(async () => (card.querySelector(".gen-preview-edit") as HTMLButtonElement).click());
    expect(editor()!.querySelector("textarea.note-edit")).not.toBeNull();

    // Discard drops the draft without persisting.
    await act(async () => (editor()!.querySelector(".gen-preview-discard") as HTMLButtonElement).click());
    expect(editor()).toBeNull();
    expect(entityClient.createNote).not.toHaveBeenCalled();
  });
});
