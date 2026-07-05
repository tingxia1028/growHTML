// AI provider config + resolution service (A3b — docs/design/multi-provider-ai-agent.md
// §4.2/§5 Phase 1): the APP-LEVEL ai-providers.json (selection + non-secret BYOK
// config follows the user across vaults — same injectable-dir precedent as the
// svpack identityDir), read/written with the vault.storage atomic-JSON idiom, plus
// the provider-resolution chain the routes and the chat/kits endpoints consult.
//
// Layout on disk (both under ONE app config dir, ~/.growte by default):
//   ai-providers.json      — { activeProviderId, providers: [...] }   NO keys, ever
//   ai-provider-keys.json  — safeStorage CIPHERTEXT blobs, keyed by keyRef
//                            (owned by src/server/keyStore.ts; never this file)
//
// Field-group ownership (the M1 plugin-prefs / SHELL-2 workspace.json lesson —
// single-writer-per-field-group, merged against the STORED file):
//   PUT /api/ai/providers/config  → owns `providers` (the list editor). The stored
//                                   activeProviderId is preserved, and each entry's
//                                   stored keyRef is re-attached by id — keyRef is
//                                   SERVER-owned (set by the key routes only), so a
//                                   stale list PUT can never detach a saved key.
//   PUT /api/ai/providers/active  → owns `activeProviderId` (the picker).
//   PUT/DELETE …/:id/key          → owns that entry's keyRef + the ciphertext blob.
//
// Resolution precedence (explicit-beats-config, §4.2 "env remains a fallback"):
//   1. modelProvider injected into createApp        → always it        (tests)
//   2. STUDY_VAULT_AI_PROVIDER env set (non-empty)  → that registry id ("env")
//   3. config activeProviderId                      → config entry, or a plain
//      registry id ("config")
//   4. otherwise                                    → createModelProvider(env)
//      ("default" — byte-identical legacy behavior, mock)
// Keys resolve through the KeyStore→env chain: keyRef blob first, then the
// preset's env var (DEEPSEEK_API_KEY / OPENAI_COMPATIBLE_API_KEY).

import os from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  claudeAgentSpec,
  codexAgentSpec,
  createModelProvider,
  createRegisteredProvider,
  HTTP_PRESET_ENV_KEYS,
  isHttpPresetId,
  listProviderDescriptors,
  makeHttpProviderFromSettings,
  ManagedProvider,
  type CliAgentDetectResult,
  type ModelProvider,
  type ProviderCapabilities
} from "../../ai";
import { nodeStorage } from "../../core/storage/nodeStorage";
import type { StorageAdapter } from "../../core/storage/adapter";
import type { KeyStore } from "../keyStore";
import { createDefaultKeyStore, EnvOnlyKeyStore } from "../keyStore";
import { NotFoundError, ValidationError } from "./errors";

export const AI_PROVIDERS_FILE = "ai-providers.json";
export const AI_PROVIDER_KEYS_FILE = "ai-provider-keys.json";

/** App-level config home (NOT a vault — keys/model choice follow the user, §4.2). */
export function defaultAiConfigDir(): string {
  return path.join(os.homedir(), ".growte");
}

// —— schemas: the FILE format doubles as the PUT body shape (workspace.ts idiom) ——

const entryFields = {
  /** Stable instance id, e.g. "deepseek-1". Must not shadow a registry id. */
  id: z.string().min(1),
  kind: z.enum(["mock", "cli-agent", "http", "managed"]),
  /**
   * What the entry resolves through: an http preset ("deepseek" /
   * "openai-compatible") for kind http, a registry id for the other kinds.
   */
  preset: z.string().min(1).optional(),
  label: z.string().optional(),
  /** http only; free text (localhost endpoints are not always valid URLs to zod). */
  baseUrl: z.string().optional(),
  /** Free text — model ids drift (§3.1). */
  model: z.string().optional()
};

/** PUT body entry — deliberately WITHOUT keyRef (server-owned; zod strips it). */
export const aiProviderEntryInputSchema = z.object(entryFields);
export type AiProviderEntryInput = z.infer<typeof aiProviderEntryInputSchema>;

/** Stored entry — adds the server-owned pointer into the ciphertext blob file. */
export const aiProviderEntrySchema = z.object({ ...entryFields, keyRef: z.string().min(1).optional() });
export type AiProviderEntry = z.infer<typeof aiProviderEntrySchema>;

export const aiProvidersConfigSchema = z.object({
  activeProviderId: z.string().nullable().default(null),
  providers: z.array(aiProviderEntrySchema).default([])
});
export type AiProvidersConfig = z.infer<typeof aiProvidersConfigSchema>;
export const emptyAiProvidersConfig: AiProvidersConfig = { activeProviderId: null, providers: [] };

export type AiProvidersDeps = {
  /** Directory holding ai-providers.json (+ the key blob file). Tests inject temp. */
  dir: string;
  keyStore: KeyStore;
  /** Injectable for tests; defaults to the shared Node adapter (atomic writes). */
  storage?: StorageAdapter;
};

const configPath = (deps: AiProvidersDeps) => path.join(deps.dir, AI_PROVIDERS_FILE);
const storageOf = (deps: AiProvidersDeps) => deps.storage ?? nodeStorage;

/**
 * Read → parse-or-default. An unreadable/invalid file degrades to the EMPTY
 * config with a human-readable error string (surfaced in the GET readout);
 * resolution then falls back to env/default — a broken config file must never
 * take chat down.
 */
export async function readAiProvidersConfig(
  deps: AiProvidersDeps
): Promise<{ config: AiProvidersConfig; error: string | null }> {
  const text = await storageOf(deps).readText(configPath(deps));
  if (!text) return { config: emptyAiProvidersConfig, error: null };
  try {
    return { config: aiProvidersConfigSchema.parse(JSON.parse(text)), error: null };
  } catch (error) {
    const detail = error instanceof Error ? error.message.split("\n")[0] : String(error);
    return { config: emptyAiProvidersConfig, error: `${AI_PROVIDERS_FILE} 无法解析（已回退环境变量选择）: ${detail}` };
  }
}

export async function writeAiProvidersConfig(deps: AiProvidersDeps, config: AiProvidersConfig): Promise<void> {
  await storageOf(deps).writeTextAtomic(configPath(deps), `${JSON.stringify(config, null, 2)}\n`);
}

// —— registry helpers ————————————————————————————————————————————————————————

function isRegistryId(id: string): boolean {
  const lowered = id.toLowerCase();
  return listProviderDescriptors().some((d) => d.id.toLowerCase() === lowered);
}

function validateProviderList(providers: AiProviderEntryInput[]): void {
  const seen = new Set<string>();
  for (const entry of providers) {
    const lowered = entry.id.toLowerCase();
    if (seen.has(lowered)) throw new ValidationError(`提供方 id 重复: "${entry.id}"`);
    seen.add(lowered);
    if (isRegistryId(entry.id)) {
      throw new ValidationError(`提供方 id "${entry.id}" 与内置提供方冲突，请换一个 id`);
    }
    if (entry.kind === "http") {
      if (!entry.preset || !isHttpPresetId(entry.preset)) {
        throw new ValidationError(
          `http 提供方 "${entry.id}" 的 preset "${entry.preset ?? ""}" 未知（支持: deepseek / openai-compatible）`
        );
      }
    } else if (!entry.preset || !isRegistryId(entry.preset)) {
      throw new ValidationError(`提供方 "${entry.id}" (kind ${entry.kind}) 需要 preset 指向一个内置提供方 id`);
    }
  }
}

// —— field-group writers (merge against the STORED file — never trust the body) ——

/**
 * The list editor's write: replaces `providers`, PRESERVES the stored
 * activeProviderId and every entry's stored keyRef (re-attached by id — a body
 * that smuggles keyRef is ignored: zod already stripped it). Keys of REMOVED
 * entries are deleted from the KeyStore (best-effort housekeeping). If the
 * active id no longer resolves anywhere (entry removed, not a registry id),
 * activeProviderId falls back to null rather than dangle.
 */
export async function writeProviderList(
  deps: AiProvidersDeps,
  providers: AiProviderEntryInput[]
): Promise<AiProvidersConfig> {
  validateProviderList(providers);
  const { config: stored } = await readAiProvidersConfig(deps);
  const storedById = new Map(stored.providers.map((entry) => [entry.id, entry]));
  const next: AiProviderEntry[] = providers.map((entry) => {
    const keyRef = storedById.get(entry.id)?.keyRef;
    return keyRef ? { ...entry, keyRef } : { ...entry };
  });

  const keptIds = new Set(providers.map((entry) => entry.id));
  for (const old of stored.providers) {
    if (!keptIds.has(old.id) && old.keyRef) {
      try {
        await deps.keyStore.deleteKey(old.keyRef);
      } catch {
        // best-effort: an undeletable orphan blob is harmless (unreachable ref)
      }
    }
  }

  const activeStillValid =
    stored.activeProviderId === null || keptIds.has(stored.activeProviderId) || isRegistryId(stored.activeProviderId);
  const merged: AiProvidersConfig = {
    activeProviderId: activeStillValid ? stored.activeProviderId : null,
    providers: next
  };
  await writeAiProvidersConfig(deps, merged);
  return merged;
}

/** The picker's write: owns ONLY activeProviderId; `providers` is preserved. */
export async function writeActiveProvider(
  deps: AiProvidersDeps,
  activeProviderId: string | null
): Promise<AiProvidersConfig> {
  const { config: stored } = await readAiProvidersConfig(deps);
  if (activeProviderId !== null) {
    const known = stored.providers.some((entry) => entry.id === activeProviderId) || isRegistryId(activeProviderId);
    if (!known) throw new ValidationError(`未知的提供方 id "${activeProviderId}"`);
  }
  const merged: AiProvidersConfig = { ...stored, activeProviderId };
  await writeAiProvidersConfig(deps, merged);
  return merged;
}

// —— key writes (own their field group: the entry's keyRef + the blob) ————————

/** Persist a BYOK key for a config entry. Throws KeyNotPersistableError in env-only mode. */
export async function setProviderKey(deps: AiProvidersDeps, entryId: string, apiKey: string): Promise<void> {
  const { config: stored } = await readAiProvidersConfig(deps);
  const entry = stored.providers.find((candidate) => candidate.id === entryId);
  if (!entry) throw new NotFoundError(`提供方 "${entryId}" 不存在于 ${AI_PROVIDERS_FILE}`);
  if (entry.kind !== "http") {
    throw new ValidationError(`提供方 "${entryId}"（kind ${entry.kind}）不使用 API 密钥`);
  }
  const keyRef = entry.keyRef ?? `key_${entry.id}`;
  await deps.keyStore.setKey(keyRef, apiKey);
  if (entry.keyRef !== keyRef) {
    await writeAiProvidersConfig(deps, {
      ...stored,
      providers: stored.providers.map((candidate) => (candidate.id === entryId ? { ...candidate, keyRef } : candidate))
    });
  }
}

// —— managed session token (G-A3b, blocker 1) ————————————————————————————————
//
// The managed session is a BEARER SECRET (access + refresh). It rides the SAME
// safeStorage keychain the BYOK API keys use (SafeStorageKeyStore → encrypted
// base64 in ai-provider-keys.json), NEVER `ai-providers.json` and NEVER any JSON
// in plaintext. In EnvOnlyKeyStore mode (dev/web/vitest) setKey throws
// KeyNotPersistableError — login-persist is packaged-desktop-only, exactly like a
// BYOK key; the provider then falls back to env.STUDY_VAULT_MANAGED_TOKEN. The
// pair is stored as ONE JSON blob under a fixed keyRef derived from the entry id.

/** The keychain ref the managed entry's {access,refresh} token pair is stored under. */
export function managedSessionKeyRef(entryId: string): string {
  return `managed_session_${entryId}`;
}

/** The stored session shape (access + refresh; refresh drives the settings-read refresh-on-401). */
export type ManagedSession = { accessToken: string; refreshToken?: string };

/**
 * Persist the managed session token pair (encrypted). Throws KeyNotPersistableError
 * in env-only mode — the route surfaces that as a typed 409 exactly like a BYOK key
 * save (the settings UI shows the "本模式下不可持久" affordance, never crashes).
 */
export async function setManagedSession(
  deps: AiProvidersDeps,
  entryId: string,
  session: ManagedSession
): Promise<void> {
  await deps.keyStore.setKey(managedSessionKeyRef(entryId), JSON.stringify(session));
}

/** Read the stored managed session (null when absent / env-only / undecryptable). */
export async function getManagedSession(deps: AiProvidersDeps, entryId: string): Promise<ManagedSession | null> {
  const raw = await deps.keyStore.getKey(managedSessionKeyRef(entryId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ManagedSession>;
    if (typeof parsed.accessToken !== "string" || parsed.accessToken.length === 0) return null;
    return {
      accessToken: parsed.accessToken,
      refreshToken: typeof parsed.refreshToken === "string" ? parsed.refreshToken : undefined
    };
  } catch {
    return null;
  }
}

/** Remove the stored managed session (logout). Idempotent; a no-op in env-only mode. */
export async function clearManagedSession(deps: AiProvidersDeps, entryId: string): Promise<void> {
  await deps.keyStore.deleteKey(managedSessionKeyRef(entryId));
}

/** Remove a stored key (blob + the entry's keyRef pointer). Idempotent. */
export async function deleteProviderKey(deps: AiProvidersDeps, entryId: string): Promise<void> {
  const { config: stored } = await readAiProvidersConfig(deps);
  const entry = stored.providers.find((candidate) => candidate.id === entryId);
  if (!entry) throw new NotFoundError(`提供方 "${entryId}" 不存在于 ${AI_PROVIDERS_FILE}`);
  if (entry.keyRef) {
    await deps.keyStore.deleteKey(entry.keyRef);
    await writeAiProvidersConfig(deps, {
      ...stored,
      providers: stored.providers.map((candidate) =>
        candidate.id === entryId ? { ...candidate, keyRef: undefined } : candidate
      )
    });
  }
}

// —— resolution ———————————————————————————————————————————————————————————————

export type ResolveDeps = {
  keyStore: KeyStore;
  env: NodeJS.ProcessEnv;
  /**
   * The managed session token pre-resolved from the keyStore (G-A3b, blocker 2).
   * providerForEntry stays SYNCHRONOUS (its http/configView/resolveActive callers
   * expect a sync build), so the async keyStore read happens in the caller and the
   * pair is threaded through here. Absent → the env token is the sole source.
   */
  managedSession?: ManagedSession | null;
};

/**
 * Construct the ModelProvider for ONE config entry. http entries resolve through
 * the preset factory with the KeyStore→env key chain; managed entries inject the
 * stored session token (falling back to env) + the stored/env gateway URL; every
 * other kind delegates to the registry under `preset`. Construction is cheap and
 * never touches a vendor SDK / the network — config gates throw typed errors on
 * FIRST USE (presets.ts / managed.ts requireConfig).
 */
export function providerForEntry(entry: AiProviderEntry, deps: ResolveDeps): ModelProvider {
  if (entry.kind === "http") {
    const preset = entry.preset ?? "";
    if (!isHttpPresetId(preset)) {
      throw new ValidationError(
        `http 提供方 "${entry.id}" 的 preset "${entry.preset ?? ""}" 未知（支持: deepseek / openai-compatible）`
      );
    }
    return makeHttpProviderFromSettings({
      id: entry.id,
      label: entry.label,
      preset,
      baseUrl: entry.baseUrl,
      model: entry.model,
      getApiKey: async () => {
        if (entry.keyRef) {
          const storedKey = await deps.keyStore.getKey(entry.keyRef);
          if (storedKey) return storedKey;
        }
        return deps.env[HTTP_PRESET_ENV_KEYS[preset]]?.trim() || null;
      }
    });
  }
  if (entry.kind === "managed") {
    // Token precedence: the STORED phone-login session (encrypted via keyStore)
    // beats env, which stays a dev/CI fallback (keeps managed.test.ts:324 green).
    // Read PER CALL so a login/logout under a long-lived provider is picked up
    // without reconstruction. baseUrl: the stored entry's, else the env URL — never
    // hardcoded (the token only ever rides to the configured gateway origin).
    const storedToken = deps.managedSession?.accessToken?.trim() || null;
    const gatewayBaseUrl = entry.baseUrl?.trim() || deps.env.STUDY_VAULT_MANAGED_GATEWAY_URL || "";
    return new ManagedProvider({
      gatewayBaseUrl,
      getSessionToken: () => storedToken ?? deps.env.STUDY_VAULT_MANAGED_TOKEN ?? null
    });
  }
  return createRegisteredProvider(entry.preset ?? entry.id, { env: deps.env });
}

export type ActiveSource = "injected" | "env" | "config" | "default";

export type ActiveResolution = {
  provider: ModelProvider;
  source: ActiveSource;
  /** Non-fatal config problems (unparseable file, dangling active id, bad preset). */
  configError: string | null;
};

export type AiProviderManagerOptions = {
  /** createApp's modelProvider injection — when set it ALWAYS wins (tests). */
  injected?: ModelProvider;
  /** Absent → stored config disabled; env-only selection, byte-identical legacy. */
  aiConfig?: { dir: string; keyStore?: KeyStore; storage?: StorageAdapter };
  /** Live env read (per resolution) so an env override is honored the way the boot read was. */
  env?: () => NodeJS.ProcessEnv;
};

export type AiProviderManager = {
  /** The provider every AI endpoint should use for THIS request. */
  getProvider(): Promise<ModelProvider>;
  /** getProvider plus where the choice came from (the GET readout). */
  resolveActive(): Promise<ActiveResolution>;
  /** Config/key state changed → drop the memoized instance (dispose if it can). */
  invalidate(): void;
  /** The key backend (an env-only stub when stored config is disabled). */
  getKeyStore(): Promise<KeyStore>;
  /** The service deps for the config routes; null when stored config is disabled. */
  getDeps(): Promise<AiProvidersDeps | null>;
  /**
   * Fresh, un-memoized construction for ONE id — config entry first, then a
   * registry id — used by the test-connection route so it exercises exactly the
   * named config (never the cached active instance). Unknown id → NotFoundError.
   */
  providerForId(id: string): Promise<ModelProvider>;
};

type Memo = { fingerprint: string; provider: ModelProvider } | null;

function disposeQuietly(provider: ModelProvider | undefined): void {
  const disposable = provider as { dispose?: () => unknown } | undefined;
  try {
    disposable?.dispose?.();
  } catch {
    // disposing a stale provider must never break a provider switch
  }
}

export function createAiProviderManager(options: AiProviderManagerOptions): AiProviderManager {
  const envOf = options.env ?? (() => process.env);

  // Legacy path (no stored config): the boot-time singleton, EXACTLY as before.
  const legacy = options.injected ?? (options.aiConfig ? null : createModelProvider(envOf()));

  let keyStorePromise: Promise<KeyStore> | null = null;
  const getKeyStore = (): Promise<KeyStore> => {
    if (!options.aiConfig) {
      return Promise.resolve(new EnvOnlyKeyStore("此服务器未启用应用级 AI 配置（无 aiConfig 目录）"));
    }
    if (!keyStorePromise) {
      keyStorePromise = options.aiConfig.keyStore
        ? Promise.resolve(options.aiConfig.keyStore)
        : createDefaultKeyStore(path.join(options.aiConfig.dir, AI_PROVIDER_KEYS_FILE));
    }
    return keyStorePromise;
  };

  const getDeps = async (): Promise<AiProvidersDeps | null> => {
    if (!options.aiConfig) return null;
    return { dir: options.aiConfig.dir, keyStore: await getKeyStore(), storage: options.aiConfig.storage };
  };

  let memo: Memo = null;
  const memoize = (fingerprint: string, make: () => ModelProvider): ModelProvider => {
    if (memo && memo.fingerprint === fingerprint) return memo.provider;
    disposeQuietly(memo?.provider);
    memo = { fingerprint, provider: make() };
    return memo.provider;
  };

  const resolveActive = async (): Promise<ActiveResolution> => {
    if (options.injected) return { provider: options.injected, source: "injected", configError: null };
    if (!options.aiConfig) return { provider: legacy as ModelProvider, source: "default", configError: null };

    const env = envOf();
    const deps = (await getDeps()) as AiProvidersDeps;
    const { config, error } = await readAiProvidersConfig(deps);
    let configError = error;

    // 1. Explicit env beats config (§4.2: STUDY_VAULT_AI_PROVIDER stays an override).
    const envChoice = env.STUDY_VAULT_AI_PROVIDER?.trim();
    if (envChoice) {
      return {
        provider: memoize(`env:${envChoice.toLowerCase()}`, () => createRegisteredProvider(envChoice, { env })),
        source: "env",
        configError
      };
    }

    // 2. Stored active choice: a config entry, or a plain registry id.
    if (config.activeProviderId) {
      const activeId = config.activeProviderId;
      const entry = config.providers.find((candidate) => candidate.id === activeId);
      if (entry) {
        try {
          // A managed entry's session (encrypted, keyStore) is pre-resolved so the
          // sync providerForEntry can thread it in; it also joins the memo
          // fingerprint so a login/logout re-resolves the provider instead of
          // serving a stale token instance.
          const managedSession = entry.kind === "managed" ? await getManagedSession(deps, entry.id) : null;
          const fingerprint = `config:${JSON.stringify(entry)}:${managedSession?.accessToken ? "tok" : "no-tok"}`;
          return {
            provider: memoize(fingerprint, () =>
              providerForEntry(entry, { keyStore: deps.keyStore, env, managedSession })
            ),
            source: "config",
            configError
          };
        } catch (resolveError) {
          configError =
            resolveError instanceof Error ? resolveError.message : `无法构建提供方 "${activeId}"（已回退默认）`;
        }
      } else if (isRegistryId(activeId)) {
        return {
          provider: memoize(`config-registry:${activeId.toLowerCase()}`, () =>
            createRegisteredProvider(activeId, { env })
          ),
          source: "config",
          configError
        };
      } else {
        configError = `激活的提供方 "${activeId}" 不存在（已回退默认）`;
      }
    }

    // 3. Default — byte-identical legacy behavior (env unset → mock).
    return { provider: memoize("default", () => createModelProvider(env)), source: "default", configError };
  };

  return {
    resolveActive,
    getProvider: async () => (await resolveActive()).provider,
    invalidate: () => {
      disposeQuietly(memo?.provider);
      memo = null;
    },
    getKeyStore,
    getDeps,
    providerForId: async (id: string) => {
      const deps = await getDeps();
      if (deps) {
        const { config } = await readAiProvidersConfig(deps);
        const entry = config.providers.find((candidate) => candidate.id === id);
        if (entry) {
          const managedSession = entry.kind === "managed" ? await getManagedSession(deps, entry.id) : null;
          return providerForEntry(entry, { keyStore: deps.keyStore, env: envOf(), managedSession });
        }
      }
      if (isRegistryId(id)) return createRegisteredProvider(id, { env: envOf() });
      throw new NotFoundError(`提供方 "${id}" 不存在`);
    }
  };
}

// —— readout view (never leaks key material; keyRef stays server-side too) ————

export type AiProviderEntryView = {
  id: string;
  kind: AiProviderEntry["kind"];
  preset?: string;
  label?: string;
  baseUrl?: string;
  model?: string;
  /** A key blob is stored for this entry (已保存 badge). NEVER the key itself. */
  keySet: boolean;
  /**
   * managed only (G-A3b): a session token is stored for this entry (登录 vs 已登录).
   * NEVER the token — a boolean, exactly like keySet. Absent on non-managed entries.
   */
  sessionSet?: boolean;
  capabilities?: ProviderCapabilities;
};

export type AiProvidersConfigView = {
  activeProviderId: string | null;
  providers: AiProviderEntryView[];
  /** Non-fatal config problems surfaced to the settings UI. */
  error: string | null;
};

/** Project the stored config into the wire shape: keySet flag, no keyRef, no keys. */
export async function configView(
  deps: AiProvidersDeps,
  config: AiProvidersConfig,
  error: string | null,
  env: NodeJS.ProcessEnv
): Promise<AiProvidersConfigView> {
  const providers: AiProviderEntryView[] = [];
  for (const entry of config.providers) {
    let capabilities: ProviderCapabilities | undefined;
    try {
      capabilities = providerForEntry(entry, { keyStore: deps.keyStore, env }).capabilities;
    } catch {
      capabilities = undefined; // e.g. unknown preset — the row still lists, sans readout
    }
    providers.push({
      id: entry.id,
      kind: entry.kind,
      preset: entry.preset,
      label: entry.label,
      baseUrl: entry.baseUrl,
      model: entry.model,
      keySet: entry.keyRef ? await deps.keyStore.hasKey(entry.keyRef) : false,
      // managed: whether a session token is stored (登录 affordance) — never the token.
      ...(entry.kind === "managed"
        ? { sessionSet: await deps.keyStore.hasKey(managedSessionKeyRef(entry.id)) }
        : {}),
      capabilities
    });
  }
  return { activeProviderId: config.activeProviderId, providers, error };
}

// —— test connection ——————————————————————————————————————————————————————————

export type TestConnectionResult =
  | { ok: true; latencyMs: number; replyPreview: string }
  | { ok: false; latencyMs: number; reason: string };

export const DEFAULT_TEST_TIMEOUT_MS = 8000;

/**
 * The 测试连接 probe: ONE minimal complete() against exactly the given provider,
 * raced against a short timeout. Always resolves a typed result (never throws) —
 * an unconfigured provider's HttpProviderNotConfiguredError message becomes the
 * `reason`, verbatim, with NO network touched (the preset gate sits before the
 * vendor SDK import).
 */
export async function testProviderConnection(
  provider: ModelProvider,
  options: { timeoutMs?: number } = {}
): Promise<TestConnectionResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TEST_TIMEOUT_MS;
  const started = Date.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    const response = await Promise.race([
      provider.complete({
        // Kept as small as the seam allows (ChatRequest carries no token cap):
        // a one-word instruction so a healthy endpoint answers almost instantly.
        messages: [{ role: "user", content: "Connection test — reply with one short word." }]
      }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`测试超时（${timeoutMs}ms 内无响应）`)), timeoutMs);
        timer.unref?.();
      })
    ]);
    return { ok: true, latencyMs: Date.now() - started, replyPreview: response.message.content.slice(0, 80) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, latencyMs: Date.now() - started, reason };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// —— cli-agent detection (probe endpoint for the settings rows) ————————————————

export type CliAgentSpecId = "claude" | "codex";

/**
 * Map a picker id onto the underlying CLI binary's spec: the three claude-family
 * registry ids share the `claude` binary; config entries map through their preset.
 * Non-cli ids → null (the route answers 400).
 */
export function cliSpecIdFor(providerId: string, config: AiProvidersConfig): CliAgentSpecId | null {
  const entry = config.providers.find((candidate) => candidate.id === providerId);
  const target = (entry ? (entry.preset ?? "") : providerId).toLowerCase();
  if (target === "codex") return "codex";
  if (target === "claude" || target === "claude-cli" || target === "claude-pty" || target === "claude-agent") {
    return "claude";
  }
  return null;
}

/** Real probes (`<cli> --version`, 3s timeout). Tests inject a fake via createApp. */
export function detectCliAgent(specId: CliAgentSpecId): Promise<CliAgentDetectResult> {
  return specId === "codex" ? codexAgentSpec.detect() : claudeAgentSpec.detect();
}
