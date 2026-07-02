// MEM-2 profile facts — deterministic derivation from digest summaries (弱项/活跃/常用
// with the doc-grounded thresholds) and the override layer: pin/hide/correct survive a
// fact recompute, stale overrides wait instead of dying, empty overrides drop out.

import { describe, expect, it } from "vitest";
import { digestMemoryEvents, summarizeMemoryDigests, type MemoryDigestEventLike } from "./digest";
import {
  applyProfileOverrides,
  deriveProfileFacts,
  emptyProfileOverrides,
  PROFILE_WEAK_FAIL_RATIO,
  PROFILE_WEAK_MIN_ATTEMPTS,
  profileOverridesSchema,
  upsertProfileOverride,
  type ProfileOverrides
} from "./profile";

const review = (createdAt: string, result: string, subject: MemoryDigestEventLike["subject"], payload?: Record<string, unknown>) =>
  ({ verb: "note.review", createdAt, subject, payload: { result, ...payload } }) as MemoryDigestEventLike;
const ev = (verb: string, createdAt: string, subject?: MemoryDigestEventLike["subject"]): MemoryDigestEventLike => ({
  verb,
  createdAt,
  subject
});

const summarize = (events: MemoryDigestEventLike[]) => summarizeMemoryDigests(digestMemoryEvents(events));

describe("deriveProfileFacts", () => {
  it("derives 弱项 for buckets at/over the fail-ratio threshold with enough attempts", () => {
    expect(PROFILE_WEAK_MIN_ATTEMPTS).toBe(3);
    expect(PROFILE_WEAK_FAIL_RATIO).toBe(0.5);
    const facts = deriveProfileFacts(
      summarize([
        // quiz: 2 fail / 1 pass = ratio 2/3 over 3 attempts → weak.
        review("2026-06-20T08:00:00.000Z", "fail", { contentType: "quiz" }),
        review("2026-06-20T09:00:00.000Z", "fail", { contentType: "quiz" }),
        review("2026-06-20T10:00:00.000Z", "pass", { contentType: "quiz" }),
        // 学科 物理 (payload.subject): 3 fail / 0 pass → weak, HIGHER ratio → listed first.
        review("2026-06-21T08:00:00.000Z", "fail", {}, { subject: "物理" }),
        review("2026-06-21T09:00:00.000Z", "fail", {}, { subject: "物理" }),
        review("2026-06-21T10:00:00.000Z", "fail", {}, { subject: "物理" })
      ])
    );
    const weak = facts.filter((fact) => fact.kind === "weak");
    expect(weak.map((fact) => fact.key)).toEqual(["weak:subject:物理", "weak:contentType:quiz"]);
    expect(weak[0].title).toBe("弱项:物理");
    expect(weak[0].value).toContain("100%");
    expect(weak[0].value).toContain("3/3");
    expect(weak[1].value).toContain("67%");
    expect(weak[1].evidence).toEqual(["contentType:quiz"]);
    expect(weak[1].confidence).toBe(0.3); // 3 attempts / 10
  });

  it("applies BOTH weak thresholds: under min attempts or under the ratio → no fact", () => {
    // 2 attempts, 100% fail — not enough attempts.
    const fewAttempts = deriveProfileFacts(
      summarize([
        review("2026-06-20T08:00:00.000Z", "fail", { contentType: "quiz" }),
        review("2026-06-20T09:00:00.000Z", "fail", { contentType: "quiz" })
      ])
    );
    expect(fewAttempts.filter((fact) => fact.kind === "weak")).toEqual([]);

    // 4 attempts, ratio 0.25 — under the ratio. Skips never count as attempts.
    const lowRatio = deriveProfileFacts(
      summarize([
        review("2026-06-20T08:00:00.000Z", "fail", { contentType: "quiz" }),
        review("2026-06-20T09:00:00.000Z", "pass", { contentType: "quiz" }),
        review("2026-06-20T10:00:00.000Z", "pass", { contentType: "quiz" }),
        review("2026-06-20T11:00:00.000Z", "pass", { contentType: "quiz" }),
        review("2026-06-20T12:00:00.000Z", "skip", { contentType: "quiz" })
      ])
    );
    expect(lowRatio.filter((fact) => fact.kind === "weak")).toEqual([]);

    // Exactly at both boundaries (3 attempts, ratio 0.5… needs fail/attempts ≥ .5 → 2/4) → weak.
    const atBoundary = deriveProfileFacts(
      summarize([
        review("2026-06-20T08:00:00.000Z", "fail", { contentType: "quiz" }),
        review("2026-06-20T09:00:00.000Z", "fail", { contentType: "quiz" }),
        review("2026-06-20T10:00:00.000Z", "pass", { contentType: "quiz" }),
        review("2026-06-20T11:00:00.000Z", "pass", { contentType: "quiz" })
      ])
    );
    expect(atBoundary.map((fact) => fact.key)).toContain("weak:contentType:quiz");
  });

  it("weak facts never come from sourceId buckets (they stay in digests for REV-2)", () => {
    const facts = deriveProfileFacts(
      summarize([
        review("2026-06-20T08:00:00.000Z", "fail", { sourceId: "src_a" }),
        review("2026-06-20T09:00:00.000Z", "fail", { sourceId: "src_a" }),
        review("2026-06-20T10:00:00.000Z", "fail", { sourceId: "src_a" })
      ])
    );
    expect(facts.filter((fact) => fact.kind === "weak")).toEqual([]);
  });

  it("derives 活跃 (last-active + streak) and 常用 (top verbs / content types) deterministically", () => {
    const facts = deriveProfileFacts(
      summarize([
        ev("open", "2026-06-23T08:00:00.000Z"),
        ev("read", "2026-06-24T08:00:00.000Z"),
        ev("read", "2026-06-25T08:00:00.000Z"),
        ev("note.create", "2026-06-25T09:00:00.000Z", { contentType: "quiz" }),
        ev("note.create", "2026-06-25T10:00:00.000Z", { contentType: "quiz" }),
        ev("note.create", "2026-06-25T11:00:00.000Z", { contentType: "flashcard" }),
        ev("search", "2026-06-25T12:00:00.000Z")
      ])
    );
    const byKey = new Map(facts.map((fact) => [fact.key, fact]));
    expect(byKey.get("activity:last-active")?.value).toBe("2026-06-25(共 3 个活跃日,7 次行为)");
    expect(byKey.get("activity:streak")?.value).toBe("3 天(至 2026-06-25)");
    // top verbs: note.create ×3, read ×2, then the count-1 tie breaks alphabetically (open).
    expect(byKey.get("top:verbs")?.value).toBe("note.create ×3 · read ×2 · open ×1");
    expect(byKey.get("top:content-types")?.value).toBe("quiz ×2 · flashcard ×1");
    // Stable order: weak…, activity, top.
    expect(facts.map((fact) => fact.kind)).toEqual(["activity", "activity", "top", "top"]);
  });

  it("derives NO facts from an empty summary", () => {
    expect(deriveProfileFacts(summarize([]))).toEqual([]);
  });
});

describe("profile overrides", () => {
  const facts = deriveProfileFacts(
    summarize([
      review("2026-06-20T08:00:00.000Z", "fail", { contentType: "quiz" }),
      review("2026-06-20T09:00:00.000Z", "fail", { contentType: "quiz" }),
      review("2026-06-20T10:00:00.000Z", "fail", { contentType: "quiz" })
    ])
  );

  it("merges pin/hide/note onto facts and floats pinned first (stable otherwise)", () => {
    const overrides: ProfileOverrides = {
      facts: [
        { key: "top:verbs", pinned: true },
        { key: "weak:contentType:quiz", hidden: true, note: "其实是笔误" }
      ]
    };
    const views = applyProfileOverrides(facts, overrides);
    expect(views[0].key).toBe("top:verbs");
    expect(views[0].pinned).toBe(true);
    const weak = views.find((view) => view.key === "weak:contentType:quiz");
    expect(weak?.hidden).toBe(true);
    expect(weak?.note).toBe("其实是笔误");
    // Non-overridden facts default to visible/unpinned.
    expect(views.find((view) => view.key === "activity:streak")).toMatchObject({ pinned: false, hidden: false });
  });

  it("facts recompute, overrides survive: the same override applies to freshly derived facts", () => {
    const overrides = upsertProfileOverride(emptyProfileOverrides, "weak:contentType:quiz", { pinned: true });
    const before = applyProfileOverrides(facts, overrides);
    expect(before[0].key).toBe("weak:contentType:quiz");

    // Recompute from MORE events (the weak fact still derives) — the pin still applies.
    const recomputed = deriveProfileFacts(
      summarize([
        review("2026-06-20T08:00:00.000Z", "fail", { contentType: "quiz" }),
        review("2026-06-20T09:00:00.000Z", "fail", { contentType: "quiz" }),
        review("2026-06-20T10:00:00.000Z", "fail", { contentType: "quiz" }),
        review("2026-06-21T10:00:00.000Z", "fail", { contentType: "quiz" }),
        ev("open", "2026-06-22T10:00:00.000Z")
      ])
    );
    const after = applyProfileOverrides(recomputed, overrides);
    expect(after[0].key).toBe("weak:contentType:quiz");
    expect(after[0].pinned).toBe(true);
    expect(after[0].value).toContain("4/4"); // the fact itself DID recompute
  });

  it("a stale override (fact no longer derives) is not shown but stays in the document", () => {
    const overrides = upsertProfileOverride(emptyProfileOverrides, "weak:subject:古文", { hidden: true });
    const views = applyProfileOverrides(facts, overrides);
    expect(views.find((view) => view.key === "weak:subject:古文")).toBeUndefined();
    expect(overrides.facts).toHaveLength(1); // still stored — survives until the fact returns
  });

  it("upsertProfileOverride merges patches and drops all-default entries", () => {
    let overrides = upsertProfileOverride(emptyProfileOverrides, "top:verbs", { pinned: true });
    overrides = upsertProfileOverride(overrides, "top:verbs", { note: "更喜欢闪卡" });
    expect(overrides.facts).toEqual([{ key: "top:verbs", pinned: true, note: "更喜欢闪卡" }]);

    overrides = upsertProfileOverride(overrides, "top:verbs", { pinned: false, note: "" });
    expect(overrides.facts).toEqual([]); // nothing left to say → entry removed
  });

  it("profileOverridesSchema validates and defaults", () => {
    expect(profileOverridesSchema.parse({})).toEqual({ facts: [] });
    expect(() => profileOverridesSchema.parse({ facts: [{ key: "" }] })).toThrow();
    expect(() => profileOverridesSchema.parse({ facts: [{ key: "x", pinned: "yes" }] })).toThrow();
  });
});
