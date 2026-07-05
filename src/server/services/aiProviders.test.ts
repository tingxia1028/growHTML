// AI provider service — the G-A3b managed branch of providerForEntry (blocker 2) +
// the managed session-token storage on the keyStore path (blocker 1). The invariants
// pinned here: (a) a stored managed entry resolves a ManagedProvider whose
// getSessionToken() returns the KEYSTORE token, not env; (b) no token → the provider
// constructs (listable) but first use throws ManagedNotConfiguredError; (c) env is a
// FALLBACK, never removed (the stored token wins, env fills the gap); (d) the session
// is stored ENCRYPTED via the keyStore (never in ai-providers.json); (e) in
// EnvOnlyKeyStore mode setKey throws KeyNotPersistableError and the read degrades to
// null (no crash) — packaged-desktop-only persistence, exactly like a BYOK key.

import { describe, expect, it } from "vitest";
import { ManagedNotConfiguredError, ManagedProvider } from "../../ai";
import { EnvOnlyKeyStore, KeyNotPersistableError, type KeyStore } from "../keyStore";
import {
  clearManagedSession,
  getManagedSession,
  managedSessionKeyRef,
  providerForEntry,
  setManagedSession,
  type AiProviderEntry
} from "./aiProviders";

/** A minimal in-memory KeyStore that actually persists (safeStorage stand-in for tests). */
function memoryKeyStore(): KeyStore {
  const keys = new Map<string, string>();
  return {
    status: () => ({ kind: "safe-storage", persistent: true }),
    getKey: async (ref) => keys.get(ref) ?? null,
    hasKey: async (ref) => keys.has(ref),
    setKey: async (ref, value) => {
      keys.set(ref, value);
    },
    deleteKey: async (ref) => {
      keys.delete(ref);
    }
  };
}

const managedEntry = (over: Partial<AiProviderEntry> = {}): AiProviderEntry => ({
  id: "managed",
  kind: "managed",
  preset: "managed",
  baseUrl: "http://127.0.0.1:9",
  ...over
});

describe("providerForEntry — managed branch (blocker 2)", () => {
  it("injects the STORED session token (keyStore) into getSessionToken, not env", () => {
    const provider = providerForEntry(managedEntry(), {
      keyStore: memoryKeyStore(),
      env: { STUDY_VAULT_MANAGED_TOKEN: "env-token" },
      managedSession: { accessToken: "stored-token" }
    }) as ManagedProvider;
    expect(provider).toBeInstanceOf(ManagedProvider);
    // The private dep is what requireConfig() reads; assert via the injected accessor.
    expect((provider as unknown as { deps: { getSessionToken: () => string | null } }).deps.getSessionToken()).toBe(
      "stored-token"
    );
  });

  it("falls back to env.STUDY_VAULT_MANAGED_TOKEN when no session is stored (env stays a fallback)", () => {
    const provider = providerForEntry(managedEntry(), {
      keyStore: memoryKeyStore(),
      env: { STUDY_VAULT_MANAGED_TOKEN: "env-token" },
      managedSession: null
    }) as ManagedProvider;
    expect((provider as unknown as { deps: { getSessionToken: () => string | null } }).deps.getSessionToken()).toBe(
      "env-token"
    );
  });

  it("no stored token AND no env token → first use throws ManagedNotConfiguredError (pre-fetch)", async () => {
    const provider = providerForEntry(managedEntry(), { keyStore: memoryKeyStore(), env: {}, managedSession: null });
    await expect(provider.complete({ messages: [{ role: "user", content: "hi" }] })).rejects.toBeInstanceOf(
      ManagedNotConfiguredError
    );
  });

  it("resolves the gateway baseUrl from the stored entry, else env — never hardcoded", () => {
    const stored = providerForEntry(managedEntry({ baseUrl: "https://gw.stored" }), {
      keyStore: memoryKeyStore(),
      env: { STUDY_VAULT_MANAGED_GATEWAY_URL: "https://gw.env" },
      managedSession: { accessToken: "t" }
    }) as ManagedProvider;
    expect((stored as unknown as { deps: { gatewayBaseUrl: string } }).deps.gatewayBaseUrl).toBe("https://gw.stored");

    const fromEnv = providerForEntry(managedEntry({ baseUrl: undefined }), {
      keyStore: memoryKeyStore(),
      env: { STUDY_VAULT_MANAGED_GATEWAY_URL: "https://gw.env" },
      managedSession: { accessToken: "t" }
    }) as ManagedProvider;
    expect((fromEnv as unknown as { deps: { gatewayBaseUrl: string } }).deps.gatewayBaseUrl).toBe("https://gw.env");
  });
});

describe("managed session storage (blocker 1) — encrypted keyStore path, EnvOnlyKeyStore-safe", () => {
  it("stores under the managed keyRef (the ai-provider-keys blob, NEVER ai-providers.json)", async () => {
    const keyStore = memoryKeyStore();
    const deps = { dir: "/tmp/x", keyStore };
    await setManagedSession(deps, "managed", { accessToken: "acc", refreshToken: "ref" });
    // The blob lives under the derived ref (the same file BYOK keys use).
    expect(await keyStore.hasKey(managedSessionKeyRef("managed"))).toBe(true);
    const session = await getManagedSession(deps, "managed");
    expect(session).toEqual({ accessToken: "acc", refreshToken: "ref" });
  });

  it("round-trips an access-only session and clears it (logout is idempotent)", async () => {
    const keyStore = memoryKeyStore();
    const deps = { dir: "/tmp/x", keyStore };
    await setManagedSession(deps, "managed", { accessToken: "acc" });
    expect(await getManagedSession(deps, "managed")).toEqual({ accessToken: "acc", refreshToken: undefined });
    await clearManagedSession(deps, "managed");
    expect(await getManagedSession(deps, "managed")).toBeNull();
    await clearManagedSession(deps, "managed"); // second time = no throw
  });

  it("a corrupt/absent blob degrades to null (never crashes the readout)", async () => {
    const keyStore = memoryKeyStore();
    await keyStore.setKey(managedSessionKeyRef("managed"), "{not json");
    expect(await getManagedSession({ dir: "/tmp/x", keyStore }, "managed")).toBeNull();
  });

  it("EnvOnlyKeyStore: setKey THROWS KeyNotPersistableError; getKey returns null (degrade, no crash)", async () => {
    const keyStore = new EnvOnlyKeyStore("web / dev / CLI 模式");
    const deps = { dir: "/tmp/x", keyStore };
    await expect(setManagedSession(deps, "managed", { accessToken: "acc" })).rejects.toBeInstanceOf(
      KeyNotPersistableError
    );
    // The read side never throws — it just reports "not logged in" so the UI shows 登录.
    expect(await getManagedSession(deps, "managed")).toBeNull();
    await expect(clearManagedSession(deps, "managed")).resolves.toBeUndefined();
  });
});
