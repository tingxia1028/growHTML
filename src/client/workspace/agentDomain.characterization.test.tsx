// @vitest-environment jsdom
// PLAT-LAYER Part-2 Slice 7c — CHARACTERIZATION tests (the R2 SAFETY NET) for the
// agent-domain back-edges that the agent VIEW tests (studyViewAgent / mistakeCapture /
// offlineMockBanner / AgentTranscript) do NOT cover: those run over makeCtx() FAKES, so they
// never exercise the aiProviders availability effect OR the runAgentTurn agentStream fold.
//
// TEST-ONLY: ZERO production changes. These pin the CURRENT observable behavior of the agent
// domain against the REAL WorkspaceProvider with a stubbed entityClient, so the
// `useAgentDomain` extraction can prove it preserved behavior. Harness mirrors
// generationDomain / composerDomain characterization tests: mount the REAL WorkspaceProvider
// under a FocusProvider, stub the reader modules + entityClient IO, opt into React's act()
// env, and drive/observe through the live context surface.
//
// The behaviors pinned (cited against WorkspaceContext.tsx / useAgentDomain.ts):
//   (a) the aiProviders MOUNT effect sets agentAvailable/visionAvailable/offlineMock from a
//       stubbed entityClient.aiProviders — tested for BOTH the tool+vision "available" shape
//       AND the offline "mock" shape (active.kind === "mock").
//   (b) runAgentTurn folds a stubbed entityClient.agentStream event stream → records the user
//       turn ONCE (chatMessages gains the user message) + persists the final assistant message
//       (chatMessages gains the assistant reply, agentTurn clears back to null).
//
// Black-box reachability note: agentAvailable/visionAvailable/offlineMock/runAgentTurn/agentTurn
// are ALL public value fields, so each is observed/driven directly off the live context surface.
// buildChatContext + resolveAttachmentBundles (the coordinator-only bridge riders) are exercised
// THROUGH runAgentTurn (it awaits resolveAttachmentBundles + builds the context) — the reachable
// contract; the agentStream `context` arg assertion pins that the bridge fed the turn.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// Opt into React's act() environment so state updates + effects flush deterministically.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Reader-module stubs — keep the import graph jsdom-safe (pdf.js / webview native bits).
vi.mock("../PdfReader", () => ({ PdfReader: () => null }));
vi.mock("../ImageReader", () => ({ ImageReader: () => null }));
vi.mock("../WebviewReader", () => ({ WebviewReader: () => null }));
vi.mock("../LocalHtmlReader", () => ({ LocalHtmlReader: () => null }));

// The stubbed entityClient. aiProviders defaults to a tool+vision "available" provider so the
// mount effect flips all three flags true (individual tests override for the mock shape).
// agentStream folds a small deterministic event stream and returns the final assistant message.
// sourceBundle backs resolveAttachmentBundles (an empty active source → no bundles fetched).
const availableProviders = {
  active: { id: "p1", kind: "http" },
  providers: [{ id: "p1", kind: "http", label: "P1", capabilities: { tools: true, vision: true } }],
  envProviderId: null
};

vi.mock("../data/entityClient", () => ({
  entityClient: {
    sources: vi.fn(() => Promise.resolve({ sources: [] })),
    operations: vi.fn(() => Promise.resolve({ operations: [] })),
    operationPrefs: vi.fn(() => Promise.resolve({ prefs: { order: [], disabled: [], params: {} } })),
    aiProviders: vi.fn(() => Promise.resolve(availableProviders)),
    sourceBundle: vi.fn(() => Promise.resolve({ bundle: { sourceId: "s", title: "s", type: "html", notes: [] } })),
    agentStream: vi.fn(
      async (
        _input: unknown,
        handlers: {
          onStep?(index: number): void;
          onTextDelta(delta: string): void;
          onToolCall(call: { id: string; toolName: string; argsJson: string; truncated: boolean }): void;
          onToolResult(result: { id: string; resultJson: string; truncated: boolean }): void;
        }
      ) => {
        // Fold a representative stream: one step, a tool call+result, then a text delta.
        handlers.onStep?.(0);
        handlers.onToolCall({ id: "t1", toolName: "search", argsJson: '{"q":"x"}', truncated: false });
        handlers.onToolResult({ id: "t1", resultJson: '{"hits":2}', truncated: false });
        handlers.onTextDelta("The ");
        handlers.onTextDelta("answer.");
        return { message: { role: "assistant", content: "The answer." }, provider: "p1" };
      }
    )
  }
}));

import { entityClient } from "../data/entityClient";
import { FocusProvider } from "../focus/FocusContext";
import { WorkspaceProvider, useWorkspace, type WorkspaceContextValue } from "./WorkspaceContext";

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
        </WorkspaceProvider>
      </FocusProvider>
    );
  });
  // Flush the mount fetch chain (incl. the aiProviders effect) so the provider settles.
  await flush();
}

async function flush() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1400 });
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe("agent domain — the aiProviders availability effect", () => {
  it("(a) available provider (tools+vision, non-mock) → agentAvailable/visionAvailable true, offlineMock false", async () => {
    // Default stub: a tool+vision http provider.
    vi.mocked(entityClient.aiProviders).mockResolvedValueOnce(availableProviders as never);
    await mount();

    expect(entityClient.aiProviders).toHaveBeenCalled();
    expect(ctx.agentAvailable).toBe(true);
    expect(ctx.visionAvailable).toBe(true);
    expect(ctx.offlineMock).toBe(false);
  });

  it("(a') offline mock provider (kind:'mock', no capabilities) → agentAvailable/visionAvailable false, offlineMock true", async () => {
    vi.mocked(entityClient.aiProviders).mockResolvedValueOnce({
      active: { id: "mock", kind: "mock" },
      providers: [{ id: "mock", kind: "mock", label: "Mock", capabilities: { tools: false, vision: false } }],
      envProviderId: null
    } as never);
    await mount();

    expect(ctx.agentAvailable).toBe(false);
    expect(ctx.visionAvailable).toBe(false);
    // active.kind === "mock" → the offline honesty hint arms.
    expect(ctx.offlineMock).toBe(true);
  });
});

describe("agent domain — runAgentTurn folds the agentStream + persists the final message", () => {
  it("(b) records the user turn ONCE + persists the streamed final assistant reply", async () => {
    await mount();
    expect(ctx.chatMessages).toEqual([]);
    expect(ctx.agentTurn).toBeNull();

    await act(async () => {
      await ctx.runAgentTurn("what is 2+2?");
    });
    await flush();

    // The agent stream ran with the assembled history (the user turn recorded once) + a context.
    expect(entityClient.agentStream).toHaveBeenCalledTimes(1);
    const [input] = vi.mocked(entityClient.agentStream).mock.calls[0] as [
      { messages: Array<{ role: string; content: string }>; context?: unknown },
      unknown
    ];
    // The user turn was assembled into the history exactly once (no duplicate append on done).
    expect(input.messages.filter((m) => m.role === "user" && m.content === "what is 2+2?")).toHaveLength(1);
    // The bridge fed a context object (buildChatContext, exercised through runAgentTurn).
    expect(input.context).toBeDefined();

    // The transcript log now holds the user turn + the persisted assistant final message.
    expect(ctx.chatMessages).toEqual([
      { role: "user", content: "what is 2+2?" },
      { role: "assistant", content: "The answer." }
    ]);
    // The render-only agent turn cleared back to null after the done fold.
    expect(ctx.agentTurn).toBeNull();
  });

  it("(b') empty/whitespace text → no-op (no agentStream call, no turn started)", async () => {
    await mount();

    await act(async () => {
      await ctx.runAgentTurn("   ");
    });
    await flush();

    expect(entityClient.agentStream).not.toHaveBeenCalled();
    expect(ctx.chatMessages).toEqual([]);
    expect(ctx.agentTurn).toBeNull();
  });

  it("(b'') an agentStream REJECTION keeps the accumulated turn in an error state + surfaces error", async () => {
    vi.mocked(entityClient.agentStream).mockRejectedValueOnce(new Error("工具调用失败: 501"));
    await mount();

    await act(async () => {
      await ctx.runAgentTurn("run a tool");
    });
    await flush();

    // Degrade: the user turn was still recorded, the error surfaced, and the transcript is
    // flipped to the error status (kept, not dropped).
    expect(ctx.chatMessages).toEqual([{ role: "user", content: "run a tool" }]);
    expect(ctx.error).toBe("工具调用失败: 501");
    expect(ctx.agentTurn?.status).toBe("error");
  });
});
