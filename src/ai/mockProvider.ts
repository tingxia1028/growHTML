import type { ChatRequest, ChatResponse, ModelProvider } from "./provider";

// Deterministic, offline provider used for development and as the verified
// default. It mirrors the shape of a real study assistant (markdown answer that
// references the anchored quote) without any network or subprocess, so the chat
// loop is fully self-testable.
export class MockModelProvider implements ModelProvider {
  readonly id = "mock";
  readonly capabilities = { chat: true, agentic: false } as const;

  async complete(request: ChatRequest): Promise<ChatResponse> {
    const lastUser = [...request.messages].reverse().find((message) => message.role === "user");
    const question = lastUser?.content.trim() ?? "";
    const quote = request.context?.quote?.trim();
    const sourceTitle = request.context?.sourceTitle?.trim();
    const location = request.context?.location?.trim();

    const lines: string[] = [];
    lines.push(`**Study assistant (mock)**`);
    if (sourceTitle) lines.push(`Source: *${sourceTitle}*${location ? ` — ${location}` : ""}`);
    if (quote) lines.push(`> ${quote}`);
    lines.push("");
    lines.push(question ? `You asked: ${question}` : "Ask a question about this passage.");
    if (quote) {
      lines.push("");
      lines.push("- Key idea: " + quote.slice(0, 80));
    }

    return {
      message: {
        role: "assistant",
        content: lines.join("\n")
      }
    };
  }
}
