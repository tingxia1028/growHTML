// Operation `review.explain` — a markdown walk-through of WHY the answer was wrong,
// generated from the reviewed item + the wrong answer. Output type is the EXISTING
// `markdown` (schema: string) — rendered through getNoteType("markdown").render like
// every other markdown body; no new renderer. REV-2 threads profileContext into this
// exact prompt (the first MEM-3 consumer): a compact 学生画像 section is appended
// ONLY when the input carries one — absent, the built prompt is byte-identical to
// its REV-1 form. The managed-provider privacy gate (learner-memory §5: profile
// facts never reach `kind:"managed"` without consent) lives in the server generate
// path (src/server/services/ai.ts), NOT here — build() stays a pure formatter.
// React-free.
//
// REV-CORE: lives in core — the id `review.explain` MUST stay stable: the REV-2
// server gate (PROFILE_GATED_PROMPT_IDS in services/ai.ts) keys on it.

import type { KitPrompt } from "../../../kits/types";

export type ExplainInput = {
  /** The reviewed item flattened to text (question or the note's toSearchText). */
  question?: string;
  expected?: string;
  /** The student's wrong answer (or a self-grade marker like "自评:没答对"). */
  userAnswer?: string;
  /**
   * REV-2: the compact learner profile (a few lines — top 弱项 + streak), built by
   * the client's buildProfileContext. Optional; empty/whitespace is treated as absent.
   */
  profileContext?: string;
};

const snippet = (text: string | undefined, n = 80) => {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  return clean.length > n ? `${clean.slice(0, n)}…` : clean;
};

export const explainPrompt: KitPrompt<ExplainInput> = {
  id: "review.explain",
  outputType: "markdown",
  build: (input) => {
    const lines = [
      "A student just got a review item WRONG. Explain it so they master it:",
      "state the correct idea, why their answer misses it, and one memorable takeaway.",
      "Answer in the student's language, in concise markdown.",
      "Return the markdown as ONE JSON-encoded string — the entire reply is a single",
      'JSON string value (e.g. "## Why…"), not an object.',
      "",
      `Item: ${input.question ?? ""}`,
      input.expected ? `Correct answer: ${input.expected}` : "",
      `Student's answer: ${input.userAnswer ?? ""}`
    ];
    // REV-2: the clearly-delimited 学生画像 section — appended, never interleaved, so
    // the no-profile prompt stays byte-identical to REV-1 (regression-pinned).
    const profile = typeof input.profileContext === "string" ? input.profileContext.trim() : "";
    if (profile) lines.push("", "学生画像(供个性化,不要复述):", profile);
    return lines.join("\n");
  },
  // Deterministic markdown sample (a plain string — valid against the markdown spec).
  mockContent: (input): string => {
    const lines = ["**为什么错了**", "", `题目:${snippet(input.question) || "(本条复习项)"}`];
    if (input.expected) lines.push(`正确答案:**${snippet(input.expected, 60)}**`);
    if (input.userAnswer) lines.push(`你的回答:${snippet(input.userAnswer, 60)}`);
    lines.push("", "- 核心点:对照原文,先找出题目考查的规则,再作答。", "- 记忆抓手:把正确答案用自己的话复述一遍。");
    return lines.join("\n");
  }
};
