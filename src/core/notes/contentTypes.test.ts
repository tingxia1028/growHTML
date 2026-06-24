import { describe, expect, it } from "vitest";
import {
  getNoteContentSpec,
  listNoteContentSpecs,
  parseNoteContent
} from "./contentTypes";

const VALID_ASSET_ID = "asset_01ARZ3NDEKTSV4RRFFQ69G5FB1";

describe("note content specs", () => {
  it("registers the built-in content types", () => {
    const types = listNoteContentSpecs().map((spec) => spec.contentType);
    for (const t of ["markdown", "plain-text", "mindmap", "flashcard", "quiz", "image", "html-sandbox"]) {
      expect(types).toContain(t);
    }
  });

  // Types whose createDefault is a *complete* value must round-trip through
  // their own schema. (quiz + media seeds are intentionally incomplete — they
  // require user-filled mandatory fields before save; covered separately below.)
  it("createDefault parses for types with a complete default", () => {
    for (const type of ["markdown", "plain-text", "mindmap", "flashcard", "mermaid", "markmap", "code-snippet", "html-sandbox"]) {
      const spec = getNoteContentSpec(type)!;
      expect(() => spec.schema.parse(spec.createDefault())).not.toThrow();
    }
  });

  it("validates content shape per type", () => {
    expect(() => parseNoteContent("markdown", "hello")).not.toThrow();
    // quiz needs >=2 options and an answerIndex
    expect(() => parseNoteContent("quiz", { question: "Q", options: ["only-one"], answerIndex: 0 })).toThrow();
    expect(() =>
      parseNoteContent("quiz", { question: "Q", options: ["a", "b"], answerIndex: 1 })
    ).not.toThrow();
    // image needs a real asset id; the empty createDefault seed is rejected
    expect(() => parseNoteContent("image", { assetId: "" })).toThrow();
    expect(() => parseNoteContent("image", { assetId: VALID_ASSET_ID, caption: "fig" })).not.toThrow();
  });

  it("rejects an unknown content type", () => {
    expect(() => parseNoteContent("totally-unknown", "x")).toThrow(/Unknown note contentType/);
  });

  it("reduces content to searchable text without structural noise", () => {
    expect(getNoteContentSpec("flashcard")!.toSearchText({ front: "Q", back: "A" })).toBe("Q A");
    expect(getNoteContentSpec("mindmap")!.toSearchText({ title: "Root", children: [{ title: "Child" }] })).toContain("Child");
    expect(getNoteContentSpec("html-sandbox")!.toSearchText({ html: "<p>Hi <b>there</b></p>" })).toBe("Hi there");
  });
});
