// Prompt: turn a DETERMINISTICALLY-ASSEMBLED study report (stats + period + weakAreas,
// pre-computed by ./assemble) into a finished 学习报告 by writing ONLY the prose
// (summary / highlights / nextSteps). React-free. Source-less (vault-level, no anchor).
//
// The generate command re-merges the deterministic stats/period OVER the AI output before
// Save (delta 3), so the model can never move a number — it only phrases. `mockContent`
// echoes the assembled report verbatim (stats included) → the offline/e2e run is stable.
// Precedent: generateReviewPack.prompt.ts.

import type { KitPrompt } from "../../types";
import { STUDY_REPORT_CONTENT_TYPE, studyReportSpec, type StudyReportContent } from "../contentTypes";

// The command passes the whole assembled report under `report` (a sibling key, never
// spread — so composeAutoContext / template render never flatten its nested objects).
export type GenerateReportInput = {
  report?: unknown;
};

// Defensively coerce the assembled report off the input (the command always supplies a
// full StudyReportContent; the spec's defaults fill any gap so a bare/foreign input still
// yields a schema-valid mock — the empty-session guard).
function coerceReport(input: GenerateReportInput): StudyReportContent {
  return studyReportSpec.schema.parse(input.report ?? {}) as StudyReportContent;
}

export const generateReportPrompt: KitPrompt<GenerateReportInput> = {
  id: "study-report.generate",
  outputType: STUDY_REPORT_CONTENT_TYPE,
  build: (input) => {
    const report = coerceReport(input);
    return [
      "You are a study coach writing a short, encouraging learning report for a student.",
      "The STATS, PERIOD, and WEAK AREAS below are already computed — DO NOT change any",
      "number, date, or bucket. Write ONLY the prose:",
      "- summary: a warm 2-4 sentence paragraph tying the period together.",
      "- highlights: 2-5 concrete wins drawn from the stats/weak areas.",
      "- nextSteps: 2-4 specific, actionable review suggestions for the coming period.",
      "Return a JSON object with EXACTLY these keys: period, stats, weakAreas, highlights,",
      "nextSteps, summary. Copy period/stats/weakAreas back VERBATIM.",
      "",
      "Assembled report (verbatim stats/period/weakAreas):",
      JSON.stringify(report, null, 2)
    ].join("\n");
  },
  // Deterministic sample the mock provider echoes: the assembled report VERBATIM, with a
  // stable synthesized prose so a fresh/offline run is non-empty. Stats/period echo the
  // input exactly (the delta-3 re-merge would overwrite them anyway, but echoing keeps
  // the mock honest).
  mockContent: (input): StudyReportContent => {
    const report = coerceReport(input);
    const highlights = report.highlights.length > 0 ? report.highlights : ["坚持学习,继续加油"];
    const nextSteps =
      report.nextSteps.length > 0 ? report.nextSteps : ["保持复习节奏,巩固已学内容"];
    return {
      ...report,
      highlights,
      nextSteps,
      summary: `${report.period.label}学习小结:完成 ${report.stats.reviewsDone} 次复习(通过 ${report.stats.reviewPass}),新增 ${report.stats.notesCreated} 条笔记,活跃 ${report.stats.activeDays} 天,连续学习 ${report.stats.streakDays} 天。`
    };
  }
};
