// Learner-memory 长期 tier — deterministic profile FACTS distilled from digests
// (MEM-2, docs/design/learner-memory.md §2/§4) plus the user-override layer that makes
// the profile USER-OWNED (§6.4: view / edit / pin / hide / correct). Facts always
// RECOMPUTE from the digest summary (rule-based, no LLM — the optional narrative is a
// later add-on); overrides are a small separate document keyed by fact `key`, so a
// recompute never loses a pin/hide/correction and a stale override simply waits for
// its fact to reappear.

import { z } from "zod";
import type { MemoryDigestSummary, MemoryDimensionSummary } from "./digest";

// —— Deterministic fact rules (V1 thresholds) ——
/** 弱项: a bucket is weak when its graded fail ratio reaches this… */
export const PROFILE_WEAK_FAIL_RATIO = 0.5;
/** …over at least this many graded attempts (pass+fail) — no verdicts off one sample. */
export const PROFILE_WEAK_MIN_ATTEMPTS = 3;
/** 常用: how many top verbs / content types one fact lists. */
export const PROFILE_TOP_LIMIT = 3;

export type ProfileFactKind = "weak" | "activity" | "top";

// One derived fact (learner-memory §2 ProfileFact): `key` is the STABLE identity
// overrides attach to; `evidence` names the digest cells it was computed from.
export type ProfileFact = {
  key: string;
  kind: ProfileFactKind;
  title: string;
  value: string;
  evidence: string[];
  confidence?: number;
};

// The user-override layer — persisted separately (memory-profile-overrides.json),
// NEVER recomputed: pin (surface first), hide (suppress), note (the user's correction).
export const profileFactOverrideSchema = z.object({
  key: z.string().min(1),
  pinned: z.boolean().optional(),
  hidden: z.boolean().optional(),
  note: z.string().max(2000).optional()
});
export type ProfileFactOverride = z.infer<typeof profileFactOverrideSchema>;

export const profileOverridesSchema = z.object({
  facts: z.array(profileFactOverrideSchema).default([])
});
export type ProfileOverrides = z.infer<typeof profileOverridesSchema>;

export const emptyProfileOverrides: ProfileOverrides = { facts: [] };

/** A fact as the 画像页 shows it: the derived fact merged with its override. */
export type ProfileFactView = ProfileFact & {
  pinned: boolean;
  hidden: boolean;
  note?: string;
};

const DIMENSION_LABEL: Record<string, string> = {
  subject: "学科",
  contentType: "类型",
  sourceId: "来源"
};

function percent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

function topEntries(counts: Record<string, number>, limit: number): Array<[string, number]> {
  return Object.entries(counts)
    .sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : a[0] < b[0] ? -1 : 1))
    .slice(0, limit);
}

// 弱项 comes from HUMAN buckets (subject/contentType); per-source fail ratios stay in
// the digest summaries for REV-2's queue weights but don't make readable 画像 facts.
function weakFacts(dimensions: readonly MemoryDimensionSummary[]): ProfileFact[] {
  return dimensions
    .filter(
      (cell) =>
        (cell.dimension === "subject" || cell.dimension === "contentType") &&
        cell.review.attempts >= PROFILE_WEAK_MIN_ATTEMPTS &&
        cell.review.failRatio >= PROFILE_WEAK_FAIL_RATIO
    )
    .sort((a, b) => {
      if (b.review.failRatio !== a.review.failRatio) return b.review.failRatio - a.review.failRatio;
      if (b.review.attempts !== a.review.attempts) return b.review.attempts - a.review.attempts;
      const key = `${a.dimension}:${a.bucket}`;
      const other = `${b.dimension}:${b.bucket}`;
      return key < other ? -1 : 1;
    })
    .map((cell) => ({
      key: `weak:${cell.dimension}:${cell.bucket}`,
      kind: "weak" as const,
      title: `弱项:${cell.bucket}`,
      value: `复习错误率 ${percent(cell.review.failRatio)}(${cell.review.fail}/${cell.review.attempts} 次未过,${DIMENSION_LABEL[cell.dimension]})`,
      evidence: [`${cell.dimension}:${cell.bucket}`],
      confidence: Math.min(1, Math.round((cell.review.attempts / 10) * 100) / 100)
    }));
}

/**
 * Digest summary → the deterministic V1 fact set: 弱项 (fail-ratio buckets), 活跃
 * (last-active + streak), 常用 (top verbs / content types). Pure and stable — the same
 * summary always yields the same facts in the same order.
 */
export function deriveProfileFacts(summary: MemoryDigestSummary): ProfileFact[] {
  const facts: ProfileFact[] = [...weakFacts(summary.dimensions)];

  const { overall } = summary;
  if (overall.events > 0 && overall.lastActiveAt !== null) {
    const lastDay = overall.activeDays[overall.activeDays.length - 1];
    facts.push({
      key: "activity:last-active",
      kind: "activity",
      title: "最近活跃",
      value: `${lastDay}(共 ${overall.activeDays.length} 个活跃日,${overall.events} 次行为)`,
      evidence: [`day:${lastDay}`]
    });
    facts.push({
      key: "activity:streak",
      kind: "activity",
      title: "连续学习",
      value: `${overall.streakDays} 天(至 ${lastDay})`,
      evidence: overall.activeDays.slice(-overall.streakDays).map((day) => `day:${day}`)
    });
  }

  const verbs = topEntries(overall.counts, PROFILE_TOP_LIMIT);
  if (verbs.length > 0) {
    facts.push({
      key: "top:verbs",
      kind: "top",
      title: "最常做",
      value: verbs.map(([verb, count]) => `${verb} ×${count}`).join(" · "),
      evidence: verbs.map(([verb]) => `verb:${verb}`)
    });
  }

  const typeCounts: Record<string, number> = {};
  for (const cell of summary.dimensions) {
    if (cell.dimension === "contentType") typeCounts[cell.bucket] = cell.events;
  }
  const types = topEntries(typeCounts, PROFILE_TOP_LIMIT);
  if (types.length > 0) {
    facts.push({
      key: "top:content-types",
      kind: "top",
      title: "常用类型",
      value: types.map(([bucket, count]) => `${bucket} ×${count}`).join(" · "),
      evidence: types.map(([bucket]) => `contentType:${bucket}`)
    });
  }

  return facts;
}

/**
 * Merge derived facts with the override layer: every fact gains pinned/hidden/note;
 * pinned facts float first (stable within each group). Overrides whose fact key no
 * longer derives are simply not shown — they stay in the stored document untouched,
 * so facts recompute and overrides survive.
 */
export function applyProfileOverrides(
  facts: readonly ProfileFact[],
  overrides: ProfileOverrides
): ProfileFactView[] {
  const byKey = new Map(overrides.facts.map((override) => [override.key, override]));
  const views = facts.map((fact) => {
    const override = byKey.get(fact.key);
    return {
      ...fact,
      pinned: override?.pinned === true,
      hidden: override?.hidden === true,
      note: override?.note
    };
  });
  const pinned = views.filter((view) => view.pinned);
  const rest = views.filter((view) => !view.pinned);
  return [...pinned, ...rest];
}

/**
 * The override-editing primitive the 画像页 dispatches: set/merge one fact's override
 * fields, dropping entries that become all-default (no pin, no hide, no note) so the
 * stored document never accumulates dead weight.
 */
export function upsertProfileOverride(
  overrides: ProfileOverrides,
  key: string,
  patch: Partial<Omit<ProfileFactOverride, "key">>
): ProfileOverrides {
  const existing = overrides.facts.find((override) => override.key === key);
  const merged: ProfileFactOverride = { key, ...existing, ...patch };
  const empty = merged.pinned !== true && merged.hidden !== true && (merged.note ?? "") === "";
  const rest = overrides.facts.filter((override) => override.key !== key);
  return { facts: empty ? rest : [...rest, merged] };
}
