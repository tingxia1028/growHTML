// Prompt `teach.pose` — the OPENING confused-student turn. The AI (Feynman persona) asks
// the human to teach it `topic`, voicing a first, specific confusion. Output validates
// against teachback.turn (role:"ai", kind:"pose"). React-free.

import type { KitPrompt } from "../../types";
import type { TeachbackTurnContent } from "../contentTypes";
import { appendProfileContext, FEYNMAN_PERSONA, snippet } from "./persona";

export type PoseInput = {
  topic?: string;
  /** MEM-3: the compact learner profile (top 弱项 + streak) — steers the confusion. */
  profileContext?: string;
};

export const posePrompt: KitPrompt<PoseInput> = {
  id: "teach.pose",
  outputType: "teachback.turn",
  build: (input) => {
    const topic = (input.topic ?? "").trim() || "this topic";
    const lines = [
      FEYNMAN_PERSONA,
      "",
      `Open a teach-back on: ${topic}.`,
      "Ask the human to teach you this from scratch, and name ONE specific thing you're",
      "confused about to get them started.",
      'Return a JSON object: { "role": "ai", "kind": "pose", "text": <your question>,',
      `  "topic": ${JSON.stringify(topic)}, "round": 0 }.`
    ];
    return appendProfileContext(lines, input.profileContext).join("\n");
  },
  // Delta 4 — a PURE, STABLE projection of the input: the pose deterministically names
  // input.topic so the panel drive-test asserts intentional output.
  mockContent: (input): TeachbackTurnContent => {
    const topic = (input.topic ?? "").trim() || "这个主题";
    return {
      role: "ai",
      kind: "pose",
      text: `我一直没搞懂「${snippet(topic, 40)}」,你能从头教教我吗?第一步先讲讲它到底是什么?`,
      topic,
      round: 0
    };
  }
};
