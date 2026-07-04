// @vitest-environment jsdom
// W1 — StudyView renders a persisted chat session's HISTORY through the normal chat
// log, and the in-panel session switcher resumes/creates/deletes through the ONE
// bundled ChatSessionsApi (the session domain itself is covered in
// src/client/chat/useChatSessions.test.tsx). Fixture-ctx idiom mirrors
// libraryView.test.tsx / anchorViews.test.tsx.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import type { ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

// Keep the views.tsx static import graph jsdom-safe (same stubs as WorkspaceShell.test):
// the reader modules pull pdf.js/webview code that needs DOMMatrix/canvas.
vi.mock("../PdfReader", () => ({ PdfReader: () => null }));
vi.mock("../ImageReader", () => ({ ImageReader: () => null }));
vi.mock("../WebviewReader", () => ({ WebviewReader: () => null }));
vi.mock("../LocalHtmlReader", () => ({ LocalHtmlReader: () => null }));
// Network-probing chrome that is not under test here: the speech buttons probe
// /api/speech/status on mount. (The generation preview is no longer mounted in the
// chat pane — D5 moved it to the shell-level FloatingNoteEditor.)
vi.mock("../speech/VoiceInputButton", () => ({ VoiceInputButton: () => null }));
vi.mock("../speech/SpeakButton", () => ({ SpeakButton: () => null }));

import type { WorkspaceNode } from "../data/entityClient";
import type { ChatSessionRecord } from "../chat/sessionClient";
import type { ChatSessionsApi } from "../chat/useChatSessions";
import { getView } from "./viewRegistry";
import type { WorkspaceContext } from "./viewRegistry";
import "./views";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// —— fixture: a persisted session, exactly as GET /api/chat/sessions/:id returns it ——
const fixtureSession: ChatSessionRecord = {
  id: "chat_01ARZ3NDEKTSV4RRFFQ69G5FAV",
  title: "什么是酶？",
  createdAt: "2026-07-04T08:00:00.000Z",
  updatedAt: "2026-07-04T08:00:05.000Z",
  messages: [
    { role: "user", content: "什么是酶？", ts: "2026-07-04T08:00:00.000Z" },
    { role: "assistant", content: "酶是生物催化剂，能加速化学反应。", ts: "2026-07-04T08:00:05.000Z" }
  ],
  attachments: [{ sourceId: "src_01ARZ3NDEKTSV4RRFFQ69G5FAV", includeNotes: true }]
};

const otherSummary = {
  id: "chat_01ARZ3NDEKTSV4RRFFQ69G5FAX",
  title: "光合作用",
  createdAt: "2026-07-03T08:00:00.000Z",
  updatedAt: "2026-07-03T08:00:00.000Z",
  messageCount: 4
};

function makeApi(overrides: Partial<ChatSessionsApi> = {}): ChatSessionsApi {
  return {
    list: [
      {
        id: fixtureSession.id,
        title: fixtureSession.title,
        createdAt: fixtureSession.createdAt,
        updatedAt: fixtureSession.updatedAt,
        messageCount: fixtureSession.messages.length
      },
      otherSummary
    ],
    activeId: fixtureSession.id,
    startNew: vi.fn(),
    select: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    attachments: [],
    addAttachment: vi.fn(),
    removeAttachment: vi.fn(),
    ...overrides
  };
}

function makeCtx(api: ChatSessionsApi): WorkspaceContext {
  return {
    focus: { focus: null, draft: null, anchor: null, clear: vi.fn() },
    status: "idle",
    draftQuote: "",
    // The transcript as the domain hands it to consumers (ts stripped).
    chatMessages: fixtureSession.messages.map(({ role, content }) => ({ role, content })),
    chatSessions: api,
    dispatch: vi.fn().mockResolvedValue(undefined),
    chatInput: "",
    setChatInput: vi.fn(),
    submitComposer: vi.fn(),
    composerDisabled: false,
    addReplyAsNote: vi.fn().mockResolvedValue(undefined),
    regenerateChatReply: vi.fn(),
    patchHtml: "",
    setPatchHtml: vi.fn(),
    activePatches: [],
    changePatchStatus: vi.fn().mockResolvedValue(undefined),
    showTerminal: false,
    setShowTerminal: vi.fn(),
    activeFileDir: ""
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

const openSwitcher = async (host: HTMLElement): Promise<HTMLElement> => {
  const trigger = host.querySelector(".chat-session-switcher .panel-menu-trigger") as HTMLButtonElement;
  expect(trigger).toBeTruthy();
  await act(async () => trigger.click());
  const popover = document.body.querySelector(".panel-menu-popover") as HTMLElement | null;
  expect(popover).toBeTruthy();
  return popover!;
};

describe("StudyView — chat session history + switcher (W1)", () => {
  it("renders the fixture session's transcript in the chat log", async () => {
    const host = await mountStudy(makeCtx(makeApi()));
    const messages = host.querySelectorAll(".chat-log .chat-msg");
    expect(messages).toHaveLength(2);
    expect(messages[0].className).toContain("chat-user");
    expect(messages[0].textContent).toContain("什么是酶？");
    expect(messages[1].className).toContain("chat-assistant");
    expect(messages[1].textContent).toContain("酶是生物催化剂，能加速化学反应。");
  });

  it("keeps AI Chat status/history first and the overflow menu last", async () => {
    const host = await mountStudy(makeCtx(makeApi()));
    const toolbar = host.querySelector(".chat-panel-toolbar") as HTMLElement;
    const actions = toolbar.querySelector(".chat-panel-actions") as HTMLElement;
    expect(toolbar.children).toHaveLength(1);
    expect(toolbar.firstElementChild).toBe(actions);

    const children = Array.from(actions.children);
    expect(children).toHaveLength(3);
    expect(children[0].classList.contains("workspace-status-dot")).toBe(true);
    expect(children[1].classList.contains("chat-session-switcher")).toBe(true);
    expect(children[2].classList.contains("panel-menu")).toBe(true);
  });

  it("lists the sessions (title + time) and marks the active one", async () => {
    const host = await mountStudy(makeCtx(makeApi()));
    const popover = await openSwitcher(host);
    const rows = popover.querySelectorAll(".chat-session-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].getAttribute("data-session-id")).toBe(fixtureSession.id);
    expect(rows[0].className).toContain("active");
    expect(rows[0].querySelector(".chat-session-title")?.textContent).toBe("什么是酶？");
    expect(rows[0].querySelector(".chat-session-time")?.textContent).not.toBe("");
    expect(rows[1].className).not.toContain("active");
    expect(rows[1].querySelector(".chat-session-title")?.textContent).toBe("光合作用");
  });

  it("clicking a history row RESUMES that session (select) ", async () => {
    const api = makeApi();
    const host = await mountStudy(makeCtx(api));
    const popover = await openSwitcher(host);
    const open = popover.querySelector(
      `.chat-session-row[data-session-id="${otherSummary.id}"] .chat-session-open`
    ) as HTMLButtonElement;
    await act(async () => open.click());
    expect(api.select).toHaveBeenCalledWith(otherSummary.id);
  });

  it("新对话 starts a fresh conversation", async () => {
    const api = makeApi();
    const host = await mountStudy(makeCtx(api));
    const popover = await openSwitcher(host);
    const newButton = popover.querySelector(".chat-session-new") as HTMLButtonElement;
    await act(async () => newButton.click());
    expect(api.startNew).toHaveBeenCalledOnce();
  });

  it("delete asks for confirmation — confirmed removes, cancelled keeps", async () => {
    const api = makeApi();
    const host = await mountStudy(makeCtx(api));
    const popover = await openSwitcher(host);
    const deleteButton = popover.querySelector(
      `.chat-session-row[data-session-id="${otherSummary.id}"] .chat-session-delete`
    ) as HTMLButtonElement;

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    await act(async () => deleteButton.click());
    expect(api.remove).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    await act(async () => deleteButton.click());
    expect(api.remove).toHaveBeenCalledWith(otherSummary.id);
  });
});
