// server-only (node:crypto) — never import from src/client.
// Thin typed wrappers over node:crypto built-ins so the rest of the .svpack code never
// touches cipher objects or DER layouts directly (design §12: zero new dependencies).

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  hkdfSync,
  randomBytes as nodeRandomBytes,
  sign as nodeSign,
  verify as nodeVerify
} from "node:crypto";
import { base32Encode } from "./base32";

export const AEAD_KEY_LENGTH = 32;
export const AEAD_NONCE_LENGTH = 12;
export const AEAD_TAG_LENGTH = 16;
export const SIGNING_KEY_LENGTH = 32;
export const SIGNATURE_LENGTH = 64;

/** Thrown when an AES-256-GCM open fails authentication (tampered/wrong key/wrong aad). */
export class AeadAuthenticationError extends Error {
  constructor(message = "AEAD authentication failed") {
    super(message);
    this.name = "AeadAuthenticationError";
  }
}

export function randomBytes(length: number): Buffer {
  return nodeRandomBytes(length);
}

export function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

/**
 * Strict base64url decode: Node's Buffer.from silently skips invalid characters, so we
 * re-encode and require an exact match (canonical spelling only).
 */
export function fromBase64Url(text: string): Buffer {
  const bytes = Buffer.from(text, "base64url");
  if (bytes.toString("base64url") !== text) throw new TypeError("invalid base64url string");
  return bytes;
}

export type AeadEncryptParams = {
  key: Uint8Array;
  plaintext: Uint8Array;
  aad?: Uint8Array;
  /**
   * Normally omitted (random 12 bytes). The svpack frame passes an explicit nonce
   * because the payload nonce must sit INSIDE the signed header bytes, which are
   * themselves the AAD — so the nonce has to exist before encryption (§3).
   */
  nonce?: Uint8Array;
};

export type AeadCiphertext = { nonce: Buffer; ciphertext: Buffer };

/** AES-256-GCM; the 16-byte auth tag is appended to the ciphertext. */
export function aeadEncrypt(params: AeadEncryptParams): AeadCiphertext {
  const { key, plaintext, aad } = params;
  if (key.length !== AEAD_KEY_LENGTH) throw new RangeError(`AEAD key must be ${AEAD_KEY_LENGTH} bytes`);
  const nonce = Buffer.from(params.nonce ?? nodeRandomBytes(AEAD_NONCE_LENGTH));
  if (nonce.length !== AEAD_NONCE_LENGTH) throw new RangeError(`AEAD nonce must be ${AEAD_NONCE_LENGTH} bytes`);

  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  if (aad) cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  return { nonce, ciphertext };
}

export type AeadDecryptParams = {
  key: Uint8Array;
  nonce: Uint8Array;
  /** Ciphertext with the 16-byte auth tag appended (as produced by `aeadEncrypt`). */
  ciphertext: Uint8Array;
  aad?: Uint8Array;
};

export function aeadDecrypt(params: AeadDecryptParams): Buffer {
  const { key, nonce, ciphertext, aad } = params;
  if (key.length !== AEAD_KEY_LENGTH) throw new RangeError(`AEAD key must be ${AEAD_KEY_LENGTH} bytes`);
  if (nonce.length !== AEAD_NONCE_LENGTH) throw new RangeError(`AEAD nonce must be ${AEAD_NONCE_LENGTH} bytes`);
  if (ciphertext.length < AEAD_TAG_LENGTH) {
    throw new AeadAuthenticationError("ciphertext shorter than the auth tag");
  }

  const body = Buffer.from(ciphertext.subarray(0, ciphertext.length - AEAD_TAG_LENGTH));
  const tag = Buffer.from(ciphertext.subarray(ciphertext.length - AEAD_TAG_LENGTH));
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  if (aad) decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    throw new AeadAuthenticationError();
  }
}

// --- Ed25519 -----------------------------------------------------------------------
// Raw 32-byte keys everywhere (they go into headers/files verbatim). node:crypto only
// speaks DER/PEM/JWK, but Ed25519 SPKI and PKCS#8 encodings are FIXED-LENGTH, so the
// raw key is always the last 32 bytes behind a constant prefix. We standardize on DER
// with those constant prefixes (simpler and byte-exact vs. JWK's base64 field juggling).
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex"); // 12 bytes, +32 raw = 44
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex"); // 16 bytes, +32 raw = 48

export type SigningKeyPair = {
  /** Raw 32-byte Ed25519 public key. */
  publicKey: Buffer;
  /** Raw 32-byte Ed25519 private key (seed). */
  privateKey: Buffer;
};

function publicKeyObjectFromRaw(publicKey: Uint8Array) {
  if (publicKey.length !== SIGNING_KEY_LENGTH) {
    throw new RangeError(`Ed25519 public key must be ${SIGNING_KEY_LENGTH} bytes`);
  }
  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKey)]),
    format: "der",
    type: "spki"
  });
}

function privateKeyObjectFromRaw(privateKey: Uint8Array) {
  if (privateKey.length !== SIGNING_KEY_LENGTH) {
    throw new RangeError(`Ed25519 private key must be ${SIGNING_KEY_LENGTH} bytes`);
  }
  return createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, Buffer.from(privateKey)]),
    format: "der",
    type: "pkcs8"
  });
}

export function generateSigningKeyPair(): SigningKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ type: "spki", format: "der" });
  const pkcs8 = privateKey.export({ type: "pkcs8", format: "der" });
  return {
    publicKey: Buffer.from(spki.subarray(ED25519_SPKI_PREFIX.length)),
    privateKey: Buffer.from(pkcs8.subarray(ED25519_PKCS8_PREFIX.length))
  };
}

/** Derive the raw public key from a raw private key (used to sanity-check headers). */
export function signingPublicKeyFromPrivate(privateKey: Uint8Array): Buffer {
  // Via PEM: the installed @types/node does not accept a KeyObject in createPublicKey.
  const pem = privateKeyObjectFromRaw(privateKey).export({ type: "pkcs8", format: "pem" });
  const spki = createPublicKey(pem).export({ type: "spki", format: "der" });
  return Buffer.from(spki.subarray(ED25519_SPKI_PREFIX.length));
}

export function signBytes(privateKey: Uint8Array, bytes: Uint8Array): Buffer {
  return nodeSign(null, bytes, privateKeyObjectFromRaw(privateKey));
}

export function verifyBytes(publicKey: Uint8Array, bytes: Uint8Array, signature: Uint8Array): boolean {
  const keyObject = publicKeyObjectFromRaw(publicKey);
  try {
    return nodeVerify(null, bytes, keyObject, signature);
  } catch {
    return false; // malformed signature buffers verify as false, never throw
  }
}

/** HKDF-SHA256 → 32 bytes. hkdfSync returns an ArrayBuffer; normalize to Buffer. */
export function hkdf32(ikm: string | Uint8Array, salt: string | Uint8Array, info: string | Uint8Array): Buffer {
  return Buffer.from(hkdfSync("sha256", ikm, salt, info, 32));
}

/**
 * Self-certifying publisher id (design §5.1):
 *   "pubf_" + crockford(sha256(rawPublicKey)).slice(0, 16).toLowerCase()
 * Lives in the crypto leaf (not identity/publisher) because svpackFrame's
 * self-certification check needs it too; identity/publisher re-exports it as the
 * author-facing API. Hashes via node:crypto rather than src/core/storage/sha256.ts:
 * that helper returns lowercase hex for portable content hashing, while this needs the
 * raw digest bytes for base32 — and this leaf is already server-only node:crypto.
 */
export function publisherIdFromPublicKey(publicKey: Uint8Array): string {
  if (publicKey.length !== SIGNING_KEY_LENGTH) {
    throw new RangeError(`Ed25519 public key must be ${SIGNING_KEY_LENGTH} bytes`);
  }
  const digest = createHash("sha256").update(publicKey).digest();
  return `pubf_${base32Encode(digest).slice(0, 16).toLowerCase()}`;
}
