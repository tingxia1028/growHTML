// Study Report assembler (REPORT-1 commit 1) — the deterministic reduction of MEM-2
// digest rows + review tallies + a `mistake` contentType cell + profile facts into the
// report's stats/period/weakAreas. Asserts:
//   • exact stats (attempts/pass/fail/notesCreated/mistakesLogged)
//   • activeDays = IN-PERIOD, streakDays = GLOBAL (delta 2) — a global streak reaching
//     BEFORE the window is NOT truncated by the period filter
//   • hidden weak facts are excluded from weakAreas (REV-2 hide honored)
//   • the assembled object passes studyReportSpec.schema.parse
//   • empty-vault → zeroed, no throw
//   • purity: identical input → identical output

import { describe, expect, it } from "vitest";
import type { MemoryDigestRow } from "../../core/memory/digest";
import { assembleReportInput, periodBounds, type ProfileFactLike } from "./assemble";
import { studyReportSpec } from "./contentTypes";

// A day×dimension×bucket row (the core shape). `at` seeds firstAt/lastAt.
function row(over: Partial<MemoryDigestRow> & { date: string }): MemoryDigestRow {
  const at = `${over.date}T09:00:00.000Z`;
  return {
    period: "day",
    dimension: "overall",
    bucket: "all",
    events: 0,
    counts: {},
    review: { pass: 0, fail: 0, skip: 0 },
    firstAt: at,
    lastAt: at,
    ...over
  };
}

// A Wednesday inside the ISO week 2026-06-15(Mon)..2026-06-21(Sun).
const NOW = Date.parse("2026-06-17T12:00:00.000Z");

describe("periodBounds", () => {
  it("本周 = the Monday→Sunday ISO week containing now (UTC)", () => {
    const b = periodBounds("week", NOW);
    expect(b).toEqual({ label: "本周", from: "2026-06-15", to: "2026-06-21" });
  });
  it("本月 = the calendar month containing now (UTC)", () => {
    const b = periodBounds("month", NOW);
    expect(b).toEqual({ label: "本月", from: "2026-06-01", to: "2026-06-30" });
  });
});

describe("assembleReportInput — stats", () => {
  // In-period rows (this week): 3 reviews (2 pass / 1 fail) on Mon+Tue, 2 note.create,
  // + a `mistake` contentType cell with 1 note.create; 2 distinct active days.
  const inPeriodRows: MemoryDigestRow[] = [
    row({
      date: "2026-06-15",
      dimension: "overall",
      events: 3,
      counts: { "note.create": 2, "note.review": 1 },
      review: { pass: 1, fail: 0, skip: 0 }
    }),
    row({
      date: "2026-06-16",
      dimension: "overall",
      events: 2,
      counts: { "note.review": 2 },
      review: { pass: 1, fail: 1, skip: 0 }
    }),
    // the `mistake` contentType bucket, in-period — mistakesLogged reads its note.create.
    row({
      date: "2026-06-15",
      dimension: "contentType",
      bucket: "mistake",
      events: 1,
      counts: { "note.create": 1 }
    })
  ];

  const facts: ProfileFactLike[] = [
    { key: "weak:contentType:mistake", kind: "weak", title: "弱项:mistake", value: "复习错误率 60%" },
    { key: "activity:streak", kind: "activity", title: "连续学习", value: "5 天" },
    { key: "top:verbs", kind: "top", title: "最常做", value: "note.review ×3" }
  ];

  it("yields exact review/notes/mistake stats", () => {
    const report = assembleReportInput({ digestRows: inPeriodRows, profileFacts: facts, period: "week", now: NOW });
    expect(report.stats.reviewsDone).toBe(3); // attempts = pass+fail = 2+1
    expect(report.stats.reviewPass).toBe(2);
    expect(report.stats.reviewFail).toBe(1);
    expect(report.stats.notesCreated).toBe(2); // overall note.create only (2 on Mon)
    expect(report.stats.mistakesLogged).toBe(1); // the mistake contentType cell's note.create
    expect(report.stats.activeDays).toBe(2); // Mon + Tue
    expect(report.period).toEqual({ label: "本周", from: "2026-06-15", to: "2026-06-21" });
  });

  it("activeDays is IN-PERIOD but streakDays is GLOBAL (delta 2 — a longer run isn't truncated)", () => {
    // A consecutive run reaching BEFORE the week start: Jun 13, 14 (prior week) + 15, 16.
    // In-period activeDays = 2 (only 15,16 fall in the window), but the GLOBAL streak
    // ending at the last active day (16) is 4 consecutive days.
    const rows: MemoryDigestRow[] = [
      row({ date: "2026-06-13", dimension: "overall", events: 1, counts: { "note.review": 1 }, review: { pass: 1, fail: 0, skip: 0 } }),
      row({ date: "2026-06-14", dimension: "overall", events: 1, counts: { "note.review": 1 }, review: { pass: 1, fail: 0, skip: 0 } }),
      ...inPeriodRows
    ];
    const report = assembleReportInput({ digestRows: rows, profileFacts: facts, period: "week", now: NOW });
    expect(report.stats.activeDays).toBe(2); // only Jun 15,16 are in the week window
    expect(report.stats.streakDays).toBe(4); // GLOBAL run Jun 13→16 (unfiltered)
  });

  it("excludes HIDDEN weak facts from weakAreas (REV-2 hide honored)", () => {
    const withHidden: ProfileFactLike[] = [
      { key: "weak:a", kind: "weak", title: "弱项:A", value: "60%" },
      { key: "weak:b", kind: "weak", title: "弱项:B", value: "70%", hidden: true }
    ];
    const report = assembleReportInput({ digestRows: inPeriodRows, profileFacts: withHidden, period: "week", now: NOW });
    expect(report.weakAreas.map((w) => w.bucket)).toEqual(["弱项:A"]);
    expect(report.weakAreas.some((w) => w.bucket === "弱项:B")).toBe(false);
  });

  it("the assembled object passes the spec schema (no throw)", () => {
    const report = assembleReportInput({ digestRows: inPeriodRows, profileFacts: facts, period: "week", now: NOW });
    expect(() => studyReportSpec.schema.parse(report)).not.toThrow();
  });

  it("is pure — identical input yields identical output", () => {
    const a = assembleReportInput({ digestRows: inPeriodRows, profileFacts: facts, period: "week", now: NOW });
    const b = assembleReportInput({ digestRows: inPeriodRows, profileFacts: facts, period: "week", now: NOW });
    expect(a).toEqual(b);
  });
});

describe("assembleReportInput — empty vault", () => {
  it("zeroes every stat and throws nothing", () => {
    const report = assembleReportInput({ digestRows: [], profileFacts: [], period: "week", now: NOW });
    expect(report.stats).toEqual({
      reviewsDone: 0,
      reviewPass: 0,
      reviewFail: 0,
      notesCreated: 0,
      mistakesLogged: 0,
      activeDays: 0,
      streakDays: 0
    });
    expect(report.weakAreas).toEqual([]);
    expect(report.highlights).toEqual([]);
    expect(report.nextSteps).toEqual([]);
    expect(() => studyReportSpec.schema.parse(report)).not.toThrow();
  });
});
