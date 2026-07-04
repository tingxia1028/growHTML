// Operation `review.generate-check` — declared-form generation of ONE check
// question FROM a note's content, through the EXISTING /api/kits/generate path.
// Output type is the built-in `quiz` (question/options/answerIndex/explanation) —
// the review loop invents no new study material shape (review-loop.md §0). React-free.
//
// REV-CORE: lives in core (the review loop is the mission loop) — the prompt id and
// outputType are UNCHANGED from the dissolved review plugin, so the server-side
// profileContext gate and every stored operation-pref keep working.
// KitPrompt is a React-free structural contract (type-only import — erased at runtime).

import type { KitPrompt } from "../../../kits/types";

// What the runner sends: the note's content flattened to text (the core spec's
// toSearchText — the same React-free reducer search/export use) + its contentType,
// so the model knows what kind of study block it is quizzing.
export type GenerateCheckInput = {
  noteText?: string;
  contentType?: string;
  grade?: string;
  subject?: string;
};

const snippet = (text: string | undefined, n = 60) => {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  return clean.length > n ? `${clean.slice(0, n)}…` : clean || "this study note";
};

export const generateCheckPrompt: KitPrompt<GenerateCheckInput> = {
  id: "review.generate-check",
  outputType: "quiz",
  params: [
    { name: "grade", label: "学段/年级", kind: "grade" },
    { name: "subject", label: "学科", kind: "text" }
  ],
  build: (input) =>
    [
      `You are an AI tutor for ${input.grade ?? "secondary-school"} students` +
        (input.subject ? ` studying ${input.subject}` : "") +
        ".",
      `The student is REVIEWING a saved study note (type: ${input.contentType ?? "note"}).`,
      "Write ONE check question that tests whether they still master the note below.",
      "Return a JSON object with: question (string), options (array of 2+ strings),",
      "answerIndex (0-based index of the correct option), explanation (string).",
      "",
      "Study note:",
      input.noteText ?? ""
    ].join("\n"),
  // Deterministic, quiz-schema-valid sample the mock provider echoes: the correct
  // option restates the note, so grade-answer's expected/userAnswer compare is
  // exercisable offline end-to-end.
  mockContent: (input) => ({
    question: `下面哪一项符合这条笔记的内容:"${snippet(input.noteText, 50)}"?`,
    options: [
      `正确理解:${snippet(input.noteText, 40)}`,
      "一个常见的误解",
      "一个无关的说法"
    ],
    answerIndex: 0,
    explanation: "第一项复述了笔记的核心内容;其余两项偏离或与之矛盾。"
  })
};
