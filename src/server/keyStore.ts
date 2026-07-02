// API-key storage for BYOK http providers (A3b — docs/design/multi-provider-ai-agent.md
// §4.2 "Secure key storage"). ONE seam, two implementations:
//
//   SafeStorageKeyStore — Electron `safeStorage` (DPAPI / macOS keychain / libsecret).
//     Keys are encrypted at rest and stored as base64 CIPHERTEXT blobs in their own
//     file (ai-provider-keys.json) — never in ai-providers.json, never plaintext.
//     Reachable because the PROD desktop server runs IN-PROCESS in the Electron main
//     process (src/server/start.ts is called from electron/main.ts), so the doc's
//     boundary rule holds with zero IPC: the renderer never receives a key and no
//     key ever crosses the contextBridge — plaintext exists only in the settings
//     form (the user typed it) and transiently in main during encrypt/decrypt.
//     The crypto functions are INJECTED (constructor deps) so unit tests exercise
//     the store with fake encrypt/decrypt and never load Electron.
//
//   EnvOnlyKeyStore — the web / dev-server / plain-CLI fallback (no safeStorage in
//     reach): nothing is ever persisted (NO plaintext key files — the doc's rule);
//     `setKey` throws the typed KeyNotPersistableError and callers fall back to the
//     per-preset env vars (DEEPSEEK_API_KEY, …). The settings UI states this mode.
//
// The chain consumers use: KeyStore.getKey(keyRef) → preset env var → not configured
// (typed HttpProviderNotConfiguredError at first provider use).

import { nodeStorage } from "../core/storage/nodeStorage";
import type { StorageAdapter } from "../core/storage/adapter";

export type KeyStoreStatus = {
  /** How keys are held: OS-encrypted at rest, or not held at all (env vars only). */
  kind: "safe-storage" | "env-only";
  /** True when setKey() actually persists (encrypted). */
  persistent: boolean;
  /** Why persistence is unavailable (env-only mode). */
  reason?: string;
};

/** setKey() was called on a store that cannot persist (env-only mode) → HTTP 409. */
export class KeyNotPersistableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeyNotPersistableError";
  }
}

export interface KeyStore {
  status(): KeyStoreStatus;
  /** Decrypted key for `ref`, or null (unknown ref / undecryptable blob). */
  getKey(ref: string): Promise<string | null>;
  hasKey(ref: string): Promise<boolean>;
  /** Persist (encrypted). Throws KeyNotPersistableError in env-only mode. */
  setKey(ref: string, value: string): Promise<void>;
  /** Remove the stored blob. Idempotent; a no-op in env-only mode. */
  deleteKey(ref: string): Promise<void>;
}

/**
 * The exact slice of Electron's `safeStorage` the store needs — injected so unit
 * tests supply fakes (and so the module never imports electron statically: this
 * file is bundled into BOTH the electron main build and the plain Node server).
 */
export type SafeStorageCrypto = {
  encryptString(plain: string): Uint8Array;
  decryptString(cipher: Buffer): string;
};

type KeyFileShape = { version: 1; keys: Record<string, string> };

const EMPTY_FILE: KeyFileShape = { version: 1, keys: {} };

export type SafeStorageKeyStoreOptions = {
  /** Absolute path of the ciphertext blob file (own file, NEVER the config file). */
  filePath: string;
  crypto: SafeStorageCrypto;
  /** Injectable for tests; defaults to the shared Node adapter (atomic writes). */
  storage?: StorageAdapter;
};

export class SafeStorageKeyStore implements KeyStore {
  private readonly filePath: string;
  private readonly crypto: SafeStorageCrypto;
  private readonly storage: StorageAdapter;

  constructor(options: SafeStorageKeyStoreOptions) {
    this.filePath = options.filePath;
    this.crypto = options.crypto;
    this.storage = options.storage ?? nodeStorage;
  }

  status(): KeyStoreStatus {
    return { kind: "safe-storage", persistent: true };
  }

  // Read → parse-or-empty: a corrupt/absent file degrades to "no keys" (keys are
  // re-enterable through the UI; other config must never be held hostage by it).
  private async read(): Promise<KeyFileShape> {
    const text = await this.storage.readText(this.filePath);
    if (!text) return { ...EMPTY_FILE, keys: {} };
    try {
      const parsed = JSON.parse(text) as Partial<KeyFileShape>;
      const keys = parsed && typeof parsed.keys === "object" && parsed.keys !== null ? parsed.keys : {};
      const clean: Record<string, string> = {};
      for (const [ref, blob] of Object.entries(keys)) {
        if (typeof blob === "string") clean[ref] = blob;
      }
      return { version: 1, keys: clean };
    } catch {
      return { ...EMPTY_FILE, keys: {} };
    }
  }

  private async write(file: KeyFileShape): Promise<void> {
    await this.storage.writeTextAtomic(this.filePath, `${JSON.stringify(file, null, 2)}\n`);
  }

  async getKey(ref: string): Promise<string | null> {
    const file = await this.read();
    const blob = file.keys[ref];
    if (!blob) return null;
    try {
      return this.crypto.decryptString(Buffer.from(blob, "base64"));
    } catch {
      // Undecryptable (OS user changed, blob corrupted): behave as "no key" so the
      // env fallback / not-configured error path names the fix (re-enter the key).
      return null;
    }
  }

  async hasKey(ref: string): Promise<boolean> {
    const file = await this.read();
    return typeof file.keys[ref] === "string";
  }

  async setKey(ref: string, value: string): Promise<void> {
    const cipher = this.crypto.encryptString(value);
    const file = await this.read();
    file.keys[ref] = Buffer.from(cipher).toString("base64");
    await this.write(file);
  }

  async deleteKey(ref: string): Promise<void> {
    const file = await this.read();
    if (!(ref in file.keys)) return;
    delete file.keys[ref];
    await this.write(file);
  }
}

export class EnvOnlyKeyStore implements KeyStore {
  constructor(private readonly reason: string) {}

  status(): KeyStoreStatus {
    return { kind: "env-only", persistent: false, reason: this.reason };
  }

  async getKey(): Promise<string | null> {
    return null; // nothing is stored; the caller's chain falls to the preset env var
  }

  async hasKey(): Promise<boolean> {
    return false;
  }

  async setKey(): Promise<void> {
    throw new KeyNotPersistableError(
      `此运行环境无法安全保存 API 密钥（${this.reason}）——请通过环境变量提供密钥`
    );
  }

  async deleteKey(): Promise<void> {
    // Nothing persisted → deleting is a harmless no-op (idempotent).
  }
}

/**
 * Runtime-detected default: `safeStorage` when this server runs inside the
 * Electron MAIN process (the packaged desktop app — start.ts is invoked from
 * electron/main.ts, so `import("electron")` resolves to the real API), env-only
 * everywhere else (dev `tsx` server, web build, CLI, vitest). The electron import
 * is DYNAMIC and guarded: in plain Node the `electron` package resolves to a
 * binary-path string, not the API, so we gate on process.versions.electron +
 * process.type === "browser" (main) before importing at all.
 */
export async function createDefaultKeyStore(filePath: string): Promise<KeyStore> {
  const processType = (process as { type?: string }).type;
  if (!process.versions.electron || processType !== "browser") {
    return new EnvOnlyKeyStore("非 Electron 主进程：web / dev / CLI 模式");
  }
  try {
    const { safeStorage } = await import("electron");
    if (!safeStorage?.isEncryptionAvailable()) {
      return new EnvOnlyKeyStore("系统加密不可用（safeStorage.isEncryptionAvailable() 为 false）");
    }
    return new SafeStorageKeyStore({
      filePath,
      crypto: {
        encryptString: (plain) => safeStorage.encryptString(plain),
        decryptString: (cipher) => safeStorage.decryptString(cipher)
      }
    });
  } catch {
    return new EnvOnlyKeyStore("electron 模块不可用");
  }
}
