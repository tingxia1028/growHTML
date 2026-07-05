// MockAgentProvider — the deterministic, offline provider that ALSO drives the A4b
// agent loop. The tool-calling loop (runAgent) is shipped only by the http
// AiSdkProvider (real vendor SDK, network) — so the offline e2e/unit surface had no
// tools-capable provider to render against. This adds one WITHOUT any network.
//
// DELTA 1 (the review): MockModelProvider.answer() is PRIVATE — we do NOT call it.
// This provider is built by COMPOSITION: it HOLDS a MockModelProvider and DELEGATES
// complete / stream / completeStructured to it byte-identically, so pinning the whole
// e2e suite to `mock-agent` (playwright.config.ts) leaves every non-agent spec's
// deterministic reply unchanged (streaming-chat `You asked:`, chat-attachments
// `Attached:`, all structured-gen defaults). It ADDS a scripted runAgent + honest
// capabilities (agentic/tools true, structured kept true).

import { messageText } from "./buildPrompt";
import { MockModelProvider } from "./mockProvider";
import type {
  AgentRequest,
  AgentStepEvent,
  ChatRequest,
  ChatResponse,
  ModelProvider,
  ProviderCapabilities,
  StructuredRequest
} from "./provider";

/** The scripted final answer runAgent settles on — deterministic for the e2e/unit assertions. */
export const MOCK_AGENT_FINAL_ANSWER =
  "I searched your notes and found 1 match. See the tool result above.";

export class MockAgentProvider implements ModelProvider {
  readonly id = "mock-agent";
  // Mock's capabilities with the agent bits flipped on. structured stays true so the
  // structured-generation e2e/unit paths keep taking the native echo path unchanged.
  readonly capabilities: ProviderCapabilities = {
    chat: true,
    agentic: true,
    streaming: true,
    structured: true,
    tools: true,
    // The agent-loop mock is text-only; image parts route to the vision mock instead.
    vision: false,
    kind: "mock"
  };

  // The delegate — a real MockModelProvider. Every non-agent method forwards to it, so
  // its (private) answer() logic reaches the wire byte-identically without exposing it.
  private readonly mock = new MockModelProvider();

  complete(request: ChatRequest): Promise<ChatResponse> {
    return this.mock.complete(request);
  }

  stream(request: ChatRequest): AsyncIterable<string> {
    // The mock always implements stream(); delegate the async iterable straight through.
    return this.mock.stream(request);
  }

  completeStructured(request: StructuredRequest): Promise<{ json: string }> {
    return this.mock.completeStructured(request);
  }

  /**
   * A scripted, deterministic agent turn — no SDK, no network. It calls the FIRST
   * registered tool (search_notes when present) with the user's last question as the
   * query, echoes a plausible result row, then streams the fixed final answer:
   *
   *   step(0) → tool-call(search_notes) → tool-result(rows) → step(1) → text-delta* → done
   *
   * The tool-result mirrors search_notes' real shape { rows, total, truncated } so the
   * transcript card renders the same way it will against a live provider. When no tool
   * is available the loop degrades to step → text → done (still a valid transcript).
   */
  async *runAgent(request: AgentRequest): AsyncIterable<AgentStepEvent> {
    const lastUser = [...request.messages].reverse().find((message) => message.role === "user");
    const query = lastUser ? messageText(lastUser.content).trim() : "";
    const searchTool = request.tools?.find((tool) => tool.name === "search_notes");
    // Optional per-event pacing (STUDY_VAULT_MOCK_STREAM_DELAY_MS) — the SAME knob the
    // mock's stream() honors — so a browser e2e can OBSERVE the transcript's tool card
    // + streamed text before the turn settles. Unset (all unit tests) runs instantly;
    // the delay never changes the events, only their spacing.
    const delayMs = Number(process.env.STUDY_VAULT_MOCK_STREAM_DELAY_MS ?? 0);
    const pace = async () => {
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    };

    yield { type: "step", index: 0 };
    if (searchTool) {
      const callId = "mock-agent-call-1";
      await pace();
      yield { type: "tool-call", toolName: "search_notes", args: { query }, id: callId };
      // Execute the REAL registered tool so the result reflects the actual vault
      // (empty vault → total 0). Deterministic and offline (the tools are read-only).
      let result: unknown;
      try {
        result = await searchTool.execute({ query: query || "note" }, undefined);
      } catch (error) {
        result = { error: error instanceof Error ? error.message : "search failed" };
      }
      await pace();
      yield { type: "tool-result", id: callId, result };
    }
    yield { type: "step", index: 1 };
    // Stream the fixed answer in a couple of chunks so the client sees progressive text.
    for (const chunk of [MOCK_AGENT_FINAL_ANSWER.slice(0, 20), MOCK_AGENT_FINAL_ANSWER.slice(20)]) {
      if (chunk) {
        await pace();
        yield { type: "text-delta", delta: chunk };
      }
    }
    yield { type: "done", message: { role: "assistant", content: MOCK_AGENT_FINAL_ANSWER } };
  }
}
