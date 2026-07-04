// chatContextAssembly (ai-workspace.md §W2) — the PURE assembly of the chat's
// source-level context set: the focused pane's source UNION the session's explicit
// attachments, de-duped by sourceId (focused-first), then bounded by a cross-source
// total-char cap. No React, no fetch, no ai import — the network read
// (entityClient.sourceBundle) happens in the WorkspaceContext resolver that CALLS this;
// keeping the merge/cap pure makes it unit-testable in isolation.
//
// The de-dup KEY is the sourceId from the pane model / attachment refs — NOT the flat
// ChatContext title. So when the focused source is ALSO an explicit attachment, it
// appears ONCE (focused-first), carrying the focused bundle.

import type { ChatContextSource, SourceBundle } from "../data/entityClient";

/** A resolved bundle tagged with whether it is the FOCUSED source (union precedence). */
export type ResolvedBundle = { sourceId: string; focused: boolean; bundle: SourceBundle };

/**
 * Cross-source total excerpt-char cap (ai-workspace.md §W2 token budget). When the
 * summed excerpt length exceeds this, TAIL excerpts are dropped FIRST (their titles +
 * notes stay — the high-signal part) until the total fits. The per-source excerpt cap
 * (head slice) already ran in the bundle service; this is the whole-conversation ceiling.
 */
export const CONTEXT_TOTAL_EXCERPT_CAP = 16000;

/** A bundle → the ai ChatContextSource shape (drop empty note arrays for a clean prompt). */
function toContextSource(bundle: SourceBundle): ChatContextSource {
  const source: ChatContextSource = {
    title: bundle.title,
    type: bundle.type,
    location: bundle.location,
    excerpt: bundle.excerpt
  };
  if (bundle.notes.length > 0) source.notes = bundle.notes;
  return source;
}

/**
 * Union the focused source with the session's attachments, de-duped by sourceId with
 * FOCUSED-FIRST precedence: the focused bundle leads, then each attachment not already
 * present (by sourceId). A source that is both focused AND attached appears once,
 * carrying the focused bundle. Order within attachments is preserved.
 */
export function unionBundles(resolved: ResolvedBundle[]): SourceBundle[] {
  const focused = resolved.filter((entry) => entry.focused);
  const attached = resolved.filter((entry) => !entry.focused);
  const seen = new Set<string>();
  const out: SourceBundle[] = [];
  for (const entry of [...focused, ...attached]) {
    if (seen.has(entry.sourceId)) continue;
    seen.add(entry.sourceId);
    out.push(entry.bundle);
  }
  return out;
}

/**
 * Apply the cross-source total-excerpt cap: walk the sources in order, keeping each
 * excerpt while the running total stays under the cap; once a source would overflow,
 * DROP its excerpt (and every later source's excerpt) — titles + notes are retained so
 * the model still knows the source exists and reads its notes. Mutates nothing; returns
 * new ChatContextSource objects.
 */
export function capTotalExcerpts(
  sources: ChatContextSource[],
  cap = CONTEXT_TOTAL_EXCERPT_CAP
): ChatContextSource[] {
  let used = 0;
  let dropping = false;
  return sources.map((source) => {
    if (!source.excerpt) return source;
    if (dropping) return { ...source, excerpt: undefined };
    if (used + source.excerpt.length > cap) {
      dropping = true; // this excerpt and all tail excerpts are dropped
      return { ...source, excerpt: undefined };
    }
    used += source.excerpt.length;
    return source;
  });
}

/**
 * The full assembly: union (focused-first, sourceId-deduped) → ChatContextSource[] →
 * cross-source cap. Empty input → [] so the caller OMITS the `sources` key entirely
 * (the zero-attachment byte-identical path).
 */
export function assembleContextSources(
  resolved: ResolvedBundle[],
  cap = CONTEXT_TOTAL_EXCERPT_CAP
): ChatContextSource[] {
  const bundles = unionBundles(resolved);
  if (bundles.length === 0) return [];
  return capTotalExcerpts(bundles.map(toContextSource), cap);
}
