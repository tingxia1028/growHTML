import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The vendor SDK modules are mocked at the module boundary — the presets load
// them via a lazy dynamic import(), which vitest intercepts (same pattern as
// cliAgent/claude.test.ts). The `ai` core stays REAL and runs against a fake
// model, so no test ever touches the network, and "the SDK was never even
// imported" is observable through the factory spies.
const { createDeepSeekMock, deepseekModelFactory, createOpenAICompatibleMock, openAiCompatibleModelFactory } =
  vi.hoisted(() => ({
    createDeepSeekMock: vi.fn(),
    deepseekModelFactory: vi.fn(),
    createOpenAICompatibleMock: vi.fn(),
    openAiCompatibleModelFactory: vi.fn()
  }));
vi.mock("@ai-sdk/deepseek", () => ({ createDeepSeek: createDeepSeekMock }));
vi.mock("@ai-sdk/openai-compatible", () => ({ createOpenAICompatible: createOpenAICompatibleMock }));

import type { ChatRequest } from "../provider";
import { AiSdkProvider } from "./aiSdkProvider";
import {
  DEFAULT_DEEPSEEK_MODEL,
  HttpProviderNotConfiguredError,
  makeDeepSeekProvider,
  makeOpenAiCompatibleProvider
} from "./presets";

function fakeModel(text: string): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 }
      },
      warnings: []
    }
  });
}

const ask: ChatRequest = { messages: [{ role: "user", content: "hello" }] };

beforeEach(() => {
  createDeepSeekMock.mockReset();
  deepseekModelFactory.mockReset();
  createOpenAICompatibleMock.mockReset();
  openAiCompatibleModelFactory.mockReset();
  deepseekModelFactory.mockImplementation((_modelId: string) => fakeModel("deepseek says hi"));
  createDeepSeekMock.mockImplementation((_settings: unknown) => deepseekModelFactory);
  openAiCompatibleModelFactory.mockImplementation((_modelId: string) => fakeModel("compatible says hi"));
  createOpenAICompatibleMock.mockImplementation((_settings: unknown) => openAiCompatibleModelFactory);
});

describe("deepseek preset — config gating (mirrors ManagedNotConfiguredError semantics)", () => {
  it("constructs fine without env; FIRST USE throws the typed error naming DEEPSEEK_API_KEY, before any SDK construction", async () => {
    const provider = makeDeepSeekProvider({});
    expect(provider).toBeInstanceOf(AiSdkProvider); // registration/pickers never throw

    await expect(provider.complete(ask)).rejects.toBeInstanceOf(HttpProviderNotConfiguredError);
    await expect(provider.complete(ask)).rejects.toThrow(/DEEPSEEK_API_KEY/);
    expect(createDeepSeekMock).not.toHaveBeenCalled(); // gate sits BEFORE the vendor SDK import
    expect(deepseekModelFactory).not.toHaveBeenCalled(); // …and before model construction
  });

  it("gates stream() and completeStructured() identically", async () => {
    const provider = makeDeepSeekProvider({});
    await expect(
      (async () => {
        for await (const chunk of provider.stream(ask)) void chunk;
      })()
    ).rejects.toBeInstanceOf(HttpProviderNotConfiguredError);
    await expect(provider.completeStructured({ messages: ask.messages, contentType: "note" })).rejects.toBeInstanceOf(
      HttpProviderNotConfiguredError
    );
    expect(createDeepSeekMock).not.toHaveBeenCalled();
  });

  it("with DEEPSEEK_API_KEY set, wires the key through and defaults the model id (free text, not an enum)", async () => {
    const provider = makeDeepSeekProvider({ DEEPSEEK_API_KEY: "sk-ds-test" });
    const response = await provider.complete(ask);

    expect(response.message.content).toBe("deepseek says hi");
    expect(createDeepSeekMock).toHaveBeenCalledWith({ apiKey: "sk-ds-test" });
    expect(deepseekModelFactory).toHaveBeenCalledWith(DEFAULT_DEEPSEEK_MODEL);
    expect(DEFAULT_DEEPSEEK_MODEL).toBe("deepseek-v4-flash");
  });

  it("DEEPSEEK_MODEL overrides the model id as free text", async () => {
    const provider = makeDeepSeekProvider({ DEEPSEEK_API_KEY: "sk", DEEPSEEK_MODEL: "deepseek-reasoner-v5" });
    await provider.complete(ask);
    expect(deepseekModelFactory).toHaveBeenCalledWith("deepseek-reasoner-v5");
  });

  it("descriptor identity: id/label match the registry entry", () => {
    const provider = makeDeepSeekProvider({});
    expect(provider.id).toBe("deepseek");
    expect(provider.label).toBe("DeepSeek (BYOK)");
  });
});

describe("openai-compatible preset — one entry for the whole §3.4 long tail", () => {
  it("unconfigured: the typed error names EXACTLY the missing env vars", async () => {
    await expect(makeOpenAiCompatibleProvider({}).complete(ask)).rejects.toThrow(
      /OPENAI_COMPATIBLE_BASE_URL and OPENAI_COMPATIBLE_MODEL/
    );
    await expect(
      makeOpenAiCompatibleProvider({ OPENAI_COMPATIBLE_BASE_URL: "http://localhost:11434/v1" }).complete(ask)
    ).rejects.toThrow(/set OPENAI_COMPATIBLE_MODEL/);
    expect(createOpenAICompatibleMock).not.toHaveBeenCalled();
  });

  it("the gating error is the shared typed class with a stable name", async () => {
    const error = await makeOpenAiCompatibleProvider({})
      .complete(ask)
      .then(
        () => null,
        (e: unknown) => e
      );
    expect(error).toBeInstanceOf(HttpProviderNotConfiguredError);
    expect((error as Error).name).toBe("HttpProviderNotConfiguredError");
  });

  it("keyless endpoints (Ollama & friends): baseURL + model suffice, and NO apiKey is passed", async () => {
    const provider = makeOpenAiCompatibleProvider({
      OPENAI_COMPATIBLE_BASE_URL: "http://localhost:11434/v1",
      OPENAI_COMPATIBLE_MODEL: "llama4:8b"
    });
    const response = await provider.complete(ask);

    expect(response.message.content).toBe("compatible says hi");
    expect(createOpenAICompatibleMock).toHaveBeenCalledTimes(1);
    const settings = createOpenAICompatibleMock.mock.calls[0][0] as Record<string, unknown>;
    expect(settings).toEqual({ name: "openai-compatible", baseURL: "http://localhost:11434/v1" });
    expect(settings).not.toHaveProperty("apiKey"); // no Authorization header at all
    expect(openAiCompatibleModelFactory).toHaveBeenCalledWith("llama4:8b");
  });

  it("with OPENAI_COMPATIBLE_API_KEY the key is passed through (OpenRouter/SiliconFlow/…)", async () => {
    const provider = makeOpenAiCompatibleProvider({
      OPENAI_COMPATIBLE_BASE_URL: "https://openrouter.ai/api/v1",
      OPENAI_COMPATIBLE_MODEL: "deepseek/deepseek-v4",
      OPENAI_COMPATIBLE_API_KEY: "sk-or-test"
    });
    await provider.complete(ask);
    expect(createOpenAICompatibleMock).toHaveBeenCalledWith({
      name: "openai-compatible",
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: "sk-or-test"
    });
    expect(openAiCompatibleModelFactory).toHaveBeenCalledWith("deepseek/deepseek-v4");
  });

  it("descriptor identity: id/label match the registry entry", () => {
    const provider = makeOpenAiCompatibleProvider({});
    expect(provider.id).toBe("openai-compatible");
    expect(provider.label).toBe("OpenAI-compatible (BYOK)");
  });
});
