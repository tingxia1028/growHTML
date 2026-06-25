import type { ChatRequest, ChatResponse, ModelProvider, StructuredRequest } from "./provider";

// Deterministic, offline provider used for development and as the verified
// default. It mirrors the shape of a real study assistant (markdown answer that
// references the anchored quote) without any network or subprocess, so the chat
// loop is fully self-testable.
export class MockModelProvider implements ModelProvider {
  readonly id = "mock";
  readonly capabilities = { chat: true, agentic: false, streaming: true } as const;

  // The deterministic answer text — shared by `complete` and `stream` so the
  // streamed concatenation is byte-identical to the one-shot reply.
  private answer(request: ChatRequest): string {
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
    return lines.join("\n");
  }

  async complete(request: ChatRequest): Promise<ChatResponse> {
    return { message: { role: "assistant", content: this.answer(request) } };
  }

  // Deterministic streaming: emit the same answer split into word-ish chunks so a
  // test can observe progressive arrival yet assert an exact final string. An
  // optional per-chunk delay (STUDY_VAULT_MOCK_STREAM_DELAY_MS) spaces the chunks
  // out so a browser e2e can watch the reply fill in; unset (the default, and all
  // unit tests) streams instantly. The delay never changes the content.
  async *stream(request: ChatRequest): AsyncIterable<string> {
    const text = this.answer(request);
    // Split keeping the whitespace, so concatenating the chunks reproduces `text`.
    const chunks = text.match(/\S+\s*/g) ?? [text];
    const delayMs = Number(process.env.STUDY_VAULT_MOCK_STREAM_DELAY_MS ?? 0);
    for (const chunk of chunks) {
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      yield chunk;
    }
  }

  // Deterministic structured generation: echo the host-supplied schema-valid
  // `sample` as JSON. This is what keeps Product Kit AI commands testable offline —
  // the kit prompt owns the sample, the mock just returns it verbatim.
  async completeStructured(request: StructuredRequest): Promise<{ json: string }> {
    return { json: JSON.stringify(request.sample ?? {}) };
  }
}
