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
  });

  it("selects the PTY provider when configured (without loading node-pty)", () => {
    const provider = createModelProvider({ STUDY_VAULT_AI_PROVIDER: "claude-pty" });
    expect(provider.id).toBe("claude-pty");
    expect(provider.capabilities.agentic).toBe(true);
  });
});
