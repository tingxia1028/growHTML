import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Base32DecodeError, base32Decode, base32Encode, normalizeCrockford } from "./base32";

describe("crockford base32", () => {
  it("encodes known vectors", () => {
    expect(base32Encode(new Uint8Array([]))).toBe("");
    expect(base32Encode(new Uint8Array([0]))).toBe("00");
    expect(base32Encode(new Uint8Array([0xff]))).toBe("ZW");
  });

  it("never emits the ambiguous letters I L O U", () => {
    for (let i = 0; i < 64; i += 1) {
      const encoded = base32Encode(randomBytes(24));
      expect(encoded).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]+$/);
    }
  });

  it("roundtrips arbitrary byte strings at every length", () => {
    for (let length = 0; length <= 64; length += 1) {
      const bytes = new Uint8Array(randomBytes(length));
      const encoded = base32Encode(bytes);
      expect(encoded).toHaveLength(Math.ceil((length * 8) / 5));
      expect(base32Decode(encoded)).toEqual(bytes);
    }
  });

  it("normalizes the Crockford ambiguity set (I/L → 1, O → 0, case folds)", () => {
    expect(normalizeCrockford("oil")).toBe("011");
    expect(base32Decode("OIOIOIOI")).toEqual(base32Decode("01010101"));
    expect(base32Decode("lIlIlIlI")).toEqual(base32Decode("11111111"));
    const canonical = base32Encode(new Uint8Array(randomBytes(10)));
    expect(base32Decode(canonical.toLowerCase())).toEqual(base32Decode(canonical));
  });

  it("rejects characters outside the alphabet", () => {
    expect(() => base32Decode("0U")).toThrow(Base32DecodeError);
    expect(() => base32Decode("0@")).toThrow(Base32DecodeError);
    expect(() => base32Decode("0 1")).toThrow(Base32DecodeError); // separators are the caller's job
  });

  it("rejects non-canonical trailing padding bits", () => {
    // "ZW" is the canonical spelling of 0xff; "ZZ" decodes to the same byte but with
    // non-zero padding — accepting it would give one code two spellings.
    expect(() => base32Decode("ZZ")).toThrow(Base32DecodeError);
    expect(() => base32Decode("Z")).toThrow(Base32DecodeError);
  });
});
