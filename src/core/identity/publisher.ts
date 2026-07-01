// server-only (node:crypto/node:fs) — never import from src/client.
// Publisher identity (design §5.1): a local Ed25519 keypair whose id is the key's
// fingerprint — SELF-CERTIFYING, so nobody can claim an existing publisher's id
// without the private key. Key loss = identity loss (new key ⇒ new id ⇒ re-pin), hence
// the passphrase-protected backup. scrypt is used ONLY here: backups are guarded by a
// human-chosen passphrase, so the KDF must be slow — recipient codes never are (§4).

import { scryptSync } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  AeadAuthenticationError,
  AEAD_NONCE_LENGTH,
  AEAD_TAG_LENGTH,
  SIGNING_KEY_LENGTH,
  aeadDecrypt,
  aeadEncrypt,
  generateSigningKeyPair,
  publisherIdFromPublicKey,
  randomBytes,
  signBytes,
  signingPublicKeyFromPrivate,
  toBase64Url
} from "../crypto/primitives";
import { defaultIdentityDir } from "./paths";

// Canonical fingerprint implementation lives in the crypto leaf (svpackFrame's
// self-certification check shares it); this is the author-facing re-export.
export { publisherIdFromPublicKey };

export const PUBLISHER_KEY_FILE = "publisher.key";

const BACKUP_MAGIC = Buffer.from("SVKB1\n", "utf8");
const BACKUP_SALT_LENGTH = 16;
const BACKUP_AAD = Buffer.from("svpack/v2/publisher-backup", "utf8");
const BACKUP_LENGTH =
  BACKUP_MAGIC.length + BACKUP_SALT_LENGTH + AEAD_NONCE_LENGTH + SIGNING_KEY_LENGTH + AEAD_TAG_LENGTH;
// Interactive-strength scrypt (N=2^15, r=8, p=1 ⇒ 32 MiB); maxmem raised above the
// 32 MiB node default so the derivation itself never trips the limit.
const SCRYPT_OPTIONS = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;

export class WrongPassphraseError extends Error {
  constructor(message = "wrong passphrase for publisher key backup") {
    super(message);
    this.name = "WrongPassphraseError";
  }
}

export class MalformedBackupError extends Error {
  constructor(message = "not a publisher key backup file") {
    super(message);
    this.name = "MalformedBackupError";
  }
}

export type PublisherIdentity = {
  /** Self-certifying id: "pubf_" + crockford(sha256(rawPub)).slice(0, 16).toLowerCase(). */
  id: string;
  /** Raw 32-byte Ed25519 public key, base64url — goes into header.publisher.signingPubKey. */
  publicKeyB64u: string;
  /** Raw 32-byte private key — what svpackFrame.buildPack takes as publisherPrivKey. */
  privateKey: Buffer;
  sign: (bytes: Uint8Array) => Buffer;
};

function identityFromPrivateKey(privateKey: Buffer): PublisherIdentity {
  const publicKey = signingPublicKeyFromPrivate(privateKey);
  return {
    id: publisherIdFromPublicKey(publicKey),
    publicKeyB64u: toBase64Url(publicKey),
    privateKey,
    sign: (bytes) => signBytes(privateKey, bytes)
  };
}

function writePrivateKey(dir: string, privateKey: Buffer): void {
  const filePath = path.join(dir, PUBLISHER_KEY_FILE);
  mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, privateKey, { mode: 0o600 });
  try {
    chmodSync(filePath, 0o600);
  } catch {
    // Best effort: Windows has no POSIX modes; the profile dir ACL is the boundary there.
  }
}

export function loadOrCreatePublisher(dir: string = defaultIdentityDir()): PublisherIdentity {
  const filePath = path.join(dir, PUBLISHER_KEY_FILE);

  let existing: Buffer | null = null;
  try {
    existing = readFileSync(filePath);
  } catch {
    existing = null; // missing — create below
  }
  if (existing !== null) {
    if (existing.length !== SIGNING_KEY_LENGTH) {
      // Never regenerate silently: a new key is a new publisher id (§5.1).
      throw new Error(`corrupt publisher key (${existing.length} bytes) at ${filePath}`);
    }
    return identityFromPrivateKey(existing);
  }

  const { privateKey } = generateSigningKeyPair();
  writePrivateKey(dir, privateKey);
  return identityFromPrivateKey(privateKey);
}

/**
 * Passphrase-protected export of the publisher private key (offered at first publish).
 * Blob = "SVKB1\n" ‖ salt(16) ‖ nonce(12) ‖ AES-256-GCM(scrypt(passphrase, salt), key).
 * Creates the publisher identity first if none exists yet.
 */
export function backupPublisherKey(passphrase: string, dir: string = defaultIdentityDir()): Buffer {
  const identity = loadOrCreatePublisher(dir);
  const salt = randomBytes(BACKUP_SALT_LENGTH);
  const backupKey = scryptSync(passphrase, salt, 32, SCRYPT_OPTIONS);
  const { nonce, ciphertext } = aeadEncrypt({ key: backupKey, plaintext: identity.privateKey, aad: BACKUP_AAD });
  return Buffer.concat([BACKUP_MAGIC, salt, nonce, ciphertext]);
}

/**
 * Restore a backup into `dir`, OVERWRITING any publisher key there (restoring is the
 * explicit "make this device use this identity" action). Wrong passphrase ⇒ typed error.
 */
export function restorePublisherKey(blob: Buffer, passphrase: string, dir: string = defaultIdentityDir()): PublisherIdentity {
  if (blob.length !== BACKUP_LENGTH || !blob.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC)) {
    throw new MalformedBackupError();
  }
  let offset = BACKUP_MAGIC.length;
  const salt = blob.subarray(offset, (offset += BACKUP_SALT_LENGTH));
  const nonce = blob.subarray(offset, (offset += AEAD_NONCE_LENGTH));
  const ciphertext = blob.subarray(offset);

  const backupKey = scryptSync(passphrase, salt, 32, SCRYPT_OPTIONS);
  let privateKey: Buffer;
  try {
    privateKey = aeadDecrypt({ key: backupKey, nonce, ciphertext, aad: BACKUP_AAD });
  } catch (error) {
    if (error instanceof AeadAuthenticationError) throw new WrongPassphraseError();
    throw error;
  }

  writePrivateKey(dir, privateKey);
  return identityFromPrivateKey(privateKey);
}
