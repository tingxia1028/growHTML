import { describe, it, expect, vi } from "vitest";
import { resolveForm, resolveFormAsync } from "./resolveForm";
import type { ClassifiedForm } from "./classifyContent";

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

// resolveFormAsync (Phase 4 item 2) — the recognition choke point WITH an optional,
// gated AI classify fallback for ambiguous prose. The heuristic stays PRIMARY: the AI
// pass fires only on a LOW-confidence heuristic AND a provided `classify` callback.
describe("resolveFormAsync — declared form is trusted (no model call)", () => {
  it("trusts a declared contentType and never calls classify", async () => {
    const classify = vi.fn();
    const r = await resolveFormAsync({ contentType: "flashcard", content: { front: "Q", back: "A" } }, { classify });
    expect(r).toEqual({ contentType: "flashcard", content: { front: "Q", back: "A" }, confidence: "high" });
    expect(classify).not.toHaveBeenCalled();
  });
});

describe("resolveFormAsync — high-confidence heuristic short-circuits the model", () => {
  it("uses the heuristic and does NOT call classify for a confident match", async () => {
    const classify = vi.fn();
    const r = await resolveFormAsync({ text: "```mermaid\ngraph TD; A-->B\n```" }, { classify });
    expect(r.contentType).toBe("mermaid");
    expect(r.confidence).toBe("high");
    expect(classify).not.toHaveBeenCalled();
  });
});

describe("resolveFormAsync — low-confidence prose triggers the AI fallback when available", () => {
  it("calls classify for low-confidence prose and uses its verdict", async () => {
    const aiForm: ClassifiedForm = { contentType: "quiz", content: { question: "?", options: ["a", "b"], answerIndex: 0 }, confidence: "high" };
    const classify = vi.fn(async () => aiForm);
    const r = await resolveFormAsync({ text: "turn this into a quiz please" }, { classify });
    expect(classify).toHaveBeenCalledOnce();
    expect(classify).toHaveBeenCalledWith("turn this into a quiz please");
    expect(r).toEqual(aiForm);
  });

  it("keeps the heuristic markdown fallback when the AI pass declines (returns null)", async () => {
    const classify = vi.fn(async () => null);
    const r = await resolveFormAsync({ text: "just some prose" }, { classify });
    expect(classify).toHaveBeenCalledOnce();
    expect(r.contentType).toBe("markdown");
    expect(r.confidence).toBe("low");
  });

  it("never throws when the AI pass fails — degrades to the heuristic fallback", async () => {
    const classify = vi.fn(async () => {
      throw new Error("provider down");
    });
    const r = await resolveFormAsync({ text: "ambiguous prose" }, { classify });
    expect(r.contentType).toBe("markdown");
    expect(r.confidence).toBe("low");
  });
});

describe("resolveFormAsync — no provider = today's behavior (heuristic + markdown fallback)", () => {
  it("with NO classify callback, low-confidence prose stays markdown (no model call possible)", async () => {
    const r = await resolveFormAsync({ text: "just some prose" });
    expect(r.contentType).toBe("markdown");
    expect(r.confidence).toBe("low");
  });

  it("with NO classify callback, a confident heuristic still resolves the rich form", async () => {
    const r = await resolveFormAsync({ text: "# Root\n## A\n## B" });
    expect(r.contentType).toBe("markmap");
    expect(r.confidence).toBe("high");
  });
});
