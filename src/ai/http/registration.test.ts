import { describe, expect, it, vi } from "vitest";

// Constructing the http providers never touches the vendor SDKs (models are
// built lazily on first complete()/stream()), but mock both anyway so no path
// in this file could ever reach a real vendor (same defensive stance as
// cliAgent/registration.test.ts).
vi.mock("@ai-sdk/deepseek", () => ({ createDeepSeek: vi.fn() }));
vi.mock("@ai-sdk/openai-compatible", () => ({ createOpenAICompatible: vi.fn() }));

// Importing ../index registers all built-ins at module scope.
import { createModelProvider, createRegisteredProvider, listProviderDescriptors } from "../index";
import { AiSdkProvider } from "./aiSdkProvider";

describe("registry — http BYOK presets (A3a registrations)", () => {
  it("lists the two new descriptors with the agreed ids, kind, and labels", () => {
    const byId = new Map(listProviderDescriptors().map((d) => [d.id, d]));
    expect(byId.get("deepseek")).toEqual({ id: "deepseek", kind: "http", label: "DeepSeek (BYOK)" });
    expect(byId.get("openai-compatible")).toEqual({
      id: "openai-compatible",
      kind: "http",
      label: "OpenAI-compatible (BYOK)"
    });
  });

  it("keeps every prior kind registered and the mock default untouched", () => {
    const ids = listProviderDescriptors().map((d) => d.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "mock",
        "claude-cli",
        "claude-pty",
        "claude-agent",
        "codex",
        "deepseek",
        "openai-compatible",
        "managed"
      ])
    );
    expect(createModelProvider({}).id).toBe("mock");
  });

  it("createRegisteredProvider returns AiSdkProvider instances for both entries", () => {
    const deepseek = createRegisteredProvider("deepseek", { env: {} });
    const compatible = createRegisteredProvider("openai-compatible", { env: {} });
    expect(deepseek).toBeInstanceOf(AiSdkProvider);
    expect(deepseek.id).toBe("deepseek");
    expect(compatible).toBeInstanceOf(AiSdkProvider);
    expect(compatible.id).toBe("openai-compatible");
  });

  it("STUDY_VAULT_AI_PROVIDER selects the new ids (case-insensitively, like every entry)", () => {
    expect(createModelProvider({ STUDY_VAULT_AI_PROVIDER: "deepseek" })).toBeInstanceOf(AiSdkProvider);
    expect(createModelProvider({ STUDY_VAULT_AI_PROVIDER: "OpenAI-Compatible" })).toBeInstanceOf(AiSdkProvider);
  });

  it("the presets advertise the A3a http capability row through the registry", () => {
    const provider = createModelProvider({ STUDY_VAULT_AI_PROVIDER: "deepseek" });
    expect(provider.capabilities).toEqual({
      chat: true,
      agentic: false,
      streaming: true,
      structured: true,
      tools: false,
      kind: "http"
    });
  });
});
