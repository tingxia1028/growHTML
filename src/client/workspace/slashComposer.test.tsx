// @vitest-environment jsdom
// SC-1 — the slash composer wired into StudyView's chat input (D5 integration):
// typing "/" opens the SC-0 palette above the input; a BARE `/type` pick opens the
// D5 floating editor in manual mode (openManualEditor); `/type + instruction`
// dispatches the form-router generation (note.generate-block) whose draft parks in
// the same floating editor. Escape dismisses the palette for the current input;
// Enter belongs to the palette while it is open (never submits the chat). Fixture-
// ctx idiom mirrors studyViewSessions.test.tsx.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import type { ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

// Keep the views.tsx static import graph jsdom-safe (same stubs as studyViewSessions).
vi.mock("../PdfReader", () => ({ PdfReader: () => null }));
vi.mock("../ImageReader", () => ({ ImageReader: () => null }));
vi.mock("../WebviewReader", () => ({ WebviewReader: () => null }));
vi.mock("../LocalHtmlReader", () => ({ LocalHtmlReader: () => null }));
vi.mock("../speech/VoiceInputButton", () => ({ VoiceInputButton: () => null }));
vi.mock("../speech/SpeakButton", () => ({ SpeakButton: () => null }));

import type { WorkspaceNode } from "../data/entityClient";
import { getView } from "./viewRegistry";
import type { WorkspaceContext } from "./viewRegistry";
import "./views";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeCtx(overrides: Record<string, unknown> = {}): WorkspaceContext {
  return {
    focus: { focus: null, draft: null, anchor: null, clear: vi.fn() },
    status: "idle",
    draftQuote: "",
    chatMessages: [],
    chatSessions: {
      list: [],
      activeId: null,
      startNew: vi.fn(),
      select: vi.fn(),
      remove: vi.fn(),
      attachments: [],
      addAttachment: vi.fn(),
      removeAttachment: vi.fn()
    },
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
    activeFileDir: "",
    openManualEditor: vi.fn(),
    // SC-3: the palette now spans operations too — the mount reads these off ctx.
    operations: [],
    operationPrefs: { order: [], disabled: [] },
    activeKitIds: [],
    ...overrides
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

const textarea = (host: HTMLElement) => host.querySelector(".chat-composer-input") as HTMLTextAreaElement;
const palette = (host: HTMLElement) => host.querySelector(".chat-slash-palette .slash-palette");

async function pressKey(host: HTMLElement, key: string) {
  await act(async () => {
    textarea(host).dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

describe("StudyView — slash composer (SC-1 over the SC-0 palette)", () => {
  it("no palette for plain chat input; '/' opens the registry-derived palette", async () => {
    const host = await mountStudy(makeCtx({ chatInput: "what is osmosis?" }));
    expect(palette(host)).toBeNull();

    const host2 = await mountStudy(makeCtx({ chatInput: "/" }));
    const pal = palette(host2)!;
    expect(pal).not.toBeNull();
    // Registry-derived rows (builtinNoteTypes registered via the views import):
    // markdown + quiz are present; hidden types (bookmark) never appear.
    const ids = Array.from(pal.querySelectorAll(".slash-palette-row")).map((row) => row.getAttribute("data-entry-id"));
    expect(ids).toContain("markdown");
    expect(ids).toContain("quiz");
    expect(ids).not.toContain("bookmark");
  });

  it("bare `/判断题` + Enter opens the D5 floating editor in MANUAL mode (quiz) and clears the input", async () => {
    const ctx = makeCtx({ chatInput: "/判断题" });
    const host = await mountStudy(ctx);
    const rows = palette(host)!.querySelectorAll(".slash-palette-row");
    expect(rows[0].getAttribute("data-entry-id")).toBe("quiz"); // 中文 alias resolves

    await pressKey(host, "Enter");
    expect(ctx.openManualEditor).toHaveBeenCalledWith("quiz");
    expect(ctx.setChatInput).toHaveBeenCalledWith("");
    expect(ctx.dispatch).not.toHaveBeenCalled();
    expect(ctx.submitComposer).not.toHaveBeenCalled(); // Enter belonged to the palette
  });

  it("`/quiz 出三道题` + Enter dispatches the typed generation instead of manual mode", async () => {
    const ctx = makeCtx({ chatInput: "/quiz 出三道题" });
    const host = await mountStudy(ctx);
    await pressKey(host, "Enter");
    expect(ctx.openManualEditor).not.toHaveBeenCalled();
    expect(ctx.dispatch).toHaveBeenCalledTimes(1);
    const [commandId, payload] = vi.mocked(ctx.dispatch).mock.calls[0] as [string, { text?: string }];
    expect(commandId).toBe("note.generate-block");
    expect(payload.text).toContain("出三道题");
    expect(payload.text).toContain("quiz");
  });

  it("arrows move the active row; a row CLICK picks it", async () => {
    const ctx = makeCtx({ chatInput: "/" });
    const host = await mountStudy(ctx);
    const rowsBefore = palette(host)!.querySelectorAll(".slash-palette-row");
    expect(rowsBefore[0].className).toContain("active");
    await pressKey(host, "ArrowDown");
    const rowsAfter = palette(host)!.querySelectorAll(".slash-palette-row");
    expect(rowsAfter[1].className).toContain("active");

    await act(async () => {
      rowsAfter[0].dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    });
    expect(ctx.openManualEditor).toHaveBeenCalledWith(rowsAfter[0].getAttribute("data-entry-id"));
  });

  it("SC-3: a custom operation shows in the palette; picking it runs the shipped operation.run", async () => {
    const ctx = makeCtx({
      chatInput: "/",
      operations: [{ id: "op_test", name: "我的操作", scope: "anchor" }]
    });
    const host = await mountStudy(ctx);
    const opRow = Array.from(palette(host)!.querySelectorAll(".slash-palette-row")).find(
      (row) => row.getAttribute("data-entry-id") === "op_test"
    );
    expect(opRow).toBeTruthy();

    await act(async () => {
      opRow!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    });
    expect(ctx.dispatch).toHaveBeenCalledTimes(1);
    const [commandId, payload] = vi.mocked(ctx.dispatch).mock.calls[0] as [
      string,
      { operationId?: string; scope?: string }
    ];
    expect(commandId).toBe("operation.run");
    expect(payload.operationId).toBe("op_test");
    expect(payload.scope).toBe("anchor");
    expect(ctx.openManualEditor).not.toHaveBeenCalled(); // an operation is not a manual note-type pick
  });

  it("Escape dismisses the palette for the CURRENT input; Enter then submits the chat normally", async () => {
    const ctx = makeCtx({ chatInput: "/quiz" });
    const host = await mountStudy(ctx);
    expect(palette(host)).not.toBeNull();
    await pressKey(host, "Escape");
    expect(palette(host)).toBeNull();
    await pressKey(host, "Enter");
    expect(ctx.submitComposer).toHaveBeenCalledTimes(1);
    expect(ctx.openManualEditor).not.toHaveBeenCalled();
  });
});
