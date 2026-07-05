// Core review operations (REV-1 + REV-2, ported from the dissolved review plugin by
// REV-CORE) — the three CORE prompt records through the REAL structured-generation
// engine + MockModelProvider: declared-form check generation (outputType quiz), the
// grade schema roundtrip incl. the re-prompt path, explain as markdown, the
// review.grade spec validation, and the CORE registration seam (the kit-prompt
// registry seeds them on load — no plugin manifest, no installServerKits required).
// REV-2: the explain profileContext weave — facts present ⇒ one delimited 学生画像
// section; absent ⇒ byte-identical REV-1 prompt (regression-pinned). The
// managed-provider strip is the SERVER's (services/ai.ts) — tested there, not here.

import { describe, expect, it } from "vitest";
import { MockModelProvider } from "../../ai/mockProvider";
import type { ChatResponse, ModelProvider } from "../../ai/provider";
import { getNoteContentSpec } from "../notes/contentTypes";
import { generateStructuredContent, StructuredGenerationError } from "../../kits/structured";
import { getKitPrompt } from "../../kits/prompts";
import { REVIEW_GRADE_CONTENT_TYPE, reviewGradeSpec, type ReviewGradeContent } from "./contentTypes";
import { coreReviewPrompts, explainPrompt, generateCheckPrompt, gradeAnswerPrompt } from "./prompts";

const NOTE_TEXT = "浮力等于排开液体的重力 (阿基米德原理)。";

describe("core registration (REV-CORE — no plugin manifest)", () => {
  it("the three operations are seeded into the prompt registry the moment it loads", () => {
    for (const id of ["review.generate-check", "review.grade-answer", "review.explain"]) {
      expect(getKitPrompt(id), `prompt ${id} must be registered at core seed`).toBeTruthy();
    }
    // The EXACT ids are pinned: the REV-2 server profileContext gate keys on them.
    expect(coreReviewPrompts.map((p) => p.id)).toEqual([
      "review.generate-check",
      "review.grade-answer",
      "review.explain"
    ]);
  });

  it("the grade content spec registers with the core registry (import-time seed)", () => {
    expect(getNoteContentSpec(REVIEW_GRADE_CONTENT_TYPE)).toBeTruthy();
  });

  it("every review prompt's outputType matches a REGISTERED content spec", () => {
    for (const prompt of coreReviewPrompts) {
      expect(getNoteContentSpec(prompt.outputType), `${prompt.id} → ${prompt.outputType}`).toBeTruthy();
    }
    expect(generateCheckPrompt.outputType).toBe("quiz"); // the EXISTING built-in type
    expect(gradeAnswerPrompt.outputType).toBe(reviewGradeSpec.contentType);
    expect(explainPrompt.outputType).toBe("markdown"); // the EXISTING built-in type
  });
});

describe("review.generate-check — declared-form quiz generation", () => {
  it("builds a prompt carrying the note text and generates quiz-schema-valid content", async () => {
    const built = generateCheckPrompt.build({ noteText: NOTE_TEXT, contentType: "mistake" });
    expect(built).toContain(NOTE_TEXT);
    expect(built.toLowerCase()).toContain("json");
    expect(built).toContain("mistake");

    const content = await generateStructuredContent(new MockModelProvider(), {
      promptId: "review.generate-check",
      contentType: "quiz",
      input: { noteText: NOTE_TEXT, contentType: "mistake" }
    });
    const quiz = getNoteContentSpec("quiz")!.schema.parse(content) as {
      question: string;
      options: string[];
      answerIndex: number;
    };
    expect(quiz.question).toContain(NOTE_TEXT.slice(0, 10));
    expect(quiz.options.length).toBeGreaterThanOrEqual(2);
    expect(quiz.options[quiz.answerIndex]).toBeTruthy(); // a gradable expected answer exists
  });

  it("declared-form guard: asking the check prompt for another contentType is a 400-shaped error", async () => {
    await expect(
      generateStructuredContent(new MockModelProvider(), {
        promptId: "review.generate-check",
        contentType: "markdown"
      })
    ).rejects.toBeInstanceOf(StructuredGenerationError);
  });
});

describe("review.grade-answer — grade schema roundtrip", () => {
  it("mock grading is deterministic: matching answer → correct, mismatch → incorrect", async () => {
    const provider = new MockModelProvider();
    const pass = (await generateStructuredContent(provider, {
      promptId: "review.grade-answer",
      contentType: REVIEW_GRADE_CONTENT_TYPE,
      input: { question: "浮力等于什么?", expected: "排开液体的重力", userAnswer: " 排开液体的重力 " }
    })) as ReviewGradeContent;
    expect(pass).toMatchObject({ correct: true });
    expect(reviewGradeSpec.schema.parse(pass)).toEqual(pass);

    const fail = (await generateStructuredContent(provider, {
      promptId: "review.grade-answer",
      contentType: REVIEW_GRADE_CONTENT_TYPE,
      input: { question: "浮力等于什么?", expected: "排开液体的重力", userAnswer: "物体的重力" }
    })) as ReviewGradeContent;
    expect(fail.correct).toBe(false);
    expect(fail.explanation).toContain("排开液体的重力"); // the explanation teaches the expected answer
  });

  it("re-prompt path: an invalid first reply is corrected on retry and validates", async () => {
    let calls = 0;
    const flaky: ModelProvider = {
      id: "flaky",
      capabilities: { chat: true, agentic: false, streaming: false, structured: false, tools: false, vision: false, kind: "mock" },
      async complete(): Promise<ChatResponse> {
        calls += 1;
        const content =
          calls === 1
            ? '{"correct":"yes","explanation":42}' // wrong types → schema error → re-prompt
            : '{"correct":false,"explanation":"再想想"}';
        return { message: { role: "assistant", content } };
      }
    };
    const graded = (await generateStructuredContent(flaky, {
      promptId: "review.grade-answer",
      contentType: REVIEW_GRADE_CONTENT_TYPE,
      input: { question: "q", expected: "a", userAnswer: "b" }
    })) as ReviewGradeContent;
    expect(calls).toBe(2);
    expect(graded).toEqual({ correct: false, explanation: "再想想" });
  });

  it("persistently invalid grade output exhausts attempts and throws", async () => {
    const bad: ModelProvider = {
      id: "bad",
      capabilities: { chat: true, agentic: false, streaming: false, structured: false, tools: false, vision: false, kind: "mock" },
      async complete(): Promise<ChatResponse> {
        return { message: { role: "assistant", content: '{"correct":"nope"}' } };
      }
    };
    await expect(
      generateStructuredContent(
        bad,
        { promptId: "review.grade-answer", contentType: REVIEW_GRADE_CONTENT_TYPE, input: {} },
        2
      )
    ).rejects.toBeInstanceOf(StructuredGenerationError);
  });
});

describe("review.explain — markdown explanation", () => {
  it("builds with the item + wrong answer and yields a markdown STRING", async () => {
    const built = explainPrompt.build({ question: "浮力等于什么?", expected: "排开液体的重力", userAnswer: "物体的重力" });
    expect(built).toContain("物体的重力");
    expect(built).toContain("排开液体的重力");

    const content = await generateStructuredContent(new MockModelProvider(), {
      promptId: "review.explain",
      contentType: "markdown",
      input: { question: "浮力等于什么?", expected: "排开液体的重力", userAnswer: "物体的重力" }
    });
    expect(typeof content).toBe("string");
    expect(getNoteContentSpec("markdown")!.schema.parse(content)).toBe(content);
    expect(content as string).toContain("为什么错了");
    expect(content as string).toContain("排开液体的重力");
  });
});

describe("review.explain — REV-2 profileContext weave", () => {
  const base = { question: "浮力等于什么?", expected: "排开液体的重力", userAnswer: "物体的重力" };
  const PROFILE = "弱项:浮力 — 复习错误率 67%(4/6 次未过,学科)\n连续学习 — 3 天(至 2026-07-01)";

  it("with a profileContext the prompt gains ONE clearly-delimited 学生画像 section", () => {
    const built = explainPrompt.build({ ...base, profileContext: PROFILE });
    expect(built).toContain("学生画像(供个性化,不要复述):");
    expect(built).toContain("弱项:浮力 — 复习错误率 67%(4/6 次未过,学科)");
    expect(built).toContain("连续学习 — 3 天(至 2026-07-01)");
    // Appended AFTER the REV-1 body — the base prompt is an exact prefix.
    expect(built.startsWith(explainPrompt.build(base))).toBe(true);
  });

  it("REGRESSION PIN: without profileContext the prompt is byte-identical to REV-1", () => {
    const rev1 = [
      "A student just got a review item WRONG. Explain it so they master it:",
      "state the correct idea, why their answer misses it, and one memorable takeaway.",
      "Answer in the student's language, in concise markdown.",
      "Return the markdown as ONE JSON-encoded string — the entire reply is a single",
      'JSON string value (e.g. "## Why…"), not an object.',
      "",
      "Item: 浮力等于什么?",
      "Correct answer: 排开液体的重力",
      "Student's answer: 物体的重力"
    ].join("\n");
    expect(explainPrompt.build(base)).toBe(rev1);
    expect(explainPrompt.build({ ...base, profileContext: undefined })).toBe(rev1);
    // Empty/whitespace contexts are ABSENT, not an empty section.
    expect(explainPrompt.build({ ...base, profileContext: "" })).toBe(rev1);
    expect(explainPrompt.build({ ...base, profileContext: "  \n " })).toBe(rev1);
    expect(explainPrompt.build(base)).not.toContain("学生画像");
  });

  it("through the engine: a message-capturing provider sees the facts iff provided", async () => {
    const seen: string[] = [];
    const capturing: ModelProvider = {
      id: "capturing",
      capabilities: { chat: true, agentic: false, streaming: false, structured: false, tools: false, vision: false, kind: "mock" },
      async complete(request): Promise<ChatResponse> {
        // [0] is the JSON-only system message; these tests only send text content, so
        // the content is a bare string (V-1 union widened the type; assert the string arm).
        seen.push(request.messages[1].content as string);
        return { message: { role: "assistant", content: '"**为什么错了** …"' } };
      }
    };
    await generateStructuredContent(capturing, {
      promptId: "review.explain",
      contentType: "markdown",
      input: { ...base, profileContext: PROFILE }
    });
    await generateStructuredContent(capturing, { promptId: "review.explain", contentType: "markdown", input: base });
    expect(seen[0]).toContain("学生画像(供个性化,不要复述):");
    expect(seen[0]).toContain("弱项:浮力");
    expect(seen[1]).not.toContain("学生画像");
    expect(seen[1]).toBe(explainPrompt.build(base)); // absent-identical at the wire too
  });
});

describe("review.grade content spec", () => {
  it("validates the {correct, explanation} shape and rejects malformed grades", () => {
    expect(reviewGradeSpec.schema.parse({ correct: true, explanation: "对" })).toEqual({
      correct: true,
      explanation: "对"
    });
    expect(() => reviewGradeSpec.schema.parse({ explanation: "missing correct" })).toThrow();
    expect(() => reviewGradeSpec.schema.parse({ correct: "yes", explanation: "" })).toThrow();
    expect(() => reviewGradeSpec.schema.parse({ correct: false, explanation: 42 })).toThrow();
  });

  it("createDefault parses against its own schema; toSearchText is the explanation", () => {
    const blank = reviewGradeSpec.createDefault();
    expect(reviewGradeSpec.schema.parse(blank)).toEqual(blank);
    expect(reviewGradeSpec.toSearchText({ correct: false, explanation: "why" })).toBe("why");
  });

  it("grades are a hidden transport shape: the spec exists, the wire id stays stable", () => {
    // The spec registers for validation only; the CLIENT half is hidden (asserted in
    // the core registration test) — here we just pin the id so the wire stays stable.
    expect(reviewGradeSpec.contentType).toBe("review.grade");
  });
});
