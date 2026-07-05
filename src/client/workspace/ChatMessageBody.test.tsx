// @vitest-environment jsdom
// V-1 (vision-input.md §2) — ChatMessageBody renders a multimodal (array) message: an
// image part becomes a thumbnail `<img src="/api/assets/:id">` and the text renders as
// markdown; a bare-string message is unchanged; an array NEVER crashes the render.
// SpeakButton is stubbed (probes /api/speech/status on mount — irrelevant); the builtin
// note types register so the "markdown" render path exists.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("../speech/SpeakButton", () => ({ SpeakButton: () => null }));

import "../notes/builtinNoteTypes";
import { ChatMessageBody } from "./ChatMessageBody";
import type { ContentPart } from "../data/entityClient";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});
afterEach(() => {
  if (root) {
    const current = root;
    act(() => current.unmount());
    root = null;
  }
  container.remove();
  vi.restoreAllMocks();
});

function mount(role: string, content: string | ContentPart[]) {
  root = createRoot(container);
  act(() => root!.render(<ChatMessageBody role={role} content={content} />));
  return container;
}

const ASSET = "asset_01ARZ3NDEKTSV4RRFFQ69G5FAV";

describe("ChatMessageBody — V-1 multimodal render", () => {
  it("renders an image part as a thumbnail pointing at the asset byte route", () => {
    const el = mount("user", [
      { type: "text", text: "what is this?" },
      { type: "image", assetId: ASSET }
    ]);
    const img = el.querySelector("img.chat-msg-image") as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe(`/api/assets/${ASSET}`);
    // The text part still renders (as markdown) beside the thumbnail.
    expect(el.textContent).toContain("what is this?");
    // The [image] placeholder is NOT shown as text (the thumbnail covers it).
    expect(el.textContent).not.toContain("[image]");
  });

  it("renders an image-ONLY message without crashing (thumbnail, no text)", () => {
    const el = mount("user", [{ type: "image", assetId: ASSET }]);
    expect(el.querySelectorAll("img.chat-msg-image")).toHaveLength(1);
  });

  it("a bare-string message renders no thumbnail (unchanged)", () => {
    const el = mount("user", "just text");
    expect(el.querySelector("img.chat-msg-image")).toBeNull();
    expect(el.textContent).toContain("just text");
  });
});
