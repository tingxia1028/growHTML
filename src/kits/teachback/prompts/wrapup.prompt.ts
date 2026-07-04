// Prompt `teach.wrapup` — the session close. Given the full transcript, the AI steps OUT
// of the confused-student role for ONE structured assessment: what the human explained
// well vs the gaps they dodged, plus a short prose summary. Output validates against
// teachback.summary. React-free.

import type { KitPrompt } from "../../types";
import type { TeachbackSummaryContent, TeachbackTurnContent } from "../contentTypes";
import { snippet } from "./persona";

export type WrapupInput = {
  topic?: string;
  /** The transcript so far, flattened to text (real providers reason over it). */
  transcript?: string;
  /** The structured turns (so the summary can embed them verbatim). */
  turns?: TeachbackTurnContent[];
  /** The student's explanation snippets (what they said) — used by the mock projection. */
  studentPoints?: string[];
  /** The topics the AI probed but the student didn't resolve (MEM-3 weak buckets). */
  openGaps?: string[];
};

export const wrapupPrompt: KitPrompt<WrapupInput> = {
  id: "teach.wrapup",
  outputType: "teachback.summary",
  build: (input) => {
    const topic = (input.topic ?? "").trim() || "this topic";
    return [
      "The teach-back session is over. Step OUT of the confused-student role and assess",
      `how well the human taught you: ${topic}.`,
      "Be honest but encouraging. List what they explained WELL and the GAPS they dodged.",
      'Return a JSON object: { "topic", "explainedWell": string[], "gaps": string[],',
      '  "summary": <two sentences>, "transcript": [] }.',
      "",
      "Transcript:",
      input.transcript ?? ""
    ].join("\n");
  },
  // Delta 4 — a PURE, STABLE projection of the (growing-transcript) input: explainedWell
  // is the student's own points, gaps is the AI's open probes, summary names the topic.
  mockContent: (input): TeachbackSummaryContent => {
    const topic = (input.topic ?? "").trim() || "这个主题";
    const explainedWell = (input.studentPoints ?? [])
      .map((p) => snippet(p, 60))
      .filter((p) => p.length > 0);
    const gaps = (input.openGaps ?? []).map((g) => snippet(g, 60)).filter((g) => g.length > 0);
    const wellCount = explainedWell.length;
    const gapCount = gaps.length;
    return {
      topic,
      explainedWell,
      gaps,
      summary: `你围绕「${snippet(topic, 40)}」讲清了 ${wellCount} 个要点${
        gapCount ? `,还有 ${gapCount} 处我没听懂——那里可能是你的薄弱点。` : ",讲得挺完整。"
      }`,
      transcript: input.turns ?? []
    };
  }
};
