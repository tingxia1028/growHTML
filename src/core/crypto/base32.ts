// Part of the server-only crypto leaf (src/core/crypto) — never import from src/client.
// Crockford base32 (uppercase, no I L O U) implemented locally so the .svpack code
// pulls in zero new dependencies. Pure bit shifting. Encoding pads the final quantum
// with zero bits; decoding REJECTS non-zero padding bits so every byte string has
// exactly one spelling (no malleable alternate encodings of the same code).

const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const valueByChar = new Map<string, number>();
for (let i = 0; i < CROCKFORD_ALPHABET.length; i += 1) valueByChar.set(CROCKFORD_ALPHABET[i], i);

export class Base32DecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Base32DecodeError";
  }
}

/**
 * Uppercase and fold the Crockford ambiguity set (I/L → 1, O → 0). Pure mapping —
 * does NOT validate; feed the result to `base32Decode` (or check the alphabet) after.
 */
export function normalizeCrockford(text: string): string {
  return text.toUpperCase().replace(/[IL]/g, "1").replace(/O/g, "0");
}

export function base32Encode(bytes: Uint8Array): string {
  let out = "";
  let accumulator = 0;
  let bits = 0;
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte; // at most 12 bits in flight — safe as a JS int
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += CROCKFORD_ALPHABET[(accumulator >>> bits) & 0x1f];
    }
  }
  if (bits > 0) out += CROCKFORD_ALPHABET[(accumulator << (5 - bits)) & 0x1f];
  return out;
}

export function base32Decode(text: string): Uint8Array {
  const normalized = normalizeCrockford(text);
  const out = new Uint8Array(Math.floor((normalized.length * 5) / 8));
  let accumulator = 0;
  let bits = 0;
  let offset = 0;
  for (const char of normalized) {
    const value = valueByChar.get(char);
    if (value === undefined) {
      throw new Base32DecodeError(`invalid base32 character: ${JSON.stringify(char)}`);
    }
    accumulator = (accumulator << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out[offset] = (accumulator >>> bits) & 0xff;
      offset += 1;
    }
  }
  if ((accumulator & ((1 << bits) - 1)) !== 0) {
    throw new Base32DecodeError("non-canonical base32: trailing padding bits are not zero");
  }
  return out;
}
