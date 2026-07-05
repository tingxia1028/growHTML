// Study Report assembler — a PURE, client-side, deterministic reduction of the shipped
// learner-memory reads into the report's `stats` + `period` + `weakAreas` + seed prose.
// NO IO, NO LLM, NO Date.now (the clock is injected) — the digest.ts purity discipline,
// so the same (rows, facts, period, now) always yields byte-identical output. It reuses
// core reads only: `summarizeMemoryDigests` (digest.ts) + `deriveProfileFacts` /
// `applyProfileOverrides` shapes (profile.ts) — it invents no new entity/route.
//
// The generate COMMAND runs this to compute the authoritative stats, then OVERWRITES the
// AI's stats/period with them before Save (delta 3) — so a schema-valid-but-wrong AI stat
// can never leak. The AI owns only prose (summary/highlights/nextSteps).

import {
  summarizeMemoryDigests,
  type MemoryDigestRow,
  type MemoryDigestSummary
} from "../../core/memory/digest";
import { MISTAKE_CONTENT_TYPE } from "../../core/notes/contentTypes";
import type { StudyReportContent } from "./contentTypes";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The `note.create` verb key (memory.ts:20) — notesCreated reads this overall count. */
const NOTE_CREATE_VERB = "note.create";

export type StudyReportPeriodPreset = "week" | "month";

/** A profile fact the assembler reads — the client `ProfileFactView` (with `hidden`) and
    the core `ProfileFact` both satisfy this structural minimum. `hidden` absent = shown. */
export type ProfileFactLike = {
  key: string;
  kind: string;
  title: string;
  value: string;
  hidden?: boolean;
};

export type AssembleReportInput = {
  /** ALL live day-digest rows (entityClient.memoryDigests()). The assembler period-filters. */
  digestRows: readonly MemoryDigestRow[];
  /** The 长期-tier profile facts (entityClient.memoryProfile().facts) — hidden ones excluded. */
  profileFacts: readonly ProfileFactLike[];
  /** 本周 / 本月. */
  period: StudyReportPeriodPreset;
  /** Injected wall clock (epoch ms) — determinism demands NO Date.now in here. */
  now: number;
};

/** UTC "YYYY-MM-DD" for an epoch ms (matches the digest engine's day keys). */
function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

// The inclusive [from, to] UTC-day window for a preset, plus its label. 本周 = the ISO
// week (Monday→Sunday) containing `now`; 本月 = the calendar month. Both in UTC so the
// bounds compare directly against the digest rows' UTC `date` strings.
export function periodBounds(period: StudyReportPeriodPreset, now: number): {
  label: string;
  from: string;
  to: string;
} {
  const nowDate = new Date(now);
  if (period === "month") {
    const from = Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), 1);
    // Day 0 of next month = last day of this month.
    const to = Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth() + 1, 0);
    return { label: "本月", from: utcDay(from), to: utcDay(to) };
  }
  // 本周: Monday-start ISO week. getUTCDay() is 0(Sun)..6(Sat); shift so Monday=0.
  const dow = (nowDate.getUTCDay() + 6) % 7;
  const monday = Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), nowDate.getUTCDate()) - dow * DAY_MS;
  const sunday = monday + 6 * DAY_MS;
  return { label: "本周", from: utcDay(monday), to: utcDay(sunday) };
}

/** Rows whose UTC `date` falls inside the inclusive window. */
function rowsInPeriod(
  rows: readonly MemoryDigestRow[],
  from: string,
  to: string
): MemoryDigestRow[] {
  return rows.filter((row) => row.date >= from && row.date <= to);
}

/** The `mistake` contentType bucket's note.create count from a summary's dimensions. */
function mistakesLoggedFrom(summary: MemoryDigestSummary): number {
  const cell = summary.dimensions.find(
    (d) => d.dimension === "contentType" && d.bucket === MISTAKE_CONTENT_TYPE
  );
  return cell?.counts[NOTE_CREATE_VERB] ?? 0;
}

// The i18n-free weak-area detail line for a profile fact (its already-human `value`,
// prefixed by title when the value doesn't already carry it). Kept simple/stable.
function weakDetail(fact: ProfileFactLike): string {
  return fact.value || fact.title;
}

/**
 * Deterministically assemble the report's `stats` + `period` + `weakAreas` + seed prose
 * from the shipped reads. The command re-merges these authoritative stats over the AI
 * output before Save (delta 3).
 *
 * STATS SOURCES (all verified against digest.ts):
 *   reviewsDone   = overall.review.attempts (= pass + fail; skips are not attempts)
 *   reviewPass    = overall.review.pass
 *   reviewFail    = overall.review.fail
 *   notesCreated  = overall.counts["note.create"] (includes bookmarks + the report itself — acceptable)
 *   mistakesLogged= the contentType==="mistake" bucket's note.create count
 *   activeDays    = overall.activeDays.length  — IN THE PERIOD (period-filtered; correct for 本周)
 *   streakDays    = the GLOBAL current streak — from an UNFILTERED summary (delta 2): the
 *                   learner's real "连续学习 N 天" run, which a period filter would truncate.
 */
export function assembleReportInput(input: AssembleReportInput): StudyReportContent {
  const { digestRows, profileFacts, period, now } = input;
  const bounds = periodBounds(period, now);

  // Period stats: summarize ONLY the rows inside the window.
  const inPeriod = summarizeMemoryDigests(rowsInPeriod(digestRows, bounds.from, bounds.to));
  // GLOBAL streak (delta 2): summarize the UNFILTERED rows — the learner's current run.
  const global = summarizeMemoryDigests(digestRows);

  const { overall } = inPeriod;

  const stats: StudyReportContent["stats"] = {
    reviewsDone: overall.review.attempts,
    reviewPass: overall.review.pass,
    reviewFail: overall.review.fail,
    notesCreated: overall.counts[NOTE_CREATE_VERB] ?? 0,
    mistakesLogged: mistakesLoggedFrom(inPeriod),
    activeDays: overall.activeDays.length, // IN-PERIOD
    streakDays: global.overall.streakDays // GLOBAL (unfiltered)
  };

  // 弱项: the visible (non-hidden) weak profile facts (REV-2 hide honored end-to-end).
  const weakAreas = profileFacts
    .filter((fact) => fact.kind === "weak" && fact.hidden !== true)
    .map((fact) => ({ bucket: fact.title, detail: weakDetail(fact) }));

  // Seed prose from the visible facts (the AI replaces these; the mock echoes them, so an
  // offline run is stable + non-empty). Highlights = the activity/top facts; nextSteps =
  // a weak-area review nudge.
  const visibleFacts = profileFacts.filter((fact) => fact.hidden !== true);
  const highlights = visibleFacts
    .filter((fact) => fact.kind === "activity" || fact.kind === "top")
    .map((fact) => `${fact.title}:${fact.value}`);
  const nextSteps = weakAreas.map((w) => `复习 ${w.bucket}`);

  return {
    period: bounds,
    highlights,
    weakAreas,
    stats,
    nextSteps,
    summary: ""
  };
}
