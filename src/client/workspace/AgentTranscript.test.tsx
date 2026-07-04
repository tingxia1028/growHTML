// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// AgentTranscript (A4b) RTL: collapsed vs expanded tool cards, in-band error state, the
// truncated (截断) badge, the running spinner tail, and text items rendered through the
// shared ChatMessageBody path. SpeakButton is stubbed (it probes /api/speech/status on
// mount — irrelevant here); builtinNoteTypes is registered so ChatMessageBody's markdown
// render has a "markdown" NoteType.
vi.mock("../speech/SpeakButton", () => ({ SpeakButton: () => null }));

import "../notes/builtinNoteTypes";
import { AgentTranscript } from "./AgentTranscript";
import type { AgentTranscriptItem, AgentTurnState } from "./agentTurnReducer";

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

function mount(turn: AgentTurnState | null) {
  root = createRoot(container);
  act(() => root!.render(<AgentTranscript turn={turn} />));
  return container;
}

const toolItem = (over: Partial<Extract<AgentTranscriptItem, { kind: "tool" }>> = {}): AgentTranscriptItem => ({
  kind: "tool",
  id: "c1",
  toolName: "search_notes",
  args: { query: "mito" },
  argsRaw: '{"query":"mito"}',
  result: { rows: [], total: 0, truncated: false },
  resultRaw: '{"rows":[],"total":0,"truncated":false}',
  state: "done",
  truncated: false,
  ...over
});

describe("AgentTranscript", () => {
  it("renders nothing for a null turn", () => {
    const host = mount(null);
    expect(host.querySelector(".agent-transcript")).toBeNull();
  });

  it("renders a collapsed tool card with a human summary + done glyph, body hidden", () => {
    const host = mount({ items: [toolItem()], status: "done" });
    const card = host.querySelector(".agent-tool-card");
    expect(card).toBeTruthy();
    expect(card!.getAttribute("data-tool")).toBe("search_notes");
    expect(card!.querySelector(".agent-tool-name")?.textContent).toContain("搜索笔记");
    expect(card!.querySelector(".agent-tool-name")?.textContent).toContain("mito");
    expect(card!.querySelector(".agent-tool-glyph-done")).toBeTruthy();
    // Collapsed: no body yet.
    expect(host.querySelector(".agent-tool-body")).toBeNull();
    expect(host.querySelector(".agent-tool-head")?.getAttribute("aria-expanded")).toBe("false");
  });

  it("expands on click to show pretty-printed args + result", () => {
    const host = mount({ items: [toolItem()], status: "done" });
    const head = host.querySelector(".agent-tool-head") as HTMLButtonElement;
    act(() => head.click());
    const body = host.querySelector(".agent-tool-body");
    expect(body).toBeTruthy();
    const jsons = host.querySelectorAll(".agent-tool-json");
    expect(jsons).toHaveLength(2); // 参数 + 结果
    // Pretty-printed (multi-line) JSON.
    expect(jsons[0].textContent).toContain('"query": "mito"');
    expect(host.querySelector(".agent-tool-head")?.getAttribute("aria-expanded")).toBe("true");
  });

  it("shows an error state card with the in-band error message when expanded", () => {
    const host = mount({
      items: [toolItem({ state: "error", error: "Source not found: x", result: undefined, resultRaw: '{"error":"Source not found: x"}' })],
      status: "done"
    });
    expect(host.querySelector(".agent-tool-error")).toBeTruthy();
    expect(host.querySelector(".agent-tool-glyph-error")).toBeTruthy();
    act(() => (host.querySelector(".agent-tool-head") as HTMLButtonElement).click());
    expect(host.querySelector(".agent-tool-json-error")?.textContent).toContain("Source not found: x");
  });

  it("shows the 截断 badge and renders the raw (non-parsing) payload verbatim", () => {
    const raw = '{"query":"' + "x".repeat(20); // unterminated
    const host = mount({ items: [toolItem({ args: undefined, argsRaw: raw, truncated: true })], status: "done" });
    expect(host.querySelector(".agent-tool-truncated")?.textContent).toContain("截断");
    act(() => (host.querySelector(".agent-tool-head") as HTMLButtonElement).click());
    // Non-parsing → shown verbatim (no throw).
    expect(host.querySelector(".agent-tool-json")?.textContent).toBe(raw);
  });

  it("shows a running spinner tail while status is running", () => {
    const host = mount({ items: [toolItem({ state: "calling", result: undefined, resultRaw: undefined })], status: "running" });
    expect(host.querySelector(".agent-transcript-running")).toBeTruthy();
    expect(host.querySelector(".agent-tool-calling")).toBeTruthy();
  });

  it("renders a text item through ChatMessageBody (markdown note render)", () => {
    const host = mount({ items: [{ kind: "text", content: "All **done**." }], status: "done" });
    const text = host.querySelector(".agent-transcript-text");
    expect(text).toBeTruthy();
    // ChatMessageBody's assistant path wraps in .chat-artifact and renders markdown.
    expect(text!.querySelector(".chat-artifact")).toBeTruthy();
    expect(text!.textContent).toContain("done");
    // No running/error tail on a completed turn.
    expect(host.querySelector(".agent-transcript-running")).toBeNull();
  });

  it("renders an error tail with the turn error message", () => {
    const host = mount({ items: [], status: "error", error: "agent blew up" });
    const tail = host.querySelector(".agent-transcript-error");
    expect(tail).toBeTruthy();
    expect(tail!.textContent).toContain("agent blew up");
  });
});
