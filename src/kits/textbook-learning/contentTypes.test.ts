import { describe, expect, it } from "vitest";
import { getNoteContentSpec, parseNoteContent } from "../../core/notes/contentTypes";
import { installServerKits } from "../server";
import { exerciseSpec, explanationSpec, mistakeSpec, reviewPackSpec } from "./contentTypes";

// installServerKits registers the kit's React-free specs into the core registry
// (the same path the server uses for API validation).
installServerKits();

const TYPES = ["textbook.explanation", "textbook.exercise", "textbook.mistake", "textbook.review-pack"];

describe("Textbook Kit content specs", () => {
  it("registers all 4 Study Block content types into the core registry", () => {
    for (const t of TYPES) expect(getNoteContentSpec(t), `missing spec ${t}`).toBeTruthy();
  });

  it("each createDefault round-trips through its own schema", () => {
    for (const spec of [explanationSpec, exerciseSpec, mistakeSpec, reviewPackSpec]) {
      expect(() => spec.schema.parse(spec.createDefault())).not.toThrow();
    }
  });

  it("validates review-pack content (source-level scope required)", () => {
    expect(() =>
      parseNoteContent("textbook.review-pack", { title: "Ch1", scope: { sourceId: "src_1" }, summary: "S" })
    ).not.toThrow();
    // scope.sourceId is required
    expect(() => parseNoteContent("textbook.review-pack", { title: "Ch1", scope: {}, summary: "S" })).toThrow();
  });

  it("validates content shape per type via the API path", () => {
    expect(() =>
      parseNoteContent("textbook.explanation", { title: "T", level: "standard", explanation: "E" })
    ).not.toThrow();
    // bad enum value is rejected
    expect(() =>
      parseNoteContent("textbook.explanation", { title: "T", level: "wat", explanation: "E" })
    ).toThrow();
    expect(() =>
      parseNoteContent("textbook.exercise", { question: "Q", type: "single-choice", answer: "A", explanation: "X" })
    ).not.toThrow();
    expect(() =>
      parseNoteContent("textbook.exercise", { question: "Q", type: "nope", answer: "A", explanation: "X" })
    ).toThrow();
    expect(() =>
      parseNoteContent("textbook.mistake", { question: "Q", wrongAnswer: "w", correctAnswer: "c" })
    ).not.toThrow();
  });

  it("fills array/default fields on parse", () => {
    const parsed = parseNoteContent("textbook.explanation", {
      title: "T",
      level: "simple",
      explanation: "E"
    }) as { keyPoints: string[]; commonMisunderstandings: string[] };
    expect(parsed.keyPoints).toEqual([]);
    expect(parsed.commonMisunderstandings).toEqual([]);
    const ex = parseNoteContent("textbook.exercise", {
      question: "Q",
      type: "single-choice",
      answer: "A",
      explanation: "X"
    }) as { difficulty: string; relatedKnowledgePoints: string[] };
    expect(ex.difficulty).toBe("medium");
    const m = parseNoteContent("textbook.mistake", {
      question: "Q",
      wrongAnswer: "w",
      correctAnswer: "c"
    }) as { retryCount: number; mastery: string };
    expect(m.retryCount).toBe(0);
    expect(m.mastery).toBe("weak");
  });

  it("reduces content to searchable text without structural noise", () => {
    expect(
      explanationSpec.toSearchText({
        title: "Photosynthesis",
        level: "standard",
        explanation: "Plants make food.",
        keyPoints: ["light", "chlorophyll"],
        commonMisunderstandings: []
      })
    ).toBe("Photosynthesis\nPlants make food.\nlight\nchlorophyll");
    expect(
      exerciseSpec.toSearchText({
        question: "What is 2+2?",
        type: "single-choice",
        options: ["3", "4"],
        answer: "4",
        explanation: "Addition.",
        difficulty: "easy",
        relatedKnowledgePoints: []
      })
    ).toBe("What is 2+2?\nAddition.");
    expect(
      mistakeSpec.toSearchText({
        question: "Q",
        wrongAnswer: "w",
        correctAnswer: "c",
        mistakeReason: "misread",
        retryCount: 1,
        mastery: "weak"
      })
    ).toBe("Q\nmisread\n");
  });
});
