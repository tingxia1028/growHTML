// Pinyin search matching (SEARCH-2; docs/design/global-search.md §2/§3 — "pinyin +
// fuzzy (SC-3 fusion)"). Lets a user find a CJK title by typing its romanization:
// 全拼 ("fuli" → 浮力) or 首字母 ("fl" → 浮力). An ADDITIVE lowest-priority pass reached
// ONLY when the literal + fuzzy tiers in rank.ts found nothing — so every existing
// score stays byte-stable and pinyin never outranks a real text hit.
//
// DEPENDENCY VERDICT (see the report / design status): `pinyin-pro` is ALREADY a
// project dependency — SPEECH-3 shipped it as a CORE text capability (the 注音 ruby
// engine, src/client/speech/pinyin.ts). It is pure offline JS with a built-in
// word-level dictionary, and it runs identically under Node (the search service is
// server-side). So pinyin search adds ZERO new dependency and ZERO incremental bundle
// cost beyond what 注音 already pays — no compact hand-rolled table needed. We import
// it here (a small server-side seam) rather than into the pure rank.ts, so the shared
// rank core stays dependency-free.

import { pinyin } from "pinyin-pro";
import { matchText, RANK_FUZZY, type TextMatch } from "./rank";

// Reuse SPEECH-3's Han gate exactly (same ranges) so "does this even have CJK?" agrees
// across the app. Non-CJK text has no pinyin form → pinyin matching is skipped.
const CJK_RE = /[〇㐀-䶿一-鿿豈-﫿]/;

/** True when the text has at least one CJK ideograph worth romanizing. */
export function hasCjk(text: string): boolean {
  return CJK_RE.test(text);
}

/** True when a query looks like a romanization attempt (ASCII letters only) — the gate
 *  that keeps pinyin matching off for CJK or mixed queries (those already hit literally). */
export function isRomanQuery(query: string): boolean {
  return /^[a-z]+$/i.test(query.trim());
}

export type PinyinForms = {
  /** Full pinyin with syllables joined, toneless: 浮力定律 → "fulidinglv". */
  full: string;
  /** First-letter initials, toneless: 浮力定律 → "fldl". */
  initials: string;
};

/**
 * The two searchable romanizations of a CJK-bearing string. Non-CJK chars (latin,
 * digits, spaces) are DROPPED from both forms so "ai gpt" style titles still initial-
 * match cleanly and a stray space never breaks a contiguous "fuli" query. pinyin-pro's
 * word-level dictionary resolves 多音字 from context (长大→zhang, not chang), so the
 * initials/full are the reading a human would type. Returns null when there's no CJK.
 */
export function pinyinForms(text: string): PinyinForms | null {
  if (!hasCjk(text)) return null;
  let full = "";
  let initials = "";
  // type:"all" → one item per zh char with context applied; non-zh runs arrive grouped.
  for (const item of pinyin(text, { type: "all", toneType: "none" })) {
    if (item.isZh && item.pinyin) {
      const syllable = item.pinyin.replace(/\s+/g, "");
      if (syllable) {
        full += syllable;
        initials += syllable[0];
      }
    }
  }
  return full ? { full, initials } : null;
}

/**
 * Match a roman query against a CJK string via its pinyin forms. Returns a match at
 * RANK_FUZZY (the additive lowest tier) reusing rank.ts's own tier logic on the
 * romanization — so "fuli"/"fl" prefix-match 浮力, a mid-string initials hit is a
 * substring match, etc., all collapsed to RANK_FUZZY here so a genuine text hit always
 * wins. `index` is 0 (the snippet is cut from the ORIGINAL CJK text by the caller,
 * which shows the title itself — a pinyin offset would be meaningless in it).
 *
 * Returns null when: the query isn't roman, the text has no CJK, or neither form hits.
 */
export function matchPinyin(query: string, text: string): TextMatch | null {
  const q = query.trim().toLowerCase();
  if (!q || !isRomanQuery(q)) return null;
  const forms = pinyinForms(text);
  if (!forms) return null;
  // Initials first (fl → 浮力 is the higher-signal shorthand), then full pinyin.
  const hit = matchText(q, forms.initials) ?? matchText(q, forms.full);
  return hit ? { rank: RANK_FUZZY, index: 0 } : null;
}
