// @vitest-environment jsdom
// V-2 (拍错题) — StudyView renders the 拍错题 capture affordance. Picking a photo calls
// captureMistakePhoto(file, hint); the affordance stays VISIBLE on a non-vision provider
// (degrade-not-disappear — a `data-vision="off"` hint, never hidden). The reader/canvas/
// speech chrome is stubbed (same as studyViewAgent.test).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import type { ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("../PdfReader", () => ({ PdfReader: () => null }));
vi.mock("../ImageReader", () => ({ ImageReader: () => null }));
vi.mock("../WebviewReader", () => ({ WebviewReader: () => null }));
vi.mock("../LocalHtmlReader", () => ({ LocalHtmlReader: () => null }));
vi.mock("../speech/VoiceInputButton", () => ({ VoiceInputButton: () => null }));
vi.mock("../speech/SpeakButton", () => ({ SpeakButton: () => null }));

import type { WorkspaceNode } from "../data/entityClient";
import type { ChatSessionsApi } from "../chat/useChatSessions";
import { getView } from "./viewRegistry";
import type { WorkspaceContext } from "./viewRegistry";
import "./views";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeApi(): ChatSessionsApi {
  return {
    list: [],
    activeId: null,
    startNew: vi.fn(),
    select: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    attachments: [],
    addAttachment: vi.fn(),
    removeAttachment: vi.fn()
  };
}

function makeCtx(over: Partial<WorkspaceContext> = {}): WorkspaceContext {
  return {
    focus: { focus: null, draft: null, anchor: null, clear: vi.fn() },
    status: "idle",
    draftQuote: "",
    sources: [],
    chatMessages: [],
    chatSessions: makeApi(),
    dispatch: vi.fn().mockResolvedValue(undefined),
    chatInput: "",
    setChatInput: vi.fn(),
    submitComposer: vi.fn(),
    composerDisabled: false,
    addReplyAsNote: vi.fn().mockResolvedValue(undefined),
    regenerateChatReply: vi.fn(),
    agentTurn: null,
    agentAvailable: false,
    attachImage: vi.fn().mockResolvedValue(undefined),
    captureMistakePhoto: vi.fn().mockResolvedValue(undefined),
    visionAvailable: false,
    runAgentTurn: vi.fn().mockResolvedValue(undefined),
    patchHtml: "",
    setPatchHtml: vi.fn(),
    activePatches: [],
    changePatchStatus: vi.fn().mockResolvedValue(undefined),
    showTerminal: false,
    setShowTerminal: vi.fn(),
    activeFileDir: "",
    operations: [],
    operationPrefs: { order: [], disabled: [] },
    activeKitIds: [],
    ...over
  } as unknown as WorkspaceContext;
}

let container: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});
afterEach(async () => {
  if (root) {
    const current = root;
    await act(async () => current.unmount());
    root = null;
  }
  container.remove();
  vi.restoreAllMocks();
});

async function mountStudy(ctx: WorkspaceContext): Promise<HTMLElement> {
  const plugin = getView("study");
  expect(plugin).toBeTruthy();
  const node = { id: "study", kind: "study" } as WorkspaceNode;
  root = createRoot(container);
  await act(async () => root!.render(plugin!.render(node, ctx) as ReactElement));
  return container;
}

describe("StudyView — 拍错题 capture affordance (V-2)", () => {
  it("renders the capture affordance even on a NON-vision provider (degrade-not-disappear)", async () => {
    const host = await mountStudy(makeCtx({ visionAvailable: false }));
    const label = host.querySelector(".chat-capture-mistake") as HTMLElement;
    expect(label).toBeTruthy();
    // A HINT that the active provider can't see images — never hidden.
    expect(label.getAttribute("data-vision")).toBe("off");
    expect(label.querySelector('input[type="file"]')).toBeTruthy();
  });

  it("flips the data-vision hint to 'on' when the active provider supports images", async () => {
    const host = await mountStudy(makeCtx({ visionAvailable: true }));
    const label = host.querySelector(".chat-capture-mistake") as HTMLElement;
    expect(label.getAttribute("data-vision")).toBe("on");
  });

  it("picking a photo dispatches captureMistakePhoto(file, hint) with the composer text as the hint", async () => {
    const captureMistakePhoto = vi.fn().mockResolvedValue(undefined);
    const host = await mountStudy(makeCtx({ captureMistakePhoto, chatInput: "五年级 分数加法" }));
    const input = host.querySelector(".chat-capture-mistake input[type=file]") as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], "mistake.png", { type: "image/png" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(captureMistakePhoto).toHaveBeenCalledTimes(1);
    expect(captureMistakePhoto.mock.calls[0][0]).toBe(file);
    expect(captureMistakePhoto.mock.calls[0][1]).toBe("五年级 分数加法");
  });
});
