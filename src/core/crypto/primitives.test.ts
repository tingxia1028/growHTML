import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { base32Encode } from "./base32";
import {
  AeadAuthenticationError,
  aeadDecrypt,
  aeadEncrypt,
  fromBase64Url,
  generateSigningKeyPair,
  hkdf32,
  publisherIdFromPublicKey,
  randomBytes,
  signBytes,
  signingPublicKeyFromPrivate,
  toBase64Url,
  verifyBytes
} from "./primitives";

const utf8 = (text: string) => Buffer.from(text, "utf8");

describe("aead (AES-256-GCM)", () => {
  it("roundtrips with aad and a random 12-byte nonce", () => {
    const key = randomBytes(32);
    const plaintext = utf8("力学错题层 payload");
    const aad = utf8("header-bytes");

    const { nonce, ciphertext } = aeadEncrypt({ key, plaintext, aad });

    expect(nonce).toHaveLength(12);
    expect(ciphertext).toHaveLength(plaintext.length + 16); // 16-byte tag appended
    expect(aeadDecrypt({ key, nonce, ciphertext, aad })).toEqual(plaintext);
  });

  it("honors a caller-provided nonce (needed by the svpack frame)", () => {
    const key = randomBytes(32);
    const nonce = randomBytes(12);
    const first = aeadEncrypt({ key, nonce, plaintext: utf8("x"), aad: utf8("a") });
    const second = aeadEncrypt({ key, nonce, plaintext: utf8("x"), aad: utf8("a") });

    expect(first.nonce.equals(nonce)).toBe(true);
    expect(first.ciphertext.equals(second.ciphertext)).toBe(true); // GCM is deterministic per (key, nonce)
  });

  it("fails closed on wrong key, wrong aad, tampered ciphertext, tampered tag", () => {
    const key = randomBytes(32);
    const aad = utf8("aad");
    const { nonce, ciphertext } = aeadEncrypt({ key, plaintext: utf8("secret"), aad });

    expect(() => aeadDecrypt({ key: randomBytes(32), nonce, ciphertext, aad })).toThrow(AeadAuthenticationError);
    expect(() => aeadDecrypt({ key, nonce, ciphertext, aad: utf8("other") })).toThrow(AeadAuthenticationError);
    expect(() => aeadDecrypt({ key, nonce, ciphertext })).toThrow(AeadAuthenticationError);

    const flippedBody = Buffer.from(ciphertext);
    flippedBody[0] ^= 0xff;
    expect(() => aeadDecrypt({ key, nonce, ciphertext: flippedBody, aad })).toThrow(AeadAuthenticationError);

    const flippedTag = Buffer.from(ciphertext);
    flippedTag[flippedTag.length - 1] ^= 0xff;
    expect(() => aeadDecrypt({ key, nonce, ciphertext: flippedTag, aad })).toThrow(AeadAuthenticationError);
  });

  it("rejects bad key/nonce sizes and too-short ciphertext", () => {
    expect(() => aeadEncrypt({ key: randomBytes(16), plaintext: utf8("x") })).toThrow(RangeError);
    expect(() => aeadEncrypt({ key: randomBytes(32), nonce: randomBytes(8), plaintext: utf8("x") })).toThrow(RangeError);
    expect(() => aeadDecrypt({ key: randomBytes(32), nonce: randomBytes(12), ciphertext: randomBytes(15) })).toThrow(
      AeadAuthenticationError
    );
  });
});

describe("ed25519 signing", () => {
  it("generates raw 32-byte keys and 64-byte signatures that verify", () => {
    const { publicKey, privateKey } = generateSigningKeyPair();
    const bytes = utf8("headerBytes || payload");
    const signature = signBytes(privateKey, bytes);

    expect(publicKey).toHaveLength(32);
    expect(privateKey).toHaveLength(32);
    expect(signature).toHaveLength(64);
    expect(verifyBytes(publicKey, bytes, signature)).toBe(true);
    expect(signingPublicKeyFromPrivate(privateKey).equals(publicKey)).toBe(true);
  });

  it("rejects modified messages, foreign keys, and malformed signatures", () => {
    const pair = generateSigningKeyPair();
    const other = generateSigningKeyPair();
    const bytes = utf8("message");
    const signature = signBytes(pair.privateKey, bytes);

    expect(verifyBytes(pair.publicKey, utf8("messagE"), signature)).toBe(false);
    expect(verifyBytes(other.publicKey, bytes, signature)).toBe(false);
    expect(verifyBytes(pair.publicKey, bytes, randomBytes(64))).toBe(false);
    expect(verifyBytes(pair.publicKey, bytes, randomBytes(10))).toBe(false); // wrong length never throws
    expect(() => signBytes(randomBytes(16), bytes)).toThrow(RangeError);
  });
});

describe("hkdf32", () => {
  it("is deterministic and sensitive to every input", () => {
    const key = hkdf32("code", "pack/codeid", "svpack/v2/cek-wrap");

    expect(key).toHaveLength(32);
    expect(hkdf32("code", "pack/codeid", "svpack/v2/cek-wrap").equals(key)).toBe(true);
    expect(hkdf32("codf", "pack/codeid", "svpack/v2/cek-wrap").equals(key)).toBe(false);
    expect(hkdf32("code", "pack/codeie", "svpack/v2/cek-wrap").equals(key)).toBe(false);
    expect(hkdf32("code", "pack/codeid", "svpack/v2/other").equals(key)).toBe(false);
  });
});

describe("base64url helpers", () => {
  it("roundtrips and rejects non-canonical spellings", () => {
    const bytes = randomBytes(33);
    expect(fromBase64Url(toBase64Url(bytes)).equals(bytes)).toBe(true);
    expect(toBase64Url(Buffer.from([251, 255, 190]))).toBe("-_--"); // url alphabet, no padding
    expect(() => fromBase64Url("ab==")).toThrow(TypeError); // padded spelling
    expect(() => fromBase64Url("a!b")).toThrow(TypeError); // Buffer.from would silently skip "!"
  });
});

describe("publisherIdFromPublicKey", () => {
  it("matches the design formula: pubf_ + crockford(sha256(rawPub))[0..16), lowercased", () => {
    const { publicKey } = generateSigningKeyPair();
    const digest = createHash("sha256").update(publicKey).digest();
    const expected = `pubf_${base32Encode(digest).slice(0, 16).toLowerCase()}`;

    expect(publisherIdFromPublicKey(publicKey)).toBe(expected);
    expect(publisherIdFromPublicKey(publicKey)).toMatch(/^pubf_[0-9a-hjkmnp-tv-z]{16}$/);
  });

  it("is deterministic per key and differs across keys", () => {
    const a = generateSigningKeyPair();
    const b = generateSigningKeyPair();

    expect(publisherIdFromPublicKey(a.publicKey)).toBe(publisherIdFromPublicKey(a.publicKey));
    expect(publisherIdFromPublicKey(a.publicKey)).not.toBe(publisherIdFromPublicKey(b.publicKey));
    expect(() => publisherIdFromPublicKey(randomBytes(31))).toThrow(RangeError);
  });
});
