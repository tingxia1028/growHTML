// http kind presets (A3a) — the concrete BYOK vendor entries behind the ONE
// AiSdkProvider engine (docs/design/multi-provider-ai-agent.md §3.1/§3.4/§9.4:
// plugin-shaped, core-shipped registry data; "add a vendor" = configuration).
// Two entries cover the MVP ground:
//
//   deepseek           — @ai-sdk/deepseek native adapter (§7 open decision 1's
//                        recommended first vendor).
//   openai-compatible  — @ai-sdk/openai-compatible generic adapter; ONE entry
//                        covers the whole §3.4 long tail (OpenRouter, Ollama,
//                        LM Studio, SiliconFlow, vLLM, Together, …) via
//                        baseURL + optional key + model id.
//
// Config source is ENV for this slice, mirroring the managed entry's gating
// semantic (ManagedNotConfiguredError): register ALWAYS so pickers list the
// entry, construct fine unconfigured, and throw a typed
// HttpProviderNotConfiguredError on FIRST USE — before any vendor SDK import,
// model construction, or network. A3b replaces the env reads with stored
// config (ai-providers.json) + safeStorage-encrypted keys; the gate itself
// (and its error type) stays.
//
// Model ids are FREE TEXT with a default, never an enum — ids drift (§3.1).

import type { LanguageModel } from "ai";
import { AiSdkProvider } from "./aiSdkProvider";

/**
 * A BYOK http provider was selected but its config is missing. Named after —
 * and gated exactly like — ManagedNotConfiguredError: thrown on first use,
 * before any SDK/model construction, naming the exact env vars to set.
 */
export class HttpProviderNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HttpProviderNotConfiguredError";
  }
}

/** Free-text default only — override with DEEPSEEK_MODEL (§3.1: ids drift). */
export const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash";

function readEnv(env: NodeJS.ProcessEnv, key: string): string {
  return env[key]?.trim() ?? "";
}

/** DeepSeek (BYOK): DEEPSEEK_API_KEY (required) + DEEPSEEK_MODEL (optional). */
export function makeDeepSeekProvider(env: NodeJS.ProcessEnv): AiSdkProvider {
  return new AiSdkProvider({
    id: "deepseek",
    label: "DeepSeek (BYOK)",
    makeModel: async (): Promise<LanguageModel> => {
      const apiKey = readEnv(env, "DEEPSEEK_API_KEY");
      if (!apiKey) {
        throw new HttpProviderNotConfiguredError(
          "DeepSeek (BYOK) is not configured — set DEEPSEEK_API_KEY " +
            "(and optionally DEEPSEEK_MODEL) to use it (A3b: app settings + keychain)"
        );
      }
      const { createDeepSeek } = await import("@ai-sdk/deepseek");
      return createDeepSeek({ apiKey })(readEnv(env, "DEEPSEEK_MODEL") || DEFAULT_DEEPSEEK_MODEL);
    }
  });
}

/**
 * OpenAI-compatible (BYOK): OPENAI_COMPATIBLE_BASE_URL + OPENAI_COMPATIBLE_MODEL
 * (both required — there is no sane default endpoint or model for "anything
 * OpenAI-shaped"), plus OPENAI_COMPATIBLE_API_KEY (optional: keyless local
 * endpoints like Ollama/LM Studio omit it and no Authorization header is sent).
 */
export function makeOpenAiCompatibleProvider(env: NodeJS.ProcessEnv): AiSdkProvider {
  return new AiSdkProvider({
    id: "openai-compatible",
    label: "OpenAI-compatible (BYOK)",
    makeModel: async (): Promise<LanguageModel> => {
      const baseURL = readEnv(env, "OPENAI_COMPATIBLE_BASE_URL");
      const modelId = readEnv(env, "OPENAI_COMPATIBLE_MODEL");
      const missing = [baseURL ? "" : "OPENAI_COMPATIBLE_BASE_URL", modelId ? "" : "OPENAI_COMPATIBLE_MODEL"].filter(
        Boolean
      );
      if (missing.length > 0) {
        throw new HttpProviderNotConfiguredError(
          `OpenAI-compatible (BYOK) is not configured — set ${missing.join(" and ")} ` +
            "(OPENAI_COMPATIBLE_API_KEY is optional for keyless endpoints; A3b: app settings + keychain)"
        );
      }
      const apiKey = readEnv(env, "OPENAI_COMPATIBLE_API_KEY");
      const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible");
      return createOpenAICompatible({
        name: "openai-compatible",
        baseURL,
        ...(apiKey ? { apiKey } : {})
      })(modelId);
    }
  });
}
