import { describe, expect, it } from "vitest";
import { buildSubprocessEnv, ClaudeCliProvider, createModelProvider, MockModelProvider } from "./index";

describe("MockModelProvider", () => {
  it("produces a deterministic study answer that references context", async () => {
    const provider = new MockModelProvider();
    const response = await provider.complete({
      messages: [{ role: "user", content: "What is this about?" }],
      context: { sourceTitle: "Render Thread", quote: "Render Thread submits rendering commands." }
    });
    expect(response.message.role).toBe("assistant");
    expect(response.message.content).toContain("What is this about?");
    expect(response.message.content).toContain("Render Thread");
    expect(response.message.content).toContain("Render Thread submits rendering commands.");

    // Deterministic: same input → same output.
    const again = await provider.complete({
      messages: [{ role: "user", content: "What is this about?" }],
      context: { sourceTitle: "Render Thread", quote: "Render Thread submits rendering commands." }
    });
    expect(again.message.content).toBe(response.message.content);
  });

  it("W2: echoes the 'Attached: N source(s)' marker when the chat carries attachments", async () => {
    const provider = new MockModelProvider();
    const response = await provider.complete({
      messages: [{ role: "user", content: "Compare these." }],
      context: {
        sources: [
          { title: "Alpha", type: "article", excerpt: "Alpha body.", notes: [{ contentType: "markdown", text: "note A" }] },
          { title: "Beta", type: "pdf", excerpt: "Beta body." }
        ]
      }
    });
    // The count marker proves the widened ChatContext.sources reached the prompt.
    expect(response.message.content).toContain("Attached: 2 source(s)");
    expect(response.message.content).toContain("[1] Alpha (article)");
    expect(response.message.content).toContain("note A");
    expect(response.message.content).toContain("[2] Beta (pdf)");
  });

  it("W2: a ZERO-attachment reply is byte-identical to the flat-context reply", async () => {
    const provider = new MockModelProvider();
    const flat = {
      messages: [{ role: "user" as const, content: "What is this?" }],
      context: { sourceTitle: "Render Thread", quote: "submits rendering commands" }
    };
    const withEmptySources = { ...flat, context: { ...flat.context, sources: [] } };
    const a = (await provider.complete(flat)).message.content;
    const b = (await provider.complete(withEmptySources)).message.content;
    expect(a).toBe(b);
    expect(a).not.toContain("Attached:");
  });

  it("declares the streaming capability", () => {
    expect(new MockModelProvider().capabilities.streaming).toBe(true);
  });

  it("declares honest Phase 0 capabilities (structured echo, no app tools, kind mock)", () => {
    expect(new MockModelProvider().capabilities).toEqual({
      chat: true,
      agentic: false,
      streaming: true,
      structured: true,
      tools: false,
      kind: "mock"
    });
  });

  it("streams the answer in multiple chunks that rejoin to the one-shot reply", async () => {
    const provider = new MockModelProvider();
    const request = {
      messages: [{ role: "user" as const, content: "What is this about?" }],
      context: { sourceTitle: "Render Thread", quote: "Render Thread submits rendering commands." }
    };

    const chunks: string[] = [];
    for await (const chunk of provider.stream!(request)) chunks.push(chunk);

    // Progressive: more than one chunk arrives.
    expect(chunks.length).toBeGreaterThan(1);
    // Deterministic + byte-identical: the concatenation equals `complete()`'s reply.
    const full = (await provider.complete(request)).message.content;
    expect(chunks.join("")).toBe(full);
  });
});

describe("buildSubprocessEnv", () => {
  it("strips the metered API key in subscription mode", () => {
    const env = buildSubprocessEnv({ ANTHROPIC_API_KEY: "sk-secret", ANTHROPIC_AUTH_TOKEN: "tok", PATH: "/usr/bin" }, true);
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(env.PATH).toBe("/usr/bin");
  });

  it("keeps the API key when subscription mode is off", () => {
    const env = buildSubprocessEnv({ ANTHROPIC_API_KEY: "sk-secret" }, false);
    expect(env.ANTHROPIC_API_KEY).toBe("sk-secret");
  });
});

describe("createModelProvider", () => {
  it("defaults to the mock provider", () => {
    expect(createModelProvider({}).id).toBe("mock");
  });

  it("selects the Claude CLI provider when configured", () => {
    const provider = createModelProvider({ STUDY_VAULT_AI_PROVIDER: "claude-cli" });
    expect(provider).toBeInstanceOf(ClaudeCliProvider);
    expect(provider.capabilities.agentic).toBe(true);
    // cli-agent honesty: the binary runs ITS OWN tools; no app tools, no native JSON mode.
    expect(provider.capabilities).toMatchObject({ kind: "cli-agent", tools: false, structured: false });
  });

  it("selects the PTY provider when configured (without loading node-pty)", () => {
    const provider = createModelProvider({ STUDY_VAULT_AI_PROVIDER: "claude-pty" });
    expect(provider.id).toBe("claude-pty");
    expect(provider.capabilities.agentic).toBe(true);
    expect(provider.capabilities).toMatchObject({ kind: "cli-agent", tools: false, structured: false });
  });

  it("falls back to the mock for an unknown provider value (unchanged behavior)", () => {
    expect(createModelProvider({ STUDY_VAULT_AI_PROVIDER: "does-not-exist" }).id).toBe("mock");
  });
});
