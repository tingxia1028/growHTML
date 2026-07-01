import { describe, expect, it } from "vitest";
import {
  CODE_ID_LENGTH,
  CODE_LENGTH,
  MalformedCodeError,
  WrongCodeError,
  deriveWrapKey,
  formatCodeForDisplay,
  mintCode,
  parseCode,
  unwrapCek,
  wrapCek
} from "./codes";
import { randomBytes } from "./primitives";

const CROCKFORD = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]+$/;

/** Change one character of the SECRET part (index ≥ 8) while keeping the code well-formed. */
function corruptSecretPart(code: string, index = 20): string {
  const replacement = code[index] === "A" ? "B" : "A";
  return code.slice(0, index) + replacement + code.slice(index + 1);
}

describe("mintCode / parseCode / formatCodeForDisplay", () => {
  it("mints 40 canonical Crockford chars with the first 8 as codeId", () => {
    const { code, codeId } = mintCode();

    expect(code).toHaveLength(CODE_LENGTH);
    expect(code).toMatch(CROCKFORD);
    expect(codeId).toBe(code.slice(0, CODE_ID_LENGTH));
  });

  it("formats as 8 dash-separated groups of 5 and parses back to canonical", () => {
    const { code } = mintCode();
    const display = formatCodeForDisplay(code);

    expect(display).toMatch(/^([0-9A-Z]{5}-){7}[0-9A-Z]{5}$/);
    expect(display.replaceAll("-", "")).toBe(code);
    expect(parseCode(display)).toEqual(parseCode(code));
  });

  it("normalizes dashes, whitespace, case, and the Crockford ambiguity set", () => {
    const canonical = "0123456789ABCDEFGH0123456789ABCDEFGH0123";
    const humanTyped = " o123-4567-89ab cdef gh0I 2345 6789 AbCd EfGh oi23 ";

    expect(parseCode(humanTyped).code).toBe(canonical);
    expect(parseCode(canonical.replaceAll("1", "l")).code).toBe(canonical);
    expect(parseCode(canonical.replaceAll("1", "I")).code).toBe(canonical);
    expect(parseCode(canonical.replaceAll("0", "o")).code).toBe(canonical);
    expect(parseCode(canonical).codeId).toBe("01234567");
  });

  it("rejects malformed input with a typed error", () => {
    const { code } = mintCode();

    expect(() => parseCode("")).toThrow(MalformedCodeError);
    expect(() => parseCode(code.slice(0, CODE_LENGTH - 1))).toThrow(MalformedCodeError); // 39 chars
    expect(() => parseCode(`${code}0`)).toThrow(MalformedCodeError); // 41 chars
    expect(() => parseCode(`U${code.slice(1)}`)).toThrow(MalformedCodeError); // U is not in the alphabet
    expect(() => parseCode(`!${code.slice(1)}`)).toThrow(MalformedCodeError);
  });

  it("never collides across 1000 mints (200-bit entropy)", () => {
    const codes = new Set(Array.from({ length: 1000 }, () => mintCode().code));

    expect(codes.size).toBe(1000);
  });
});

describe("deriveWrapKey", () => {
  it("derives 32 deterministic bytes, identical for display and canonical forms", () => {
    const { code } = mintCode();
    const packId = "pack_01TESTPACKID";
    const key = deriveWrapKey(code, packId);

    expect(key).toHaveLength(32);
    expect(deriveWrapKey(formatCodeForDisplay(code), packId).equals(key)).toBe(true);
    expect(deriveWrapKey(code.toLowerCase(), packId).equals(key)).toBe(true);
  });

  it("is bound to both the code and the packId", () => {
    const { code } = mintCode();
    const key = deriveWrapKey(code, "pack_A");

    expect(deriveWrapKey(code, "pack_B").equals(key)).toBe(false);
    expect(deriveWrapKey(mintCode().code, "pack_A").equals(key)).toBe(false);
  });
});

describe("wrapCek / unwrapCek", () => {
  const packId = "pack_01TESTPACKID";

  it("roundtrips the CEK for canonical and display code forms", () => {
    const { code, codeId } = mintCode();
    const cek = randomBytes(32);
    const entry = wrapCek(cek, code, packId);

    expect(entry.codeId).toBe(codeId);
    expect(unwrapCek(entry, code, packId).equals(cek)).toBe(true);
    expect(unwrapCek(entry, formatCodeForDisplay(code), packId).equals(cek)).toBe(true);
  });

  it("throws WrongCodeError when the secret part is wrong but the codeId matches", () => {
    const { code } = mintCode();
    const entry = wrapCek(randomBytes(32), code, packId);
    const wrongSecret = corruptSecretPart(code);

    expect(parseCode(wrongSecret).codeId).toBe(entry.codeId); // same public prefix…
    expect(() => unwrapCek(entry, wrongSecret, packId)).toThrow(WrongCodeError); // …still fails closed
  });

  it("binds the wrap to its packId (aad + HKDF salt)", () => {
    const { code } = mintCode();
    const entry = wrapCek(randomBytes(32), code, packId);

    expect(() => unwrapCek(entry, code, "pack_OTHER")).toThrow(WrongCodeError);
  });

  it("fails closed on tampered or malformed wrap entries", () => {
    const { code } = mintCode();
    const entry = wrapCek(randomBytes(32), code, packId);
    const flip = (value: string) => (value[0] === "A" ? `B${value.slice(1)}` : `A${value.slice(1)}`);

    expect(() => unwrapCek({ ...entry, wrappedCek: flip(entry.wrappedCek) }, code, packId)).toThrow(WrongCodeError);
    expect(() => unwrapCek({ ...entry, nonce: flip(entry.nonce) }, code, packId)).toThrow(WrongCodeError);
    expect(() => unwrapCek({ ...entry, nonce: "!!" }, code, packId)).toThrow(WrongCodeError);
    expect(() => unwrapCek({ ...entry, codeId: mintCode().codeId }, code, packId)).toThrow(WrongCodeError);
  });

  it("rejects a CEK that is not 32 bytes", () => {
    expect(() => wrapCek(randomBytes(16), mintCode().code, packId)).toThrow(RangeError);
  });
});
