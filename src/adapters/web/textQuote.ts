// W3C Web Annotation TextQuoteSelector support: anchor a note on a live page by
// the exact selected string plus surrounding prefix/suffix context. This needs
// no injected study-ids (unlike html_selection), so it survives across visits
// and works on third-party pages embedded in the Electron webview.
//
// Pure + dependency-free → fully unit-testable without a DOM.

export type TextQuoteSelector = {
  exact: string;
  prefix: string;
  suffix: string;
};

const DEFAULT_CONTEXT = 32;

export function createTextQuoteSelector(
  text: string,
  start: number,
  end: number,
  context = DEFAULT_CONTEXT
): TextQuoteSelector {
  return {
    exact: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - context), start),
    suffix: text.slice(end, Math.min(text.length, end + context))
  };
}

function sharedSuffixLength(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i += 1;
  return i;
}

function sharedPrefixLength(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return i;
}

// Finds the character range of `exact` in `text`, disambiguating multiple
// occurrences by how well the surrounding text matches prefix/suffix.
export function resolveTextQuote(text: string, selector: TextQuoteSelector): { start: number; end: number } | null {
  const { exact, prefix, suffix } = selector;
  if (!exact) return null;

  const candidates: number[] = [];
  let from = 0;
  for (;;) {
    const index = text.indexOf(exact, from);
    if (index === -1) break;
    candidates.push(index);
    from = index + 1;
  }
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return { start: candidates[0], end: candidates[0] + exact.length };

  let best = candidates[0];
  let bestScore = -1;
  for (const index of candidates) {
    const before = text.slice(Math.max(0, index - prefix.length), index);
    const after = text.slice(index + exact.length, index + exact.length + suffix.length);
    const score = sharedSuffixLength(before, prefix) + sharedPrefixLength(after, suffix);
    if (score > bestScore) {
      bestScore = score;
      best = index;
    }
  }
  return { start: best, end: best + exact.length };
}
