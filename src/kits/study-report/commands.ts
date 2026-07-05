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

/** The `generateStructured` client seam both the command and the view drive. */
type GenerateStructuredFn = CommandContext["client"]["generateStructured"];

export type GeneratedStudyReport = {
  /** The prompt input (the assembled report under `report`) — kept for the draft/regenerate. */
  input: Record<string, unknown>;
  /** The FINAL content: deterministic stats/period/weakAreas re-merged over the AI prose. */
  content: StudyReportContent;
  /** CG-2 suggested concept names (absent = none). */
  concepts?: string[];
};

/**
 * The shared body: read the shipped memory endpoints → assemble DETERMINISTICALLY → run the
 * structured seam for the prose → RE-MERGE the deterministic stats + period OVER the AI
 * output (delta 3). The AI owns ONLY summary/highlights/nextSteps; a schema-valid-but-wrong
 * AI number can never survive this. Used by BOTH the command (onGenerated preview) and the
 * report.list view (its own source-less save loop — see the delta-1 deviation note).
 */
export async function generateStudyReport(generateStructured: GenerateStructuredFn): Promise<GeneratedStudyReport> {
  const { digestRows, profileFacts } = await readMemory();
  // Deterministic assembly (本周). The clock is the ONLY impurity, injected here.
  const computed = assembleReportInput({ digestRows, profileFacts, period: "week", now: Date.now() });
  const input = { report: computed as unknown as Record<string, unknown> };

  // Structured seam: the AI writes prose against the report schema. Under the mock it
  // echoes computed verbatim (deterministic).
  const { content, concepts } = await generateStructured({
    promptId: STUDY_REPORT_GENERATE_PROMPT,
    contentType: STUDY_REPORT_CONTENT_TYPE,
    input
  });

  // DELTA 3 — re-merge the deterministic stats + period OVER the AI output. reviewsDone is
  // pinned to attempts (pass+fail).
  const ai = (content ?? {}) as Partial<StudyReportContent>;
  const merged: StudyReportContent = {
    period: computed.period,
    stats: computed.stats,
    weakAreas: computed.weakAreas,
    highlights: Array.isArray(ai.highlights) ? ai.highlights.map(String) : computed.highlights,
    nextSteps: Array.isArray(ai.nextSteps) ? ai.nextSteps.map(String) : computed.nextSteps,
    summary: typeof ai.summary === "string" ? ai.summary : computed.summary
  };

  return { input, content: merged, ...(concepts && concepts.length > 0 ? { concepts } : {}) };
}

export const generateStudyReportCommand: Command = {
  id: "study-report.generate",
  title: { zh: "生成学习报告", en: "Generate Study Report" },
  group: "study-report",
  // Always runnable — a vault-level report needs no passage/source.
  isAvailable: () => true,
  run: async (ctx: CommandContext) => {
    const { input, content, concepts } = await generateStudyReport(ctx.client.generateStructured);
    // SOURCE-LESS draft (vault-level): anchorId + sourceId undefined. This drives the
    // SHELL's preview loop for callers that DO have a source/focus in context (the shipped
    // FloatingNoteEditor Save rides anchor.add-note). The report.list view drives its OWN
    // source-less save instead (that command's Save gate needs a source/focus — the delta-1
    // deviation), so a vault-level report is reachable even with no source open.
    ctx.actions.onGenerated?.({
      promptId: STUDY_REPORT_GENERATE_PROMPT,
      contentType: STUDY_REPORT_CONTENT_TYPE,
      input,
      content,
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
