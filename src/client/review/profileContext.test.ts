// REV-2 profileContext builder — the compact 学生画像 text for review.explain.
// Pure-function law: exact compact shape (top 弱项 + streak, "title — value" lines),
// hidden facts excluded end-to-end, the weak cap enforced, and the all-important
// empty → undefined (the caller omits the key, keeping the prompt byte-identical).

import { describe, expect, it } from "vitest";
import type { ProfileFactView } from "../data/entityClient";
import { buildProfileContext, PROFILE_CONTEXT_WEAK_LIMIT } from "./profileContext";

const fact = (over: Partial<ProfileFactView> & { key: string; kind: ProfileFactView["kind"] }): ProfileFactView => ({
  title: over.key,
  value: "",
  evidence: [],
  pinned: false,
  hidden: false,
  ...over
});

const weakFact = (bucket: string, value: string, over: Partial<ProfileFactView> = {}): ProfileFactView =>
  fact({ key: `weak:subject:${bucket}`, kind: "weak", title: `弱项:${bucket}`, value, ...over });

const streakFact = (value: string, over: Partial<ProfileFactView> = {}): ProfileFactView =>
  fact({ key: "activity:streak", kind: "activity", title: "连续学习", value, ...over });

describe("buildProfileContext", () => {
  it("builds the compact shape: weak lines first (incoming order), then the streak", () => {
    const facts = [
      weakFact("浮力", "复习错误率 67%(4/6 次未过,学科)"),
      weakFact("判断题", "复习错误率 60%(3/5 次未过,类型)"),
      streakFact("3 天(至 2026-07-01)"),
      fact({ key: "top:verbs", kind: "top", title: "最常做", value: "note.review ×9" }) // not carried
    ];
    expect(buildProfileContext(facts)).toBe(
      [
        "弱项:浮力 — 复习错误率 67%(4/6 次未过,学科)",
        "弱项:判断题 — 复习错误率 60%(3/5 次未过,类型)",
        "连续学习 — 3 天(至 2026-07-01)"
      ].join("\n")
    );
  });

  it("caps weak facts at the limit (the context stays a few lines, never a dossier)", () => {
    const facts = [
      ...Array.from({ length: PROFILE_CONTEXT_WEAK_LIMIT + 2 }, (_, i) => weakFact(`b${i}`, `v${i}`)),
      streakFact("2 天(至 2026-07-01)")
    ];
    const context = buildProfileContext(facts)!;
    expect(context.split("\n")).toHaveLength(PROFILE_CONTEXT_WEAK_LIMIT + 1); // + streak
    expect(context).toContain(`弱项:b${PROFILE_CONTEXT_WEAK_LIMIT - 1}`);
    expect(context).not.toContain(`弱项:b${PROFILE_CONTEXT_WEAK_LIMIT}`);
  });

  it("HIDDEN facts are excluded — a hidden weak fact frees a slot, a hidden streak drops", () => {
    const facts = [
      weakFact("浮力", "v1", { hidden: true }),
      weakFact("电路", "v2"),
      streakFact("5 天(至 2026-07-01)", { hidden: true })
    ];
    expect(buildProfileContext(facts)).toBe("弱项:电路 — v2");
  });

  it("streak-only and weak-only inputs both build", () => {
    expect(buildProfileContext([streakFact("4 天(至 2026-07-01)")])).toBe("连续学习 — 4 天(至 2026-07-01)");
    expect(buildProfileContext([weakFact("浮力", "v")])).toBe("弱项:浮力 — v");
  });

  it("no facts / no usable facts → undefined (the caller omits the key entirely)", () => {
    expect(buildProfileContext([])).toBeUndefined();
    expect(buildProfileContext([fact({ key: "top:verbs", kind: "top", title: "最常做", value: "x" })])).toBeUndefined();
    expect(buildProfileContext([weakFact("浮力", "v", { hidden: true })])).toBeUndefined();
    // Other activity facts (last-active) are not the streak — not carried either.
    expect(
      buildProfileContext([fact({ key: "activity:last-active", kind: "activity", title: "最近活跃", value: "x" })])
    ).toBeUndefined();
  });
});
