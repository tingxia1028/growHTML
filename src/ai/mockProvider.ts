import { attachmentsBlock, messageText } from "./buildPrompt";
import { defaultSynthesisDoc, SYNTHESIS_PROMPT_MARKER } from "./synthesizePrompt";
import type { ChatRequest, ChatResponse, ContentPart, ModelProvider, StructuredRequest } from "./provider";

/** Count image parts across a message content (0 for a bare string). */
function countImages(content: string | ContentPart[]): number {
  return Array.isArray(content) ? content.filter((part) => part.type === "image").length : 0;
}

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
  readonly capabilities = {
    chat: true,
    agentic: false,
    streaming: true,
    // Native structured path: completeStructured echoes the host-supplied sample.
    structured: true,
    tools: false,
    // V-1 (vision-input.md §2): the OFFLINE vision proof — the mock accepts image
    // parts and deterministically echoes "Saw N image(s)." so the demo + tests run
    // offline without a real VLM (mirrors the "Attached: N source(s)" marker).
    vision: true,
    kind: "mock"
  } as const;

  // The deterministic answer text — shared by `complete` and `stream` so the
  // streamed concatenation is byte-identical to the one-shot reply.
  private answer(request: ChatRequest): string {
    const lastUser = [...request.messages].reverse().find((message) => message.role === "user");
    const question = lastUser ? messageText(lastUser.content).trim() : "";
    // V-1 vision proof: count image parts on the last user turn so the reply carries a
    // deterministic "Saw N image(s)." marker (the offline analogue of a real VLM's ack;
    // mirrors the "Attached: N source(s)" attachment marker). Zero when the user sent
    // no image → nothing prepended, so text-only replies stay byte-identical.
    const imageCount = lastUser ? countImages(lastUser.content) : 0;
    const quote = request.context?.quote?.trim();
    const sourceTitle = request.context?.sourceTitle?.trim();
    const location = request.context?.location?.trim();

    // W2: the attachments block leads the reply with "Attached: N source(s)" when the
    // chat carries source attachments — the deterministic proof that the widened
    // ChatContext reached the prompt. Empty (nothing prepended) at zero attachments,
    // so the pre-W2 reply is byte-identical.
    const attachments = attachmentsBlock(request.context);

    const lines: string[] = [];
    lines.push(`**Study assistant (mock)**`);
    if (sourceTitle) lines.push(`Source: *${sourceTitle}*${location ? ` — ${location}` : ""}`);
    if (quote) lines.push(`> ${quote}`);
    if (attachments) {
      lines.push("");
      lines.push(attachments);
    }
    // V-1: deterministic vision ack — proves an image part reached this vision provider.
    if (imageCount > 0) {
      lines.push("");
      lines.push(`Saw ${imageCount} image${imageCount === 1 ? "" : "s"}.`);
    }
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
  //
  // W3 synthesis determinism (ai-workspace §W3): a synthesis request validates against
  // {title, markdown} (both min(1)), so an empty `{}` would 400. When no sample is
  // supplied yet the prompt is a SYNTHESIS one (its system message carries the stable
  // marker), return a small default doc WITH headings — the same "yield a parseable
  // object offline" precedent as the form-router default, so a real 生成文档 click stays
  // deterministic without a live provider.
  async completeStructured(request: StructuredRequest): Promise<{ json: string }> {
    if (request.sample !== undefined) return { json: JSON.stringify(request.sample) };
    if (request.contentType === FORM_ROUTER_CONTENT_TYPE) {
      return { json: JSON.stringify({ form: "markdown", markdown: "" }) };
    }
    if (request.messages.some((message) => messageText(message.content).includes(SYNTHESIS_PROMPT_MARKER))) {
      return { json: JSON.stringify(defaultSynthesisDoc(request.messages)) };
    }
    return { json: JSON.stringify({}) };
  }
}
