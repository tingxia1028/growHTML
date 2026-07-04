import { describe, expect, it } from "vitest";
import { attachmentsBlock, contextPreamble } from "./buildPrompt";
import type { ChatContext } from "./provider";

// The flat single-passage context — the pre-W2 shape (no `sources`). Its preamble
// must be byte-identical to before the W2 widening (the hard regression lock).
const flatContext: ChatContext = {
  sourceTitle: "Render Thread",
  sourceType: "article",
  location: "https://example.com/render",
  quote: "submits rendering commands",
  contextBefore: "The render thread ",
  contextAfter: " to the GPU."
};

const FLAT_PREAMBLE =
  "Source: Render Thread (article)\nLocation: https://example.com/render" +
  "\n\nSelected passage (between ⟦⟧, with surrounding context):\n" +
  "…The render thread ⟦submits rendering commands⟧ to the GPU.…";

describe("attachmentsBlock (W2 source attachments)", () => {
  it("is EMPTY at zero attachments (no sources key)", () => {
    expect(attachmentsBlock(undefined)).toBe("");
    expect(attachmentsBlock({})).toBe("");
    expect(attachmentsBlock(flatContext)).toBe("");
    expect(attachmentsBlock({ sources: [] })).toBe("");
  });

  it("leads with the 'Attached: N source(s)' count marker", () => {
    const block = attachmentsBlock({
      sources: [
        { title: "Alpha", type: "article", excerpt: "Alpha body." },
        { title: "Beta", type: "pdf", excerpt: "Beta body." }
      ]
    });
    expect(block.startsWith("Attached: 2 source(s)")).toBe(true);
  });

  it("renders each source's identity, excerpt, and notes", () => {
    const block = attachmentsBlock({
      sources: [
        {
          title: "Photosynthesis",
          type: "article",
          location: "https://bio.example/photo",
          excerpt: "Light into chemical energy.",
          notes: [
            { contentType: "markdown", text: "The key reaction happens in chloroplasts." },
            { contentType: "flashcard", text: "Q: inputs? A: light, water, CO2" }
          ]
        }
      ]
    });
    expect(block).toContain("[1] Photosynthesis (article)");
    expect(block).toContain("Location: https://bio.example/photo");
    expect(block).toContain("Excerpt:\nLight into chemical energy.");
    expect(block).toContain("Notes:");
    expect(block).toContain("- (markdown) The key reaction happens in chloroplasts.");
    expect(block).toContain("- (flashcard) Q: inputs? A: light, water, CO2");
  });

  it("tolerates a source with no notes / no excerpt", () => {
    const block = attachmentsBlock({ sources: [{ title: "Bare" }] });
    expect(block).toContain("Attached: 1 source(s)");
    expect(block).toContain("[1] Bare");
    expect(block).not.toContain("Excerpt:");
    expect(block).not.toContain("Notes:");
  });
});

describe("contextPreamble (attachments fold ADDITIVELY)", () => {
  it("is byte-identical to the pre-W2 preamble at ZERO attachments", () => {
    // No `sources` key at all → the exact prior string.
    expect(contextPreamble(flatContext)).toBe(FLAT_PREAMBLE);
    // An explicitly empty sources[] is also a no-op (same string).
    expect(contextPreamble({ ...flatContext, sources: [] })).toBe(FLAT_PREAMBLE);
  });

  it("appends the attachments block AFTER the flat passage when sources are present", () => {
    const preamble = contextPreamble({
      ...flatContext,
      sources: [{ title: "Attached Doc", excerpt: "some text" }]
    });
    // The prior preamble is a strict PREFIX — the flat path is untouched, attachments append.
    expect(preamble.startsWith(FLAT_PREAMBLE)).toBe(true);
    expect(preamble).toContain("\n\nAttached: 1 source(s)");
    expect(preamble).toContain("[1] Attached Doc");
  });

  it("works with ONLY attachments (no flat passage)", () => {
    const preamble = contextPreamble({ sources: [{ title: "Only Doc", excerpt: "body" }] });
    expect(preamble).toBe("Attached: 1 source(s)\n\n[1] Only Doc\nExcerpt:\nbody");
  });
});
