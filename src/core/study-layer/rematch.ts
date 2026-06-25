// Rematch resolver — the heart of importing someone else's anchors. An imported
// anchor carries only PORTABLE locators (the W3C TextQuoteSelector: quote +
// contextBefore/contextAfter, plus page/url/rect for geometric kinds). The author's
// sourceId / studyId / selector are local realizations and meaningless here, so we
// re-locate the quote inside the IMPORTER's own copy of the source and report how
// confident the match is. Pure + dependency-free so it is exhaustively unit-tested.
//
// Iron law: never silently drop. A quote we cannot find returns `unmatched` — the
// caller still keeps the note, just flagged as un-located for manual re-anchoring.

import type { AnchorKind } from "../schema";

export type MatchStatus = "matched" | "fuzzy" | "unmatched";

// The portable subset of an anchor (what travels in a `.studypack`).
export type PortableAnchor = {
  anchorKind: AnchorKind;
  quote: string;
  contextBefore?: string;
  contextAfter?: string;
  page?: number;
  normalizedUrl?: string;
  rect?: [number, number, number, number];
  filePath?: string;
  symbol?: string;
};

// Where a quote landed in the local text, with freshly-read local context — this is
// what the caller turns into a local anchor realization.
export type TextRealization = {
  index: number;
  quote: string;
  contextBefore: string;
  contextAfter: string;
};

export type RematchResult = {
  status: MatchStatus;
  text?: TextRealization;
};

export type RematchContext = {
  /** Local source plain text (text kinds + code; PDF text when no per-page text). */
  text?: string;
  /** Per-page local text for PDFs, if available. */
  pageText?: (page: number) => string | undefined;
  /** Whether the local binary matches the author's (fileHash/contentHash equal). */
  sameBinary?: boolean;
};

const CONTEXT_WINDOW = 32;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Longest common run anchored at the END of both strings.
function suffixOverlap(a: string, b: string): number {
  let n = 0;
  const max = Math.min(a.length, b.length);
  while (n < max && a[a.length - 1 - n] === b[b.length - 1 - n]) n += 1;
  return n;
}

// Longest common run anchored at the START of both strings.
function prefixOverlap(a: string, b: string): number {
  let n = 0;
  const max = Math.min(a.length, b.length);
  while (n < max && a[n] === b[n]) n += 1;
  return n;
}

function realizationAt(localText: string, index: number, length: number): TextRealization {
  return {
    index,
    quote: localText.slice(index, index + length),
    contextBefore: localText.slice(Math.max(0, index - CONTEXT_WINDOW), index),
    contextAfter: localText.slice(index + length, index + length + CONTEXT_WINDOW)
  };
}

// Whitespace-flexible, case-insensitive search (the fuzzy tier): tolerant of
// collapsed/expanded whitespace and casing differences between the two copies.
function flexibleMatch(localText: string, quote: string): { index: number; length: number } | null {
  const tokens = quote.trim().split(/\s+/).map(escapeRegExp).filter(Boolean);
  if (!tokens.length) return null;
  const match = new RegExp(tokens.join("\\s+"), "i").exec(localText);
  return match ? { index: match.index, length: match[0].length } : null;
}

// Re-locate a text quote in the importer's local text. Tiers:
//   1. exact prefix+quote+suffix  → matched (unambiguous)
//   2. exact quote: one hit       → matched; several hits → pick best by context
//                                    overlap (matched if context agrees, else fuzzy)
//   3. whitespace/case-flexible   → fuzzy
//   4. nothing                    → unmatched
export function rematchText(
  localText: string,
  portable: Pick<PortableAnchor, "quote" | "contextBefore" | "contextAfter">
): RematchResult {
  const quote = portable.quote ?? "";
  if (!quote.trim() || !localText) return { status: "unmatched" };
  const before = portable.contextBefore ?? "";
  const after = portable.contextAfter ?? "";

  // 1) exact prefix + quote + suffix.
  if (before || after) {
    const needle = before + quote + after;
    const at = localText.indexOf(needle);
    if (at !== -1) {
      return { status: "matched", text: realizationAt(localText, at + before.length, quote.length) };
    }
  }

  // 2) exact quote occurrences.
  const occurrences: number[] = [];
  let from = 0;
  for (;;) {
    const at = localText.indexOf(quote, from);
    if (at === -1) break;
    occurrences.push(at);
    from = at + Math.max(1, quote.length);
  }
  if (occurrences.length === 1) {
    return { status: "matched", text: realizationAt(localText, occurrences[0], quote.length) };
  }
  if (occurrences.length > 1) {
    let best = occurrences[0];
    let bestScore = -1;
    for (const at of occurrences) {
      const localBefore = localText.slice(Math.max(0, at - CONTEXT_WINDOW), at);
      const localAfter = localText.slice(at + quote.length, at + quote.length + CONTEXT_WINDOW);
      const score = suffixOverlap(localBefore, before) + prefixOverlap(localAfter, after);
      if (score > bestScore) {
        bestScore = score;
        best = at;
      }
    }
    // Context picked a winner → matched; no context signal → genuinely ambiguous.
    return { status: bestScore > 0 ? "matched" : "fuzzy", text: realizationAt(localText, best, quote.length) };
  }

  // 3) whitespace/case-flexible.
  const flex = flexibleMatch(localText, quote);
  if (flex) return { status: "fuzzy", text: realizationAt(localText, flex.index, flex.length) };

  // 4) not found — keep the note, flag for manual re-anchor.
  return { status: "unmatched" };
}

// Dispatch by anchor kind. Text/code kinds re-locate by quote; geometric kinds
// (pdf figure / image region) re-locate by normalized rect, which is portable when
// the underlying binary is the same copy.
export function rematchAnchor(portable: PortableAnchor, ctx: RematchContext): RematchResult {
  switch (portable.anchorKind) {
    case "html_selection":
    case "web_text_quote":
      return rematchText(ctx.text ?? "", portable);

    case "pdf_selection": {
      if (portable.quote?.trim()) {
        const text = (portable.page != null ? ctx.pageText?.(portable.page) : undefined) ?? ctx.text ?? "";
        const result = rematchText(text, portable);
        if (result.status !== "unmatched") return result;
      }
      // Figure / scanned region: the rect is the locator.
      if (portable.rect) return { status: ctx.sameBinary === false ? "fuzzy" : "matched" };
      return { status: "unmatched" };
    }

    case "image_region":
      if (portable.rect) return { status: ctx.sameBinary === false ? "fuzzy" : "matched" };
      return { status: "unmatched" };

    case "code_range": {
      const text = ctx.text ?? "";
      if (portable.quote?.trim()) return rematchText(text, portable);
      if (portable.symbol && text.includes(portable.symbol)) return { status: "fuzzy" };
      return { status: "unmatched" };
    }

    default:
      return { status: "unmatched" };
  }
}
