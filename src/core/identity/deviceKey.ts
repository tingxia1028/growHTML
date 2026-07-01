// server-only (node:crypto/node:fs) — never import from src/client.
// Recipient device key (design §7.1): 32 random bytes that seal imported packs and the
// clock high-water-mark at rest. This file-based key is the dev/browser fallback the
// design labels as weaker; Electron `safeStorage` is the eventual primary home. Either
// way it lives outside the vault, so a copied vault directory is useless ciphertext.

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "../crypto/primitives";
import { defaultIdentityDir } from "./paths";

export const DEVICE_KEY_LENGTH = 32;
export const DEVICE_KEY_FILE = "device.key";

export function loadOrCreateDeviceKey(dir: string = defaultIdentityDir()): Buffer {
  const filePath = path.join(dir, DEVICE_KEY_FILE);

  let existing: Buffer | null = null;
  try {
    existing = readFileSync(filePath);
  } catch {
    existing = null; // missing — create below
  }
  if (existing !== null) {
    if (existing.length !== DEVICE_KEY_LENGTH) {
      // Do NOT silently regenerate: everything sealed under the old key would become
      // unreadable. Surface the corruption and let the user decide.
      throw new Error(`corrupt device key (${existing.length} bytes) at ${filePath}`);
    }
    return existing;
  }

  const key = randomBytes(DEVICE_KEY_LENGTH);
  mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, key, { mode: 0o600 });
  try {
    chmodSync(filePath, 0o600);
  } catch {
    // Best effort: Windows has no POSIX modes; the profile dir ACL is the boundary there.
  }
  return key;
}
