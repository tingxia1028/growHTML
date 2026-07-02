import { describe, expect, it, vi } from "vitest";

// Constructing the adapters never touches the vendor SDKs (they are loaded
// lazily on first complete()/stream()), but mock both anyway so no path in
// this file could ever reach a real CLI.
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query: vi.fn() }));
vi.mock("@openai/codex-sdk", () => ({ Codex: class {} }));

// Importing ../index registers all built-ins at module scope.
import { createModelProvider, createRegisteredProvider, listProviderDescriptors } from "../index";
import { ClaudeAgentProvider } from "./claude";
import { CodexAgentProvider } from "./codex";

describe("registry — cli-agent SDK adapters (A2 registrations)", () => {
  it("lists the two new descriptors with the agreed ids and labels", () => {
    const byId = new Map(listProviderDescriptors().map((d) => [d.id, d]));
    expect(byId.get("claude-agent")).toEqual({
      id: "claude-agent",
      kind: "cli-agent",
      label: "Claude (subscription, Agent SDK)"
    });
    expect(byId.get("codex")).toEqual({
      id: "codex",
      kind: "cli-agent",
      label: "Codex (ChatGPT subscription)"
    });
  });

  it("keeps the legacy fallbacks and the mock default untouched", () => {
    const ids = listProviderDescriptors().map((d) => d.id);
    expect(ids).toEqual(expect.arrayContaining(["mock", "claude-cli", "claude-pty", "claude-agent", "codex"]));
    expect(createModelProvider({}).id).toBe("mock");
  });

  it("createRegisteredProvider returns the SDK adapters", () => {
    expect(createRegisteredProvider("claude-agent", { env: {} })).toBeInstanceOf(ClaudeAgentProvider);
    expect(createRegisteredProvider("codex", { env: {} })).toBeInstanceOf(CodexAgentProvider);
  });

  it("STUDY_VAULT_AI_PROVIDER selects the new ids (case-insensitively, like every entry)", () => {
    expect(createModelProvider({ STUDY_VAULT_AI_PROVIDER: "claude-agent" })).toBeInstanceOf(ClaudeAgentProvider);
    expect(createModelProvider({ STUDY_VAULT_AI_PROVIDER: "codex" })).toBeInstanceOf(CodexAgentProvider);
    expect(createModelProvider({ STUDY_VAULT_AI_PROVIDER: "CODEX" })).toBeInstanceOf(CodexAgentProvider);
  });

  it("the adapters advertise the cli-agent kind through the registry context env", () => {
    const provider = createModelProvider({ STUDY_VAULT_AI_PROVIDER: "claude-agent" });
    expect(provider.capabilities).toMatchObject({ kind: "cli-agent", streaming: true, tools: false });
  });
});
