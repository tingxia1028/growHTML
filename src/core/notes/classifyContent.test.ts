import { describe, it, expect } from "vitest";
import { classifyContent } from "./classifyContent";
import { getNoteContentSpec } from "./contentTypes";

// classifyContent (adaptive note forms · Phase 1a). High-precision, most-specific
// first, NEVER throws, low-confidence markdown fallback. Each rule is verified with a
// positive case, a negative (must NOT fire) case, and EXACT content shaping against
// the target contentType's real core schema.

// Helper: assert the classified content actually validates against the type's spec —
// the contract is "content shaped for that contentType's existing schema".
function expectValidForType(contentType: string, content: unknown) {
  const spec = getNoteContentSpec(contentType);
  expect(spec, `no core spec registered for ${contentType}`).toBeTruthy();
  expect(() => spec!.schema.parse(content)).not.toThrow();
}

describe("classifyContent — mermaid", () => {
  it("detects a ```mermaid``` fence (high) and strips the fence", () => {
    const raw = "```mermaid\ngraph TD;\n  A --> B;\n```";
    const r = classifyContent(raw);
    expect(r.contentType).toBe("mermaid");
    expect(r.confidence).toBe("high");
    expect(r.content).toBe("graph TD;\n  A --> B;");
    expectValidForType("mermaid", r.content);
  });

  it("detects a bare diagram source leading with a mermaid keyword (high)", () => {
    for (const lead of ["graph TD; A-->B", "flowchart LR\n A --> B", "sequenceDiagram\n A->>B: hi", "classDiagram\n class A"]) {
      const r = classifyContent(lead);
      expect(r.contentType, lead).toBe("mermaid");
      expect(r.confidence).toBe("high");
      expect(r.content).toBe(lead.trim());
    }
  });

  it("does NOT classify prose that merely mentions 'graph' as mermaid", () => {
    const r = classifyContent("The graph below shows the trend over time.");
    expect(r.contentType).not.toBe("mermaid");
  });
});

describe("classifyContent — markmap", () => {
  it("detects a multi-level heading outline (high) with the markdown string as content", () => {
    const raw = "# Root\n## Child A\n## Child B\n### Grandchild";
    const r = classifyContent(raw);
    expect(r.contentType).toBe("markmap");
    expect(r.confidence).toBe("high");
    expect(r.content).toBe(raw.trim());
    expectValidForType("markmap", r.content);
  });

  it("detects a nested bullet outline (≥2 indent levels) as markmap", () => {
    const raw = "- Fruits\n  - Apple\n  - Banana\n- Vegetables";
    const r = classifyContent(raw);
    expect(r.contentType).toBe("markmap");
    expect(r.confidence).toBe("high");
  });

  it("does NOT classify a SINGLE-level heading doc as markmap (falls to markdown)", () => {
    const raw = "# Title\nSome prose here.\nMore prose.";
    const r = classifyContent(raw);
    expect(r.contentType).toBe("markdown");
    expect(r.confidence).toBe("low");
  });

  it("does NOT classify a FLAT bullet list (all depth 0) as markmap", () => {
    const raw = "- one\n- two\n- three";
    const r = classifyContent(raw);
    expect(r.contentType).not.toBe("markmap");
  });
});

describe("classifyContent — code-snippet", () => {
  it("detects a ```lang``` fence with a known language (high), shaped { language, code }", () => {
    const raw = "```ts\nconst x: number = 1;\nexport { x };\n```";
    const r = classifyContent(raw);
    expect(r.contentType).toBe("code-snippet");
    expect(r.confidence).toBe("high");
    expect(r.content).toEqual({ language: "ts", code: "const x: number = 1;\nexport { x };" });
    expectValidForType("code-snippet", r.content);
  });

  it("normalizes the language to lower-case", () => {
    const r = classifyContent("```PYTHON\nprint('hi')\n```");
    expect(r.contentType).toBe("code-snippet");
    expect((r.content as { language: string }).language).toBe("python");
  });

  it("does NOT treat a fence with an UNKNOWN info-string as code-snippet (→ markdown)", () => {
    const r = classifyContent("```\nplain fenced text\n```");
    expect(r.contentType).toBe("markdown");
    expect(r.confidence).toBe("low");
  });
});

describe("classifyContent — video-embed (Phase 2)", () => {
  it("a BARE provider link → video {kind:'embed'} (high), per provider", () => {
    const cases: Array<[string, string, string]> = [
      ["https://youtu.be/dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ"],
      ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ"],
      ["https://www.bilibili.com/video/BV1xx411c7mu", "bilibili", "BV1xx411c7mu"],
      ["https://vimeo.com/123456789", "vimeo", "123456789"]
    ];
    for (const [url, provider, videoId] of cases) {
      const r = classifyContent(url);
      expect(r.contentType, url).toBe("video");
      expect(r.confidence).toBe("high");
      expect(r.content).toEqual({ kind: "embed", provider, videoId, url });
      expectValidForType("video", r.content);
    }
  });

  it("a link INSIDE prose stays markdown (low) — not a bare URL", () => {
    const r = classifyContent("Watch this https://youtu.be/dQw4w9WgXcQ it's great");
    expect(r.contentType).toBe("markdown");
    expect(r.confidence).toBe("low");
  });

  it("a NON-video URL does NOT classify as video (→ markdown)", () => {
    const r = classifyContent("https://example.com/page");
    expect(r.contentType).toBe("markdown");
    expect(r.confidence).toBe("low");
  });
});

describe("classifyContent — markdown fallback", () => {
  it("falls back to markdown (low) for ordinary prose", () => {
    const raw = "Just a sentence of plain prose with no special structure.";
    const r = classifyContent(raw);
    expect(r.contentType).toBe("markdown");
    expect(r.confidence).toBe("low");
    expect(r.content).toBe(raw);
    expectValidForType("markdown", r.content);
  });

  it("falls back to markdown for empty / whitespace input and never throws", () => {
    for (const raw of ["", "   ", "\n\n"]) {
      const r = classifyContent(raw);
      expect(r.contentType).toBe("markdown");
      expect(r.confidence).toBe("low");
    }
  });

  it("never throws on non-string / pathological input", () => {
    // @ts-expect-error — testing the runtime totality guarantee.
    expect(() => classifyContent(undefined)).not.toThrow();
    // @ts-expect-error
    expect(classifyContent(null).contentType).toBe("markdown");
    // @ts-expect-error
    expect(classifyContent(42).contentType).toBe("markdown");
  });
});

describe("classifyContent — rule ordering (most-specific first)", () => {
  it("an outline that contains a code fence is still markmap, not code-snippet", () => {
    const raw = "# Root\n## Section\n```ts\nconst x = 1;\n```";
    const r = classifyContent(raw);
    expect(r.contentType).toBe("markmap");
  });

  it("a mermaid fence wins over everything else", () => {
    const raw = "```mermaid\nflowchart LR\n A --> B\n```";
    expect(classifyContent(raw).contentType).toBe("mermaid");
  });
});
