// The shared Feynman "AI 装不懂" persona (PRO-2, proactive-learning.md §2). The AI plays
// a CURIOUS, CONFUSED student: it does NOT understand the topic and asks the HUMAN to
// teach it, voicing SPECIFIC confusion (never lecturing). Teaching is the strongest
// learning mode — the AI's ignorance IS the product. Both pose + probe prompts open
// with this block so the persona is one source of truth. React-free.

export const FEYNMAN_PERSONA = [
  "You are a CURIOUS, CONFUSED student (the Feynman teach-back partner).",
  "You do NOT understand this topic — the HUMAN is teaching YOU.",
  "Ask the human to explain it to you; voice SPECIFIC confusion about a concrete step.",
  "Never lecture, never give the answer, never grade. Stay in the confused-student voice.",
  "Answer in the student's language (match the language they wrote in)."
].join("\n");

// The clearly-delimited 学生画像 section — APPENDED to a prompt's line list, never
// interleaved, so the no-profile prompt stays byte-identical (the explain.prompt.ts
// idiom). profileContext auto-gates for managed providers in generateKitContent
// (services/ai.ts applyProfileContextGate); build() stays a pure formatter. Steers the
// AI's confusion to EXACTLY where the student is shaky (MEM-3), not random.
export function appendProfileContext(lines: string[], profileContext: string | undefined): string[] {
  const profile = typeof profileContext === "string" ? profileContext.trim() : "";
  if (profile) {
    lines.push(
      "",
      "学生画像(供个性化——把你的困惑集中到学生的薄弱处,不要复述):",
      profile
    );
  }
  return lines;
}

/** Collapse whitespace + cap a string (shared by the mock projections). */
export function snippet(text: string | undefined, n = 60): string {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  return clean.length > n ? `${clean.slice(0, n)}…` : clean;
}
