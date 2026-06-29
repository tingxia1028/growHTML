import type { ChatRequest, ChatResponse, ModelProvider, StructuredRequest } from "./provider";

// The `contentType` marker the form-router request carries (it is NOT a stored note
// type — the router output is a transport envelope unwrapped into a real contentType).
// Defined here (not imported from core) to keep src/ai free of core/kit imports; the
// server's generate-block route passes this exact string.
export const FORM_ROUTER_CONTENT_TYPE = "form-router";

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
  //
  // Form-router determinism (adaptive note forms §4 Phase 4): the form-router schema is
  // a DISCRIMINATED UNION, so an empty `{}` would never validate. The router caller
  // passes a schema-valid union member as `sample` (the e2e passes a specific form, e.g.
  // a markmap, to make the test deterministic); the mock echoes it verbatim. When NO
  // sample is supplied for the router contentType, synthesize the FIRST valid union
  // member (a markdown note) so the call still yields a parseable union member rather
  // than an empty object — keeping unit + e2e deterministic without a real provider.
  async completeStructured(request: StructuredRequest): Promise<{ json: string }> {
    if (request.sample !== undefined) return { json: JSON.stringify(request.sample) };
    if (request.contentType === FORM_ROUTER_CONTENT_TYPE) {
      return { json: JSON.stringify({ form: "markdown", markdown: "" }) };
    }
    return { json: JSON.stringify({}) };
  }
}
