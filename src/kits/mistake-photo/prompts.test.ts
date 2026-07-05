import { describe, expect, it } from "vitest";
import { getNoteContentSpec, MISTAKE_CONTENT_TYPE, mistakeSpec } from "../../core/notes/contentTypes";
import { extractMistakePrompt, mistakePhotoPrompts } from "./prompts";

describe("mistake-photo extract prompt — the 拍错题 VLM projection", () => {
  it("outputs the CORE `mistake` contentType (rides adaptive-note render/save, no kit spec)", () => {
    expect(extractMistakePrompt.outputType).toBe(MISTAKE_CONTENT_TYPE);
    // The routed contentType resolves to a REGISTERED spec (preview/save reuse it).
    expect(getNoteContentSpec(extractMistakePrompt.outputType)).toBeTruthy();
  });

  it("build() names the mistake fields the VLM must fill (question/wrong/correct/因/订正)", () => {
    const built = extractMistakePrompt.build({});
    expect(built).toContain("question");
    expect(built).toContain("wrongAnswer");
    expect(built).toContain("correctAnswer");
    expect(built).toContain("mistakeReason");
    expect(built).toContain("correction");
    // It reads a PHOTO, never a `{{images}}` template value (the image is a message part).
    expect(built).toContain("照片");
    expect(built).not.toContain("{{images}}");
  });

  it("an optional hint is appended to the prompt body (verbatim), absent otherwise", () => {
    const bare = extractMistakePrompt.build({});
    expect(bare).not.toContain("补充提示");
    const withHint = extractMistakePrompt.build({ hint: "五年级数学 分数加法" });
    expect(withHint).toContain("补充提示:五年级数学 分数加法");
    // The no-hint body is preserved verbatim (appended, never interleaved).
    expect(withHint.startsWith(bare.replace(/\n$/, ""))).toBe(true);
  });

  it("mockContent is schema-valid against mistakeSpec.schema and fills all required fields", () => {
    const sample = extractMistakePrompt.mockContent!({});
    expect(() => mistakeSpec.schema.parse(sample)).not.toThrow();
    const parsed = mistakeSpec.schema.parse(sample);
    expect(parsed.question.length).toBeGreaterThan(0);
    expect(parsed.wrongAnswer.length).toBeGreaterThan(0);
    expect(parsed.correctAnswer.length).toBeGreaterThan(0);
    expect(parsed.mastery).toBe("weak");
    expect(parsed.retryCount).toBe(0);
    // pure/stable: identical input → identical output
    expect(extractMistakePrompt.mockContent!({})).toEqual(sample);
  });

  it("mockContent weaves a hint into the diagnosis but stays schema-valid", () => {
    const sample = extractMistakePrompt.mockContent!({ hint: "五年级" }) as { mistakeReason?: string };
    expect(() => mistakeSpec.schema.parse(sample)).not.toThrow();
    expect(sample.mistakeReason).toContain("五年级");
  });

  it("the pack aggregates the one extract prompt", () => {
    expect(mistakePhotoPrompts).toHaveLength(1);
    expect(mistakePhotoPrompts[0].id).toBe("mistake-photo.extract");
  });
});
