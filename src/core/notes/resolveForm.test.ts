import { describe, it, expect } from "vitest";
import { resolveForm } from "./resolveForm";

// resolveForm (adaptive note forms · Phase 1a). The single choke point: a DECLARED
// form is trusted (high); otherwise the free text is classified.

describe("resolveForm — declared form is trusted", () => {
  it("returns the declared contentType + content verbatim at high confidence", () => {
    const content = { front: "Q", back: "A" };
    const r = resolveForm({ contentType: "flashcard", content });
    expect(r).toEqual({ contentType: "flashcard", content, confidence: "high" });
  });

  it("does NOT re-classify declared content even when the content looks like another form", () => {
    // Content that classifyContent would call mermaid, but the caller declared markdown.
    const r = resolveForm({ contentType: "markdown", content: "graph TD; A-->B" });
    expect(r.contentType).toBe("markdown");
    expect(r.confidence).toBe("high");
  });
});

describe("resolveForm — undeclared form delegates to classifyContent", () => {
  it("classifies a mermaid fence to mermaid (high)", () => {
    const r = resolveForm({ text: "```mermaid\ngraph TD; A-->B\n```" });
    expect(r.contentType).toBe("mermaid");
    expect(r.confidence).toBe("high");
  });

  it("classifies a multi-level outline to markmap (high)", () => {
    const r = resolveForm({ text: "# Root\n## A\n## B" });
    expect(r.contentType).toBe("markmap");
  });

  it("falls back to markdown (low) for plain prose", () => {
    const r = resolveForm({ text: "just some prose" });
    expect(r.contentType).toBe("markdown");
    expect(r.confidence).toBe("low");
  });

  it("never throws and falls back to markdown with no input at all", () => {
    expect(() => resolveForm({})).not.toThrow();
    expect(resolveForm({}).contentType).toBe("markdown");
  });

  it("ignores an empty-string contentType (treats as undeclared)", () => {
    const r = resolveForm({ contentType: "", text: "# Root\n## A\n## B" });
    expect(r.contentType).toBe("markmap");
  });
});
