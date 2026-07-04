// Prompt `teach.probe` — the follow-up confused turn. Given the growing transcript + the
// student's last explanation, the AI (Feynman persona) asks the NEXT confused question,
// probing EXACTLY where the profile says the student is shaky (input.weakestTopic).
// Output validates against teachback.turn (role:"ai", kind:"probe"). React-free.

import type { KitPrompt } from "../../types";
import type { TeachbackTurnContent } from "../contentTypes";
import { appendProfileContext, FEYNMAN_PERSONA, snippet } from "./persona";

export type ProbeInput = {
  topic?: string;
  /** The student's most recent explanation text (what the AI is confused ABOUT). */
  lastExplanation?: string;
  /** The transcript so far, flattened to text (for context — real providers use it). */
  transcript?: string;
  /** The weak-bucket topic the AI should probe (MEM-3 steering). Falls back to topic. */
  weakestTopic?: string;
  /** The probe round index (1..MAX) — the reducer supplies it. */
  round?: number;
  /** MEM-3: the compact learner profile — steers the confusion. */
  profileContext?: string;
};

export const probePrompt: KitPrompt<ProbeInput> = {
  id: "teach.probe",
  outputType: "teachback.turn",
  build: (input) => {
    const topic = (input.topic ?? "").trim() || "this topic";
    const weakest = (input.weakestTopic ?? "").trim() || topic;
    const lines = [
      FEYNMAN_PERSONA,
      "",
      `You are being taught: ${topic}. The human just explained something.`,
      `You are STILL confused, especially about: ${weakest}.`,
      "Ask ONE more specific follow-up question that pins down what you didn't get.",
      "",
      "The explanation you're reacting to:",
      input.lastExplanation ?? "",
      "",
      'Return a JSON object: { "role": "ai", "kind": "probe", "text": <your follow-up>,',
      `  "topic": ${JSON.stringify(topic)}, "round": ${Number(input.round ?? 1)} }.`
    ];
    return appendProfileContext(lines, input.profileContext).join("\n");
  },
  // Delta 4 — a PURE, STABLE projection: the probe deterministically names
  // input.weakestTopic (a fixed-shape probe), so the panel drive-test asserts intent.
  mockContent: (input): TeachbackTurnContent => {
    const topic = (input.topic ?? "").trim() || "这个主题";
    const weakest = (input.weakestTopic ?? "").trim() || topic;
    return {
      role: "ai",
      kind: "probe",
      text: `等等,关于「${snippet(weakest, 40)}」我还是没懂——你能再具体讲讲这一步为什么是这样吗?`,
      topic,
      round: Number(input.round ?? 1)
    };
  }
};
