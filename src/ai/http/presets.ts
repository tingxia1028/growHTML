// http kind presets (A3a env selection + A3b stored config) — the concrete BYOK
// vendor entries behind the ONE AiSdkProvider engine
// (docs/design/multi-provider-ai-agent.md §3.1/§3.4/§9.4: plugin-shaped,
// core-shipped registry data; "add a vendor" = configuration). Two presets cover
// the MVP ground:
//
//   deepseek           — @ai-sdk/deepseek native adapter (§7 open decision 1's
//                        recommended first vendor).
//   openai-compatible  — @ai-sdk/openai-compatible generic adapter; ONE entry
//                        covers the whole §3.4 long tail (OpenRouter, Ollama,
//                        LM Studio, SiliconFlow, vLLM, Together, …) via
//                        baseURL + optional key + model id.
//
// TWO construction paths share the same model builders:
//   makeDeepSeekProvider / makeOpenAiCompatibleProvider — the A3a ENV path, kept
//     byte-identical (registry entries; env vars are the working fallback).
//   makeHttpProviderFromSettings — the A3b CONFIG path: a stored ai-providers.json
//     entry (id/preset/baseUrl/model) plus a lazily-resolved key. The key arrives
//     through an injected async `getApiKey` (the server wires the KeyStore→env
//     chain there), so this module stays pure (iron rule: src/ai imports nothing
//     from the server).
//
// Gating semantic (both paths, mirroring ManagedNotConfiguredError): register/
// construct fine unconfigured, throw a typed HttpProviderNotConfiguredError on
// FIRST USE — before any vendor SDK import, model construction, or network.
//
// Model ids are FREE TEXT with a default, never an enum — ids drift (§3.1).

import type { LanguageModel } from "ai";
import { AiSdkProvider } from "./aiSdkProvider";

/**
 * A BYOK http provider was selected but its config is missing. Named after —
 * and gated exactly like — ManagedNotConfiguredError: thrown on first use,
 * before any SDK/model construction, naming exactly what to set.
 */
export class HttpProviderNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HttpProviderNotConfiguredError";
  }
}

/** Free-text default only — override with DEEPSEEK_MODEL / the config entry's model (§3.1: ids drift). */
export const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash";

/** Per-preset API-key env var — the tail of the KeyStore→env fallback chain. */
export const HTTP_PRESET_ENV_KEYS = {
  deepseek: "DEEPSEEK_API_KEY",
  "openai-compatible": "OPENAI_COMPATIBLE_API_KEY"
} as const;

export type HttpPresetId = keyof typeof HTTP_PRESET_ENV_KEYS;

export function isHttpPresetId(value: string): value is HttpPresetId {
  return value in HTTP_PRESET_ENV_KEYS;
}

function readEnv(env: NodeJS.ProcessEnv, key: string): string {
  return env[key]?.trim() ?? "";
}

// —— shared vendor-model builders (the only place the vendor SDKs are imported) ——

async function buildDeepSeekModel(args: { apiKey: string; model: string; baseUrl?: string }): Promise<LanguageModel> {
  const { createDeepSeek } = await import("@ai-sdk/deepseek");
  return createDeepSeek({ apiKey: args.apiKey, ...(args.baseUrl ? { baseURL: args.baseUrl } : {}) })(args.model);
}

async function buildOpenAiCompatibleModel(args: {
  baseUrl: string;
  model: string;
  apiKey?: string;
}): Promise<LanguageModel> {
  const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible");
  return createOpenAICompatible({
    name: "openai-compatible",
    baseURL: args.baseUrl,
    ...(args.apiKey ? { apiKey: args.apiKey } : {})
  })(args.model);
}

// —— A3a env path (byte-identical fallback; registry entries) ————————————————

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
            "(and optionally DEEPSEEK_MODEL), or add a DeepSeek provider in 设置 → AI 提供方"
        );
      }
      return buildDeepSeekModel({ apiKey, model: readEnv(env, "DEEPSEEK_MODEL") || DEFAULT_DEEPSEEK_MODEL });
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
            "(OPENAI_COMPATIBLE_API_KEY is optional for keyless endpoints), " +
            "or add a provider in 设置 → AI 提供方"
        );
      }
      const apiKey = readEnv(env, "OPENAI_COMPATIBLE_API_KEY");
      return buildOpenAiCompatibleModel({ baseUrl: baseURL, model: modelId, ...(apiKey ? { apiKey } : {}) });
    }
  });
}

// —— A3b config path (stored ai-providers.json entries) ——————————————————————

/**
 * One stored BYOK provider instance, resolved lazily. `getApiKey` is the
 * injected KeyStore→env chain (returns null/"" when no key is available
 * anywhere); everything else mirrors the ai-providers.json entry fields.
 */
export type HttpProviderSettings = {
  /** Config entry id (e.g. "deepseek-1") — becomes the ModelProvider id. */
  id: string;
  /** User-facing name; defaults to the preset's label. */
  label?: string;
  preset: HttpPresetId;
  baseUrl?: string;
  /** Free-text model id; deepseek defaults to DEFAULT_DEEPSEEK_MODEL. */
  model?: string;
  /** Async key resolution (KeyStore→env chain), run on FIRST use only. */
  getApiKey: () => Promise<string | null>;
};

/**
 * Build the AiSdkProvider for a stored config entry. Construction never
 * validates anything (pickers/readouts must not throw); the first call gates:
 * missing key / missing endpoint fields reject with the typed
 * HttpProviderNotConfiguredError naming BOTH fixes (settings UI + env var).
 */
export function makeHttpProviderFromSettings(settings: HttpProviderSettings): AiSdkProvider {
  const envKey = HTTP_PRESET_ENV_KEYS[settings.preset];

  if (settings.preset === "deepseek") {
    const label = settings.label ?? "DeepSeek (BYOK)";
    return new AiSdkProvider({
      id: settings.id,
      label,
      makeModel: async (): Promise<LanguageModel> => {
        const apiKey = (await settings.getApiKey())?.trim() ?? "";
        if (!apiKey) {
          throw new HttpProviderNotConfiguredError(
            `${label}（${settings.id}）未配置密钥 — 在 设置 → AI 提供方 保存 API 密钥，或设置环境变量 ${envKey}`
          );
        }
        return buildDeepSeekModel({
          apiKey,
          model: settings.model?.trim() || DEFAULT_DEEPSEEK_MODEL,
          ...(settings.baseUrl?.trim() ? { baseUrl: settings.baseUrl.trim() } : {})
        });
      }
    });
  }

  const label = settings.label ?? "OpenAI-compatible (BYOK)";
  return new AiSdkProvider({
    id: settings.id,
    label,
    makeModel: async (): Promise<LanguageModel> => {
      const baseUrl = settings.baseUrl?.trim() ?? "";
      const model = settings.model?.trim() ?? "";
      const missing = [baseUrl ? "" : "Base URL", model ? "" : "模型"].filter(Boolean);
      if (missing.length > 0) {
        throw new HttpProviderNotConfiguredError(
          `${label}（${settings.id}）缺少 ${missing.join(" 和 ")} — 在 设置 → AI 提供方 编辑该提供方补全`
        );
      }
      const apiKey = (await settings.getApiKey())?.trim() ?? "";
      return buildOpenAiCompatibleModel({ baseUrl, model, ...(apiKey ? { apiKey } : {}) });
    }
  });
}
