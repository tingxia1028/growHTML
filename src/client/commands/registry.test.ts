import { describe, expect, it, vi } from "vitest";
import { getCommand, runCommand, type CommandContext } from "./registry";
import type { AnyAnchor } from "../data/entityClient";
import type { FocusContextValue } from "../focus/FocusContext";

const anchor: AnyAnchor = {
  id: "anchor_1",
  sourceId: "src_1",
  anchorKind: "html_selection",
  studyId: "p1",
  selector: '[data-study-id="p1"]',
  quote: "passage"
};

function fakeFocus(over: Partial<FocusContextValue> = {}): FocusContextValue {
  return {
    focus: { type: "anchor-draft", draft: { mode: "quote", sourceId: "src_1", kind: "html", quote: "passage" } },
    draft: { mode: "quote", sourceId: "src_1", kind: "html", quote: "passage" },
    anchor: null,
    setFocus: vi.fn(),
    setDraft: vi.fn(),
    setAnchor: vi.fn(),
    clear: vi.fn(),
    materializeAnchor: vi.fn(async () => anchor),
    ...over
  };
}

function baseCtx(over: Partial<CommandContext> = {}): CommandContext {
  return {
    focus: fakeFocus(),
    client: {
      createNote: vi.fn(async () => ({ note: { id: "note_1" } as never })),
      createPatch: vi.fn(async () => ({ patch: { id: "patch_1" } as never })),
      chat: vi.fn(async () => ({ message: { role: "assistant" as const, content: "hi" }, provider: "mock" }))
    },
    sourceId: "src_1",
    payload: {},
    actions: {},
    ...over
  };
}

describe("command: anchor.add-note", () => {
  it("materializes the draft and creates an anchored note", async () => {
    const onNoteCreated = vi.fn();
    const ctx = baseCtx({ payload: { text: "my note" }, actions: { onNoteCreated } });

    const ran = await runCommand("anchor.add-note", ctx);

    expect(ran).toBe(true);
    expect(ctx.focus.materializeAnchor).toHaveBeenCalledOnce();
    expect(ctx.client.createNote).toHaveBeenCalledWith({
      sourceId: "src_1",
      anchorIds: ["anchor_1"],
      contentType: "markdown",
      content: "my note"
    });
    expect(onNoteCreated).toHaveBeenCalledOnce();
  });

  it("saves unanchored when there is no draft or anchor", async () => {
    const ctx = baseCtx({
      payload: { text: "loose note" },
      focus: fakeFocus({ focus: null, draft: null, materializeAnchor: vi.fn(async () => null) })
    });
    await runCommand("anchor.add-note", ctx);
    expect(ctx.client.createNote).toHaveBeenCalledWith(
      expect.objectContaining({ anchorIds: [], content: "loose note" })
    );
  });

  it("is unavailable with empty text", () => {
    expect(getCommand("anchor.add-note")!.isAvailable(baseCtx({ payload: { text: "  " } }))).toBe(false);
  });
});

describe("command: anchor.create-patch", () => {
  it("creates a patch against the materialized anchor", async () => {
    const onPatchCreated = vi.fn();
    const ctx = baseCtx({
      payload: { newContent: "<p>new</p>", oldText: "old" },
      actions: { onPatchCreated }
    });
    await runCommand("anchor.create-patch", ctx);
    expect(ctx.client.createPatch).toHaveBeenCalledWith({
      sourceId: "src_1",
      anchorId: "anchor_1",
      oldText: "old",
      newContent: "<p>new</p>"
    });
    expect(onPatchCreated).toHaveBeenCalledOnce();
  });
});

describe("command: anchor.ask-ai", () => {
  it("appends the user message and reports the assistant reply", async () => {
    const onChatHistory = vi.fn();
    const onAssistantMessage = vi.fn();
    const ctx = baseCtx({
      payload: { text: "what is this?" },
      chatMessages: [{ role: "user", content: "earlier" }],
      actions: { onChatHistory, onAssistantMessage }
    });
    await runCommand("anchor.ask-ai", ctx);
    expect(onChatHistory).toHaveBeenCalledWith([
      { role: "user", content: "earlier" },
      { role: "user", content: "what is this?" }
    ]);
    expect(ctx.client.chat).toHaveBeenCalledOnce();
    expect(onAssistantMessage).toHaveBeenCalledWith({ role: "assistant", content: "hi" });
  });

  it("is unavailable without an active source", () => {
    expect(
      getCommand("anchor.ask-ai")!.isAvailable(baseCtx({ payload: { text: "q" }, sourceId: undefined }))
    ).toBe(false);
  });
});
