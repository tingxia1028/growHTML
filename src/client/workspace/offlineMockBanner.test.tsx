// @vitest-environment jsdom
// Offline-Mock honesty banner (alpha polish) — StudyView renders a dismissible one-line
// hint in the chat surface WHEN the active AI provider is the offline `mock` (a fresh
// install with no real provider). It is ABSENT on a real provider, and its ✕ latches the
// dismiss for the session. Mirrors the mistakeCapture.test fixture (the reader/speech
// chrome is stubbed so StudyView mounts standalone in jsdom).
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
    offlineMock: false,
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
  try {
    globalThis.sessionStorage?.removeItem("growte.offlineMockDismissed");
  } catch {
    // storage may be unavailable — the un-dismissed default already holds
  }
});
afterEach(async () => {
  if (root) {
    const current = root;
    await act(async () => current.unmount());
    root = null;
  }
  container.remove();
  try {
    globalThis.sessionStorage?.removeItem("growte.offlineMockDismissed");
  } catch {
    // ignore
  }
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

describe("StudyView — offline-Mock honesty banner", () => {
  it("renders the banner when the active provider is the offline mock", async () => {
    const host = await mountStudy(makeCtx({ offlineMock: true }));
    const banner = host.querySelector(".chat-offline-mock-banner");
    expect(banner).toBeTruthy();
    // The bilingual copy (zh default) plainly states replies are placeholders + points at settings.
    expect(banner!.textContent).toContain("离线 Mock");
    // The link is a real control that opens the Settings Hub through the shell-nav.
    expect(banner!.querySelector(".chat-offline-mock-link")).toBeTruthy();
  });

  it("is ABSENT when the active provider is a real (non-mock) provider", async () => {
    const host = await mountStudy(makeCtx({ offlineMock: false }));
    expect(host.querySelector(".chat-offline-mock-banner")).toBeNull();
  });

  it("the ✕ dismiss hides the banner (and latches for the session)", async () => {
    const host = await mountStudy(makeCtx({ offlineMock: true }));
    expect(host.querySelector(".chat-offline-mock-banner")).toBeTruthy();
    const dismiss = host.querySelector<HTMLButtonElement>(".chat-offline-mock-dismiss")!;
    await act(async () => dismiss.click());
    expect(host.querySelector(".chat-offline-mock-banner")).toBeNull();
    // The dismiss latched to session storage so a remount stays hidden.
    expect(globalThis.sessionStorage?.getItem("growte.offlineMockDismissed")).toBe("1");
  });

  it("stays dismissed on a fresh mount when the session flag is already set", async () => {
    globalThis.sessionStorage?.setItem("growte.offlineMockDismissed", "1");
    const host = await mountStudy(makeCtx({ offlineMock: true }));
    expect(host.querySelector(".chat-offline-mock-banner")).toBeNull();
  });
});
