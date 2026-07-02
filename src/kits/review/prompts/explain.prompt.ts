// Operation `review.explain` — a markdown walk-through of WHY the answer was wrong,
// generated from the reviewed item + the wrong answer. Output type is the EXISTING
// `markdown` (schema: string) — rendered through getNoteType("markdown").render like
// every other markdown body; no new renderer. REV-2 threads profileContext into this
// exact prompt (the first MEM-3 consumer). React-free.

import type { KitPrompt } from "../../types";

export type ExplainInput = {
  /** The reviewed item flattened to text (question or the note's toSearchText). */
  question?: string;
  expected?: string;
  /** The student's wrong answer (or a self-grade marker like "自评:没答对"). */
  userAnswer?: string;
};

const snippet = (text: string | undefined, n = 80) => {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  return clean.length > n ? `${clean.slice(0, n)}…` : clean;
};

export const explainPrompt: KitPrompt<ExplainInput> = {
  id: "review.explain",
  outputType: "markdown",
  build: (input) =>
    [
      "A student just got a review item WRONG. Explain it so they master it:",
      "state the correct idea, why their answer misses it, and one memorable takeaway.",
      "Answer in the student's language, in concise markdown.",
      "Return the markdown as ONE JSON-encoded string — the entire reply is a single",
      'JSON string value (e.g. "## Why…"), not an object.',
      "",
      `Item: ${input.question ?? ""}`,
      input.expected ? `Correct answer: ${input.expected}` : "",
      `Student's answer: ${input.userAnswer ?? ""}`
    ].join("\n"),
  // Deterministic markdown sample (a plain string — valid against the markdown spec).
  mockContent: (input): string => {
    const lines = ["**为什么错了**", "", `题目:${snippet(input.question) || "(本条复习项)"}`];
    if (input.expected) lines.push(`正确答案:**${snippet(input.expected, 60)}**`);
    if (input.userAnswer) lines.push(`你的回答:${snippet(input.userAnswer, 60)}`);
    lines.push("", "- 核心点:对照原文,先找出题目考查的规则,再作答。", "- 记忆抓手:把正确答案用自己的话复述一遍。");
    return lines.join("\n");
  }
};
