// @vitest-environment jsdom
// A4b — StudyView mounts the capability-gated 🛠 用工具 button + the AgentTranscript.
// The button is hidden when the active provider has no tools (agentAvailable:false) and
// visible + wired when it does; clicking it runs runAgentTurn with the composer text;
// a running agentTurn renders tool cards + the streamed answer in the chat log. The
// reader/canvas/speech chrome is stubbed (same as studyViewSessions.test).
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
import type { AgentTurnState } from "./agentTurnReducer";
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

const runningTurn: AgentTurnState = {
  status: "running",
  items: [
    {
      kind: "tool",
      id: "c1",
      toolName: "search_notes",
      args: { query: "mito" },
      argsRaw: '{"query":"mito"}',
      result: { rows: [], total: 0, truncated: false },
      resultRaw: '{"rows":[],"total":0,"truncated":false}',
      state: "done",
      truncated: false
    }
  ]
};

const doneTurn: AgentTurnState = {
  status: "done",
  message: { role: "assistant", content: "I searched your notes." },
  items: [
    ...runningTurn.items,
    { kind: "text", content: "I searched your notes." }
  ]
};

describe("StudyView — agent-loop button + transcript (A4b)", () => {
  it("HIDES the 🛠 button when the provider has no tools (agentAvailable:false)", async () => {
    const host = await mountStudy(makeCtx({ agentAvailable: false }));
    expect(host.querySelector(".chat-agent-button")).toBeNull();
    // The panel-actions still has exactly the W1/W3 children (no extra button).
    const actions = host.querySelector(".chat-panel-actions") as HTMLElement;
    expect(actions.querySelector(".chat-agent-button")).toBeNull();
  });

  it("SHOWS the 🛠 button when the provider advertises tools, and wires the click", async () => {
    const runAgentTurn = vi.fn().mockResolvedValue(undefined);
    const host = await mountStudy(makeCtx({ agentAvailable: true, chatInput: "find my mito note", runAgentTurn }));
    const button = host.querySelector(".chat-agent-button") as HTMLButtonElement;
    expect(button).toBeTruthy();
    expect(button.textContent).toContain("用工具");
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
    expect(runAgentTurn).toHaveBeenCalledWith("find my mito note");
  });

  it("disables the 🛠 button with no composer text and no passage", async () => {
    const host = await mountStudy(makeCtx({ agentAvailable: true, chatInput: "", draftQuote: "" }));
    const button = host.querySelector(".chat-agent-button") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("renders the running agent transcript (tool card) in the chat log", async () => {
    const host = await mountStudy(makeCtx({ agentAvailable: true, status: "saving", agentTurn: runningTurn }));
    const transcript = host.querySelector(".chat-log .agent-transcript");
    expect(transcript).toBeTruthy();
    expect(transcript!.querySelector('.agent-tool-card[data-tool="search_notes"]')).toBeTruthy();
    // The running tail shows while the turn is in flight.
    expect(transcript!.querySelector(".agent-transcript-running")).toBeTruthy();
    // The generic ask-ai pending row is suppressed while an agent turn runs.
    expect(host.querySelector(".chat-pending")).toBeNull();
  });

  it("renders the streamed final answer text once the turn settles", async () => {
    const host = await mountStudy(makeCtx({ agentAvailable: true, agentTurn: doneTurn }));
    const transcript = host.querySelector(".chat-log .agent-transcript") as HTMLElement;
    expect(transcript.textContent).toContain("I searched your notes.");
    expect(transcript.querySelector(".agent-transcript-running")).toBeNull();
  });
});
