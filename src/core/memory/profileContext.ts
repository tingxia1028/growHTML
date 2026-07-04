// The compact 学生画像 text distilled from profile facts — REV-2's builder,
// PROMOTED from src/client/review/profileContext.ts to core by ACTION-2a so the
// SERVER can compose the same learner context into the auto-context envelope
// (docs/design/action-v2-auto-context.md §1: the generalized profileContext =
// MEM-3's "profileContext into all kit prompts" absorbed). Deliberately SMALL and
// pure: a few lines of already-derived facts (top 弱项 + the learning streak).
// Hidden facts are the user's "don't say that" — excluded here exactly as the
// 画像页 hides them; the managed-provider hard strip stays at the composition /
// gate layer (src/server/services/{autoContext,ai}.ts), never here.

import type { ProfileFactView } from "./profile";

/** How many 弱项 facts the context carries — it must stay a few lines, not a dossier. */
export const PROFILE_CONTEXT_WEAK_LIMIT = 3;

/**
 * Profile facts (as GET /api/memory/profile returns them: derived + overrides
 * merged, pinned floated first) → the compact context text, or undefined when
 * nothing useful derives — the caller then omits the section/key entirely,
 * keeping profile-free prompts byte-identical to their REV-1 form.
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
