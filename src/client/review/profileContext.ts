// REV-2 — the compact 学生画像 text woven into `review.explain` (the FIRST MEM-3
// consumer, review-loop.md §4-REV-2). Deliberately SMALL and pure: a few lines of
// already-derived profile facts (top 弱项 + the learning streak), so the prompt gains
// personalization without shipping the digest tiers. Hidden facts are the user's
// "don't say that" — they are excluded here exactly as the 画像页 hides them.
// Generalizing this into ChatContext/every operation (with the per-provider-kind
// consent policy) is MEM-3; this module stays a one-operation seam until then.

import type { ProfileFactView } from "../data/entityClient";

/** How many 弱项 facts the context carries — it must stay a few lines, not a dossier. */
export const PROFILE_CONTEXT_WEAK_LIMIT = 3;

/**
 * Profile facts (as GET /api/memory/profile returns them: derived + overrides
 * merged, pinned floated first) → the compact context text, or undefined when
 * nothing useful derives — the caller then omits the key entirely, keeping the
 * explain prompt byte-identical to its REV-1 form.
 */
export function buildProfileContext(facts: readonly ProfileFactView[]): string | undefined {
  const visible = facts.filter((fact) => !fact.hidden);
  // Incoming order is the profile tier's own ranking (pinned first, then weak facts
  // by fail ratio) — preserve it, just cap the count.
  const weak = visible.filter((fact) => fact.kind === "weak").slice(0, PROFILE_CONTEXT_WEAK_LIMIT);
  const streak = visible.find((fact) => fact.key === "activity:streak");
  const lines = [...weak, ...(streak ? [streak] : [])].map((fact) => `${fact.title} — ${fact.value}`);
  return lines.length > 0 ? lines.join("\n") : undefined;
}
