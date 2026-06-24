import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "./sha256";

const encode = (text: string) => new TextEncoder().encode(text);

describe("sha256Hex", () => {
  it("matches known FIPS-180-4 test vectors", () => {
    expect(sha256Hex(encode(""))).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex(encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("matches node:crypto across sizes that cross block boundaries", () => {
    for (const len of [0, 1, 55, 56, 63, 64, 65, 200, 1000]) {
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i += 1) bytes[i] = (i * 37 + 11) & 0xff;
      const expected = createHash("sha256").update(bytes).digest("hex");
      expect(sha256Hex(bytes)).toBe(expected);
    }
  });
});
