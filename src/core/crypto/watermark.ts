// server-only leaf, but PURE (no node:crypto / fs) — the zero-width forensic watermark
// (svpack §9). Weaves the recipient's 8-char `codeId` (= 40 bits) invisibly into rendered
// sealed-note text so a leaked *pasted-text* copy is attributable to the code it came from.
//
// HONEST LIMITS (design §1.2 / §9): zero-width carriers are stripped by aggressive
// normalizers and never survive OCR / screenshots. This is DETERRENCE + best-effort
// attribution, NOT prevention. The visible text is byte-for-byte unchanged.

import { base32Decode, base32Encode } from "./base32";

// Carriers. Two zero-width code points spell the payload bits; a third frames each copy
// so extraction can find complete 40-bit runs even inside a partial paste.
const BIT0 = "​"; // ZERO WIDTH SPACE      → bit 0
const BIT1 = "‌"; // ZERO WIDTH NON-JOINER → bit 1
const MARK = "⁠"; // WORD JOINER           → frame delimiter
const PAYLOAD_BITS = 40; // 8 Crockford chars = 5 bytes = 40 bits

// All watermark code points, for stripping / detecting.
const WM_CHARS = new RegExp(`[${BIT0}${BIT1}${MARK}]`, "g");
// A complete frame: MARK, exactly 40 bit-carriers, MARK.
const FRAME_RE = new RegExp(`${MARK}([${BIT0}${BIT1}]{${PAYLOAD_BITS}})${MARK}`, "g");

// Roughly how many VISIBLE chars between watermark copies. Redundancy: any paste of ~this
// length that lands on a whitespace boundary carries at least one full frame.
const COPY_INTERVAL = 48;

function codeIdToBits(codeId: string): string {
  const bytes = base32Decode(codeId); // 8 Crockford chars → 5 bytes
  if (bytes.length < PAYLOAD_BITS / 8) {
    throw new Error(`watermark payload must be >= ${PAYLOAD_BITS / 8} bytes (got ${bytes.length})`);
  }
  let bits = "";
  for (let i = 0; i < PAYLOAD_BITS / 8; i++) {
    for (let b = 7; b >= 0; b--) bits += (bytes[i] >> b) & 1 ? BIT1 : BIT0;
  }
  return bits;
}

function bitsToCodeId(bits: string): string {
  const bytes = new Uint8Array(PAYLOAD_BITS / 8);
  for (let i = 0; i < PAYLOAD_BITS; i++) {
    if (bits[i] === BIT1) bytes[i >> 3] |= 1 << (7 - (i & 7));
  }
  return base32Encode(bytes);
}

/** Remove every watermark code point, restoring the original visible text. */
export function stripWatermark(text: string): string {
  return text.replace(WM_CHARS, "");
}

/** True if `text` carries at least one complete watermark frame. */
export function hasWatermark(text: string): boolean {
  FRAME_RE.lastIndex = 0;
  return FRAME_RE.test(text);
}

/**
 * Weave `codeId` invisibly into `text`, redundantly. Idempotent-ish: any existing
 * watermark is stripped first so re-watermarking never stacks. Visible characters are
 * untouched — `stripWatermark(embedWatermark(t, id)) === t`.
 */
export function embedWatermark(text: string, codeId: string): string {
  const frame = MARK + codeIdToBits(codeId) + MARK;
  const clean = stripWatermark(text);
  if (!clean) return frame; // empty content still carries the mark once
  let out = "";
  let since = 0;
  for (const ch of clean) {
    out += ch;
    since++;
    if (since >= COPY_INTERVAL && (ch === " " || ch === "\n" || ch === "\t")) {
      out += frame;
      since = 0;
    }
  }
  return out + frame; // always close with a copy at the end
}

/**
 * Recover the embedded `codeId`, or null if `text` carries no complete frame. Majority-
 * votes each bit across every frame found, so a few corrupted copies don't defeat it.
 */
export function extractWatermark(text: string): string | null {
  FRAME_RE.lastIndex = 0;
  const frames: string[] = [];
  for (let m = FRAME_RE.exec(text); m; m = FRAME_RE.exec(text)) frames.push(m[1]);
  if (frames.length === 0) return null;
  let bits = "";
  for (let i = 0; i < PAYLOAD_BITS; i++) {
    let ones = 0;
    for (const f of frames) if (f[i] === BIT1) ones++;
    bits += ones * 2 > frames.length ? BIT1 : BIT0; // ties → 0
  }
  return bitsToCodeId(bits);
}
