import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  getNoteContentSpec,
  listNoteContentSpecs,
  MISTAKE_CONTENT_TYPE,
  mistakeSpec,
  parseNoteContent,
  registerNoteContentSpec,
  registerNoteContentSpecAlias,
  resolveNoteContentTypeAlias
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

  // Video — unified asset | embed union with absent-kind backward-compat (Phase 2).
  describe("video (asset | embed union)", () => {
    it("accepts a LEGACY { assetId } note with NO kind (backward-compat) and defaults kind:'asset'", () => {
      // The exact shape a pre-Phase-2 video note was stored as.
      const legacy = { assetId: VALID_ASSET_ID, caption: "old clip", startSec: 3 };
      const parsed = parseNoteContent("video", legacy) as Record<string, unknown>;
      expect(parsed.kind).toBe("asset");
      expect(parsed.assetId).toBe(VALID_ASSET_ID);
      expect(parsed.caption).toBe("old clip");
      expect(parsed.startSec).toBe(3);
    });

    it("accepts an explicit { kind:'asset', assetId } note", () => {
      expect(() => parseNoteContent("video", { kind: "asset", assetId: VALID_ASSET_ID })).not.toThrow();
    });

    it("accepts an embed { kind:'embed', provider, videoId, url } note", () => {
      const embed = { kind: "embed", provider: "youtube", videoId: "dQw4w9WgXcQ", url: "https://youtu.be/dQw4w9WgXcQ" };
      expect(() => parseNoteContent("video", embed)).not.toThrow();
    });

    it("rejects an unknown provider and a missing videoId on embed", () => {
      expect(() =>
        parseNoteContent("video", { kind: "embed", provider: "dailymotion", videoId: "x", url: "u" })
      ).toThrow();
      expect(() => parseNoteContent("video", { kind: "embed", provider: "vimeo", url: "u" })).toThrow();
    });

    it("rejects an asset note with a bad assetId (the empty seed is not persistable)", () => {
      expect(() => parseNoteContent("video", { assetId: "" })).toThrow();
    });

    it("toSearchText returns the caption for both variants", () => {
      const spec = getNoteContentSpec("video")!;
      expect(spec.toSearchText({ kind: "asset", assetId: VALID_ASSET_ID, caption: "cap" })).toBe("cap");
      expect(
        spec.toSearchText({ kind: "embed", provider: "vimeo", videoId: "1", url: "u", caption: "talk" })
      ).toBe("talk");
    });
  });

  // REV-CORE — review/mistake capabilities + the contentType alias map
  // (docs/design/kit-flatten-and-core-review.md §1).
  describe("review capabilities + alias resolution (REV-CORE)", () => {
    it("mistake is a CORE built-in declaring the `mistake` capability", () => {
      expect(MISTAKE_CONTENT_TYPE).toBe("mistake");
      expect(listNoteContentSpecs().map((s) => s.contentType)).toContain("mistake");
      expect(mistakeSpec.mistake).toBe(true);
      expect(mistakeSpec.review).toBeUndefined(); // rule-1 material, not rule-2
    });

    it("quiz/flashcard declare review.reviewable + a gradable expectedAnswer", () => {
      const quiz = getNoteContentSpec("quiz")!;
      expect(quiz.review?.reviewable).toBe(true);
      expect(quiz.review!.expectedAnswer!({ question: "q", options: ["a", "b"], answerIndex: 1 })).toBe("b");
      expect(quiz.review!.expectedAnswer!({ question: "q", options: ["a", "b"], answerIndex: 9 })).toBeNull();
      const flashcard = getNoteContentSpec("flashcard")!;
      expect(flashcard.review?.reviewable).toBe(true);
      expect(flashcard.review!.expectedAnswer!({ front: "f", back: "背面" })).toBe("背面");
      expect(flashcard.review!.expectedAnswer!({ front: "f", back: "" })).toBeNull();
      // Non-review built-ins declare nothing.
      expect(getNoteContentSpec("markdown")!.review).toBeUndefined();
    });

    it('"textbook.mistake" ALIASES to the core mistake spec — lookup, parse, search all work', () => {
      expect(resolveNoteContentTypeAlias("textbook.mistake")).toBe("mistake");
      expect(getNoteContentSpec("textbook.mistake")).toBe(getNoteContentSpec("mistake"));
      // An OLD persisted record validates through the API path with the legacy id.
      const parsed = parseNoteContent("textbook.mistake", {
        question: "Q",
        wrongAnswer: "w",
        correctAnswer: "c"
      }) as { retryCount: number; mastery: string };
      expect(parsed.retryCount).toBe(0);
      expect(parsed.mastery).toBe("weak");
      expect(mistakeSpec.toSearchText({ question: "Q", wrongAnswer: "w", correctAnswer: "c", retryCount: 0, mastery: "weak" })).toContain("Q");
    });

    it("alias registration is GENERIC, and a DIRECT registration always beats an alias", () => {
      registerNoteContentSpecAlias("test.alias", "markdown");
      expect(getNoteContentSpec("test.alias")!.contentType).toBe("markdown");
      expect(() => parseNoteContent("test.alias", "hello")).not.toThrow();
      // A real spec registered under the alias id wins over the alias mapping.
      registerNoteContentSpec({
        contentType: "test.alias",
        schema: z.object({ x: z.number() }),
        createDefault: () => ({ x: 0 }),
        toSearchText: () => ""
      });
      expect(getNoteContentSpec("test.alias")!.contentType).toBe("test.alias");
      // An alias to an UNKNOWN target still reports unknown.
      registerNoteContentSpecAlias("test.dangling", "no.such.type");
      expect(getNoteContentSpec("test.dangling")).toBeUndefined();
      expect(() => parseNoteContent("test.dangling", {})).toThrow(/Unknown note contentType/);
    });
  });

  // Bookmark — a note type, zero core-schema change (docs/design/bookmark-modeling.md).
  describe("bookmark", () => {
    it("is registered as a built-in content type", () => {
      expect(listNoteContentSpecs().map((s) => s.contentType)).toContain("bookmark");
    });

    it("createDefault is an empty-label bookmark that round-trips its own schema", () => {
      const spec = getNoteContentSpec("bookmark")!;
      expect(spec.createDefault()).toEqual({ label: "" });
      expect(() => spec.schema.parse(spec.createDefault())).not.toThrow();
    });

    it("validates content: requires a string label, color/order optional", () => {
      expect(() => parseNoteContent("bookmark", { label: "Intro" })).not.toThrow();
      expect(() =>
        parseNoteContent("bookmark", { label: "Intro", color: "#ff0000", order: 2 })
      ).not.toThrow();
      // Missing/non-string label is rejected before storage.
      expect(() => parseNoteContent("bookmark", {})).toThrow();
      expect(() => parseNoteContent("bookmark", { label: 5 })).toThrow();
    });

    it("toSearchText returns the label", () => {
      expect(getNoteContentSpec("bookmark")!.toSearchText({ label: "Chapter 3" })).toBe("Chapter 3");
    });
  });
});
