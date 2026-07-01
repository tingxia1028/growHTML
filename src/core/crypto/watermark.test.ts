import { describe, expect, it } from "vitest";
import { mintCode } from "./codes";
import { embedWatermark, extractWatermark, hasWatermark, stripWatermark } from "./watermark";

const HOST =
  "The mitochondrion is the powerhouse of the cell. It supplies ATP through oxidative " +
  "phosphorylation, and its inner membrane is folded into cristae to maximize surface area. " +
  "Ribosomes translate mRNA into protein along the rough endoplasmic reticulum nearby.";

describe("watermark round-trip", () => {
  it("embeds and recovers a minted codeId", () => {
    const { codeId } = mintCode();
    const marked = embedWatermark(HOST, codeId);
    expect(hasWatermark(marked)).toBe(true);
    expect(extractWatermark(marked)).toBe(codeId);
  });

  it("recovers the two extreme payloads (all-0 / all-1 bits)", () => {
    for (const codeId of ["00000000", "ZZZZZZZZ"]) {
      expect(extractWatermark(embedWatermark(HOST, codeId))).toBe(codeId);
    }
  });

  it("leaves the visible text byte-for-byte unchanged", () => {
    const { codeId } = mintCode();
    expect(stripWatermark(embedWatermark(HOST, codeId))).toBe(HOST);
  });

  it("re-watermarking replaces rather than stacks", () => {
    const a = mintCode().codeId;
    const b = mintCode().codeId;
    const once = embedWatermark(HOST, a);
    const twice = embedWatermark(once, b);
    expect(stripWatermark(twice)).toBe(HOST); // still clean visible text
    expect(extractWatermark(twice)).toBe(b); // the newer mark wins
  });
});

describe("watermark extraction robustness", () => {
  it("returns null for un-watermarked text", () => {
    expect(hasWatermark(HOST)).toBe(false);
    expect(extractWatermark(HOST)).toBeNull();
  });

  it("recovers from a partial paste (a middle slice still carries a full frame)", () => {
    const { codeId } = mintCode();
    const marked = embedWatermark(HOST, codeId);
    const slice = marked.slice(Math.floor(marked.length * 0.25), Math.floor(marked.length * 0.85));
    expect(extractWatermark(slice)).toBe(codeId);
  });

  it("survives partial stripping — surviving frames still decode", () => {
    const { codeId } = mintCode();
    const marked = embedWatermark(HOST, codeId);
    // Delete a middle chunk (destroys some frames, leaves others intact).
    const damaged = marked.slice(0, Math.floor(marked.length * 0.4)) + marked.slice(Math.floor(marked.length * 0.6));
    expect(extractWatermark(damaged)).toBe(codeId);
  });

  it("distinguishes two different codes", () => {
    const a = mintCode();
    const b = mintCode();
    expect(a.codeId).not.toBe(b.codeId);
    expect(extractWatermark(embedWatermark(HOST, a.codeId))).toBe(a.codeId);
    expect(extractWatermark(embedWatermark(HOST, b.codeId))).toBe(b.codeId);
  });

  it("marks even empty content once", () => {
    const { codeId } = mintCode();
    const marked = embedWatermark("", codeId);
    expect(stripWatermark(marked)).toBe("");
    expect(extractWatermark(marked)).toBe(codeId);
  });
});
