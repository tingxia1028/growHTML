// pinyin engine (SPEECH-3 注音 — docs/design/speech-and-young-learners.md §3): pure
// functions turning CJK text into per-character tone-marked pinyin for the ruby
// (`<ruby>字<rt>zì</rt></ruby>`) render layer. Backed by pinyin-pro (offline, pure JS)
// whose built-in dictionary does WORD-LEVEL segmentation, so 多音字 resolve from
// context (长大 → zhǎng, 长度 → cháng) — never naive per-char lookups.
//
// No React, no fetch, no entities: the same universality law as 朗读 (SPEECH-1b) —
// 注音 is a capability of TEXT; surfaces call these helpers, the engine knows nothing
// about surfaces.

import { pinyin } from "pinyin-pro";

export type AnnotatedChar = {
  /** One source character (code point — surrogate pairs stay whole). */
  char: string;
  /** Tone-marked pinyin for a CJK char; null for everything else (latin/digits/punct). */
  pinyin: string | null;
};

// Han detection: 〇 (U+3007) + CJK Unified Ideographs (U+4E00–U+9FFF) + Extension A
// (U+3400–U+4DBF) + Compatibility Ideographs (U+F900–U+FAFF). Supplementary-plane
// extensions pass through annotate() unharmed as plain chars — pinyin-pro has no
// readings for most of them anyway.
const CJK_RE = /[〇㐀-䶿一-鿿豈-﫿]/;

/** True when the text contains at least one CJK ideograph (the 注音 affordance gate). */
export function containsCjk(text: string): boolean {
  return CJK_RE.test(text);
}

/**
 * Per-character annotation preserving the source text verbatim: CJK chars carry their
 * context-resolved tone-marked pinyin, all other chars (punctuation, latin, spaces,
 * newlines) come back with pinyin null so callers can render them as plain runs.
 * Concatenating `char` over the result reproduces the input exactly.
 */
export function annotate(text: string): AnnotatedChar[] {
  if (!text) return [];
  const out: AnnotatedChar[] = [];
  // type:"all" → one item per zh char ({origin, pinyin, isZh}) with word-level
  // context already applied; non-zh stretches may arrive GROUPED in one item
  // (origin = the whole run, pinyin = "") — split those back into code points.
  for (const item of pinyin(text, { type: "all", toneType: "symbol" })) {
    if (item.isZh && item.pinyin) {
      out.push({ char: item.origin, pinyin: item.pinyin });
    } else {
      for (const char of Array.from(item.origin)) out.push({ char, pinyin: null });
    }
  }
  return out;
}
