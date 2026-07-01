// server-only (node:crypto) — never import from src/client.
// Per-recipient codes (design §4). A code is 25 random bytes = 40 Crockford base32
// chars ≈ 200 bits; its first 8 chars are the PUBLIC `codeId` (wrap-list index,
// ledger line, watermark payload). Offline the pack is a code-checking oracle with no
// rate limiter, so security comes from ENTROPY, not KDF slowness — the wrap key is a
// single HKDF-SHA256 step (microseconds), never a password KDF.

import { Base32DecodeError, base32Decode, base32Encode, normalizeCrockford } from "./base32";
import {
  AeadAuthenticationError,
  AEAD_KEY_LENGTH,
  AEAD_NONCE_LENGTH,
  aeadDecrypt,
  aeadEncrypt,
  fromBase64Url,
  hkdf32,
  randomBytes,
  toBase64Url
} from "./primitives";

export const CODE_BYTES = 25; // 25 bytes × 8 = 200 bits = exactly 40 base32 chars, no padding
export const CODE_LENGTH = 40;
export const CODE_ID_LENGTH = 8;
const CODE_GROUP_SIZE = 5;

export const CEK_WRAP_INFO = "svpack/v2/cek-wrap";

/** Thrown by `parseCode` when the input is not a well-formed 40-char code. */
export class MalformedCodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MalformedCodeError";
  }
}

/**
 * Thrown by `unwrapCek` when a wrap entry exists for the code's codeId but the secret
 * part does not authenticate (typo in the tail, or a wrap from a different pack).
 */
export class WrongCodeError extends Error {
  constructor(message = "wrong code for this pack") {
    super(message);
    this.name = "WrongCodeError";
  }
}

export type ParsedCode = {
  /** Canonical form: 40 uppercase Crockford chars, no separators. The HKDF ikm. */
  code: string;
  /** First 8 chars — the public wrap-list index. NOT an entity id. */
  codeId: string;
};

/** One entry of `header.wraps` — base64url fields, embedded verbatim in the signed header (§3.2). */
export type WrapEntry = {
  codeId: string;
  nonce: string;
  wrappedCek: string;
};

export function mintCode(): ParsedCode {
  const code = base32Encode(randomBytes(CODE_BYTES));
  return { code, codeId: code.slice(0, CODE_ID_LENGTH) };
}

/**
 * Normalize human input into the canonical code: strip dashes/whitespace, uppercase,
 * fold Crockford ambiguity (I/L → 1, O → 0), then validate length and alphabet.
 */
export function parseCode(input: string): ParsedCode {
  const compact = normalizeCrockford(input.replace(/[\s-]/g, ""));
  if (compact.length !== CODE_LENGTH) {
    throw new MalformedCodeError(`code must be ${CODE_LENGTH} characters, got ${compact.length}`);
  }
  try {
    base32Decode(compact); // alphabet check; 40 chars = 200 bits exactly, so no padding concerns
  } catch (error) {
    if (error instanceof Base32DecodeError) throw new MalformedCodeError(error.message);
    throw error;
  }
  return { code: compact, codeId: compact.slice(0, CODE_ID_LENGTH) };
}

/** 8 dash-separated groups of 5 (`A7K2Q-F3ZTV-…`). Accepts any parseable form. */
export function formatCodeForDisplay(input: string): string {
  const { code } = parseCode(input);
  const groups: string[] = [];
  for (let offset = 0; offset < code.length; offset += CODE_GROUP_SIZE) {
    groups.push(code.slice(offset, offset + CODE_GROUP_SIZE));
  }
  return groups.join("-");
}

/**
 * wrapKey = HKDF-SHA256(ikm = canonical code, salt = `${packId}/${codeId}`,
 * info = "svpack/v2/cek-wrap"). Accepts display or canonical form (canonicalizes first)
 * so wrap and unwrap can never disagree about the ikm.
 */
export function deriveWrapKey(code: string, packId: string): Buffer {
  const parsed = parseCode(code);
  return hkdf32(parsed.code, `${packId}/${parsed.codeId}`, CEK_WRAP_INFO);
}

/** AES-256-GCM-wrap the pack CEK to one recipient code. aad = `${packId}/${codeId}`. */
export function wrapCek(cek: Uint8Array, code: string, packId: string): WrapEntry {
  if (cek.length !== AEAD_KEY_LENGTH) throw new RangeError(`CEK must be ${AEAD_KEY_LENGTH} bytes`);
  const parsed = parseCode(code);
  const wrapKey = deriveWrapKey(parsed.code, packId);
  const aad = Buffer.from(`${packId}/${parsed.codeId}`, "utf8");
  const { nonce, ciphertext } = aeadEncrypt({ key: wrapKey, plaintext: cek, aad });
  return { codeId: parsed.codeId, nonce: toBase64Url(nonce), wrappedCek: toBase64Url(ciphertext) };
}

/**
 * Recover the CEK from a wrap entry. Any failure — codeId mismatch, malformed entry
 * encoding, GCM authentication — collapses to `WrongCodeError` (fail closed).
 */
export function unwrapCek(wrapEntry: WrapEntry, code: string, packId: string): Buffer {
  const parsed = parseCode(code);
  if (wrapEntry.codeId !== parsed.codeId) {
    throw new WrongCodeError("wrap entry does not belong to this code");
  }

  let nonce: Buffer;
  let ciphertext: Buffer;
  try {
    nonce = fromBase64Url(wrapEntry.nonce);
    ciphertext = fromBase64Url(wrapEntry.wrappedCek);
  } catch {
    throw new WrongCodeError("malformed wrap entry");
  }
  if (nonce.length !== AEAD_NONCE_LENGTH) throw new WrongCodeError("malformed wrap entry");

  const wrapKey = deriveWrapKey(parsed.code, packId);
  const aad = Buffer.from(`${packId}/${parsed.codeId}`, "utf8");
  try {
    return aeadDecrypt({ key: wrapKey, nonce, ciphertext, aad });
  } catch (error) {
    if (error instanceof AeadAuthenticationError) throw new WrongCodeError();
    throw error;
  }
}
