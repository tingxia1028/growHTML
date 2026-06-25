import { describe, expect, it } from "vitest";
import { explanationSpec, exerciseSpec, mistakeSpec, reviewPackSpec } from "./contentTypes";
import {
  explainConceptPrompt,
  generatePracticePrompt,
  generateReviewPackPrompt,
  markAsMistakePrompt
} from "./prompts";

const PASSAGE = "The mitochondria is the powerhouse of the cell.";

describe("textbook prompt pack", () => {
  it("explain prompt builds with the passage and yields schema-valid mock content", () => {
    const built = explainConceptPrompt.build({ anchorText: PASSAGE, grade: "grade 8" });
    expect(built).toContain(PASSAGE);
    expect(built.toLowerCase()).toContain("json");
    const sample = explainConceptPrompt.mockContent!({ anchorText: PASSAGE });
    expect(() => explanationSpec.schema.parse(sample)).not.toThrow();
    expect((sample as { title: string }).title).toContain("mitochondria".slice(0, 5));
  });

  it("practice prompt yields schema-valid exercise mock content with a real answer", () => {
    const sample = generatePracticePrompt.mockContent!({ anchorText: PASSAGE });
    const parsed = exerciseSpec.schema.parse(sample);
    expect(parsed.options).toBeTruthy();
    expect(parsed.options).toContain(parsed.answer as string);
  });

  it("mistake prompt yields schema-valid mistake mock content", () => {
    const sample = markAsMistakePrompt.mockContent!({
      anchorText: PASSAGE,
      wrongAnswer: "ribosome",
      correctAnswer: "mitochondria"
    });
    const parsed = mistakeSpec.schema.parse(sample);
    expect(parsed.wrongAnswer).toBe("ribosome");
    expect(parsed.correctAnswer).toBe("mitochondria");
  });

  it("review-pack prompt yields schema-valid mock content scoped to the source", () => {
    const built = generateReviewPackPrompt.build({ sourceId: "src_42", explanations: [{ title: "Cells" }], mistakes: [] });
    expect(built).toContain("src_42");
    const sample = generateReviewPackPrompt.mockContent!({
      sourceId: "src_42",
      explanations: [{ title: "Cells" }, { title: "Energy" }],
      mistakes: [{ question: "What is ATP?" }]
    });
    const parsed = reviewPackSpec.schema.parse(sample);
    expect(parsed.scope.sourceId).toBe("src_42");
    expect(parsed.keyPoints).toContain("Cells");
    expect(parsed.weakPoints).toContain("What is ATP?");
  });

  it("every prompt's outputType matches its target spec contentType", () => {
    expect(explainConceptPrompt.outputType).toBe(explanationSpec.contentType);
    expect(generatePracticePrompt.outputType).toBe(exerciseSpec.contentType);
    expect(markAsMistakePrompt.outputType).toBe(mistakeSpec.contentType);
    expect(generateReviewPackPrompt.outputType).toBe(reviewPackSpec.contentType);
  });
});
