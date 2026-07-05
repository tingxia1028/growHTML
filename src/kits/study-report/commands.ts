// Study Report Kit commands — the generate + open launch commands. Register-only kit code
// (host Commands wired through KitInstallContext.commands).
//
// study-report.generate (生成学习报告): VAULT-LEVEL (isAvailable ()=>true). It reads the
// shipped learner-memory endpoints (digests + profile), assembles the report
// DETERMINISTICALLY (./assemble), runs the structured seam for the PROSE, then RE-MERGES
// the deterministic stats + period OVER the AI output (delta 3) so a schema-valid-but-wrong
// AI number can never leak — the AI owns only summary/highlights/nextSteps. The draft is
// SOURCE-LESS (anchorId + sourceId undefined) → the preview→edit→Save loop persists it via
// anchor.add-note with anchorIds:[] (vault-level). The report.list view is its home.
//
// study-report.open (学习报告): navigates the shell to the report.list pane (the teachback
// launch precedent — a command-launched pane, no rail entry).

import type { Command, CommandContext } from "../../client/commands/registry";
import { navigateShell } from "../../client/workspace/shellNav";
import { entityClient } from "../../client/data/entityClient";
import type { MemoryDigestRow } from "../../core/memory/digest";
import { assembleReportInput, type ProfileFactLike } from "./assemble";
import { STUDY_REPORT_CONTENT_TYPE, type StudyReportContent } from "./contentTypes";

export const STUDY_REPORT_GENERATE_PROMPT = "study-report.generate";
/** The registered view kind the report.list view self-registers (see ./ReportListView). */
export const REPORT_LIST_KIND = "report.list";

// Read the two shipped endpoints; degrade to empty on failure (a report over an empty
// vault is honest, never a crash — the assembler zeroes safely).
async function readMemory(): Promise<{ digestRows: MemoryDigestRow[]; profileFacts: ProfileFactLike[] }> {
  const [digests, profile] = await Promise.all([
    entityClient.memoryDigests().catch(() => ({ digests: [] as MemoryDigestRow[] })),
    entityClient.memoryProfile().catch(() => ({ facts: [] as ProfileFactLike[] }))
  ]);
  return {
    digestRows: (digests.digests ?? []) as MemoryDigestRow[],
    profileFacts: (profile.facts ?? []) as ProfileFactLike[]
  };
}

export const generateStudyReportCommand: Command = {
  id: "study-report.generate",
  title: { zh: "生成学习报告", en: "Generate Study Report" },
  group: "study-report",
  // Always runnable — a vault-level report needs no passage/source.
  isAvailable: () => true,
  run: async (ctx: CommandContext) => {
    const { digestRows, profileFacts } = await readMemory();
    // Deterministic assembly (本周). The clock is the ONLY impurity, injected here.
    const computed = assembleReportInput({ digestRows, profileFacts, period: "week", now: Date.now() });
    const input = { report: computed as unknown as Record<string, unknown> };

    // Structured seam: the AI writes prose against the report schema. Under the mock it
    // echoes computed verbatim (deterministic).
    const { content, concepts } = await ctx.client.generateStructured({
      promptId: STUDY_REPORT_GENERATE_PROMPT,
      contentType: STUDY_REPORT_CONTENT_TYPE,
      input
    });

    // DELTA 3 — re-merge the deterministic stats + period OVER the AI output. The AI owns
    // ONLY prose; a wrong AI stat can never reach Save. reviewsDone is pinned to attempts.
    const ai = (content ?? {}) as Partial<StudyReportContent>;
    const merged: StudyReportContent = {
      period: computed.period,
      stats: computed.stats,
      weakAreas: computed.weakAreas,
      highlights: Array.isArray(ai.highlights) ? ai.highlights.map(String) : computed.highlights,
      nextSteps: Array.isArray(ai.nextSteps) ? ai.nextSteps.map(String) : computed.nextSteps,
      summary: typeof ai.summary === "string" ? ai.summary : computed.summary
    };

    // SOURCE-LESS draft (vault-level): anchorId + sourceId undefined → Save parks then
    // anchor.add-note anchorIds:[] persists it unanchored (the review-pack precedent, but
    // with NO source). The report.list view surfaces it.
    ctx.actions.onGenerated?.({
      promptId: STUDY_REPORT_GENERATE_PROMPT,
      contentType: STUDY_REPORT_CONTENT_TYPE,
      input,
      content: merged,
      anchorId: undefined,
      sourceId: undefined,
      ...(concepts && concepts.length > 0 ? { concepts } : {})
    });
  }
};

export const openStudyReportsCommand: Command = {
  id: "study-report.open",
  title: { zh: "学习报告", en: "Study Reports" },
  group: "study-report",
  isAvailable: () => true,
  run: () => {
    navigateShell({ type: "pane", kind: REPORT_LIST_KIND });
  }
};

export const studyReportCommands: Command[] = [generateStudyReportCommand, openStudyReportsCommand];
