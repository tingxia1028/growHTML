// Study Report prompt pack (REPORT-1 commit 2) — the generate prompt's deterministic mock.
// Asserts: outputType is study-report.report; mockContent is schema-valid; stats/period/
// weakAreas echo the assembled input VERBATIM (the AI never moves a number); prose is
// non-empty; empty input still yields a schema-valid mock; purity.

import { describe, expect, it } from "vitest";
import { generateReportPrompt } from "./prompts/generateReport.prompt";
import { studyReportSpec, STUDY_REPORT_CONTENT_TYPE, type StudyReportContent } from "./contentTypes";

const REPORT: StudyReportContent = {
  period: { label: "本周", from: "2026-06-15", to: "2026-06-21" },
  highlights: [],
  weakAreas: [{ bucket: "弱项:mistake", detail: "复习错误率 60%" }],
  stats: {
    reviewsDone: 3,
    reviewPass: 2,
    reviewFail: 1,
    notesCreated: 2,
    mistakesLogged: 1,
    activeDays: 2,
    streakDays: 4
  },
  nextSteps: [],
  summary: ""
};

describe("study-report generate prompt", () => {
  it("targets the study-report.report contentType", () => {
    expect(generateReportPrompt.id).toBe("study-report.generate");
    expect(generateReportPrompt.outputType).toBe(STUDY_REPORT_CONTENT_TYPE);
  });

  it("build() hands the AI the assembled stats/period verbatim and asks for prose only", () => {
    const built = generateReportPrompt.build({ report: REPORT });
    expect(built).toContain("DO NOT change any");
    expect(built).toContain("本周");
    expect(built).toContain('"reviewsDone": 3');
    expect(built).toContain("弱项:mistake");
  });

  it("mockContent is schema-valid and ECHOES stats/period/weakAreas verbatim", () => {
    const sample = generateReportPrompt.mockContent!({ report: REPORT });
    const parsed = studyReportSpec.schema.parse(sample);
    // The mock owns prose only — stats/period/weakAreas pass through unchanged.
    expect(parsed.stats).toEqual(REPORT.stats);
    expect(parsed.period).toEqual(REPORT.period);
    expect(parsed.weakAreas).toEqual(REPORT.weakAreas);
    // Prose is synthesized + non-empty (a fresh/offline run reads well).
    expect(parsed.summary).toContain("本周");
    expect(parsed.highlights.length).toBeGreaterThan(0);
    expect(parsed.nextSteps.length).toBeGreaterThan(0);
  });

  it("empty input still yields a schema-valid mock (no crash on a fresh vault)", () => {
    const sample = generateReportPrompt.mockContent!({});
    expect(() => studyReportSpec.schema.parse(sample)).not.toThrow();
    const parsed = studyReportSpec.schema.parse(sample);
    expect(parsed.stats.reviewsDone).toBe(0);
  });

  it("is pure — identical input yields identical output", () => {
    expect(generateReportPrompt.mockContent!({ report: REPORT })).toEqual(
      generateReportPrompt.mockContent!({ report: REPORT })
    );
  });
});
