// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildForkTemplate } from "./operationViews";
import type { KitPrompt } from "../../kits/types";

// buildForkTemplate approximates a固化 built-in prompt's body as an EDITABLE template by
// running its build() with every known input replaced by its {{token}}. These unit tests
// pin the seeding output (the e2e covers only the happy path) — including the catch→""
// fallback for a built-in whose build() throws, which had no coverage.
describe("buildForkTemplate", () => {
  it("substitutes the well-known variables as {{tokens}} (normal fork)", () => {
    const prompt: KitPrompt = {
      id: "test.explain",
      outputType: "markdown",
      build: (input) => {
        const i = input as { anchorText?: string; sourceTitle?: string };
        return `Explain "${i.anchorText}" from ${i.sourceTitle}.`;
      }
    };
    expect(buildForkTemplate(prompt)).toBe('Explain "{{anchorText}}" from {{sourceTitle}}.');
  });

  it("substitutes declared params as {{tokens}} alongside the well-known ones", () => {
    const prompt: KitPrompt = {
      id: "test.explain-grade",
      outputType: "markdown",
      build: (input) => {
        const i = input as { anchorText?: string; grade?: string };
        return `For grade ${i.grade}: ${i.anchorText}`;
      },
      params: [{ name: "grade", label: "Grade", kind: "grade" }]
    };
    expect(buildForkTemplate(prompt)).toBe("For grade {{grade}}: {{anchorText}}");
  });

  it("produces only the well-known tokens when params is empty", () => {
    const prompt: KitPrompt = {
      id: "test.no-params",
      outputType: "markdown",
      build: (input) => `Notes: ${(input as { existingNotes?: string }).existingNotes}`,
      params: []
    };
    expect(buildForkTemplate(prompt)).toBe("Notes: {{existingNotes}}");
  });

  it("returns an empty string when build() throws (fallback path)", () => {
    const prompt: KitPrompt = {
      id: "test.broken",
      outputType: "markdown",
      build: () => {
        throw new Error("boom");
      }
    };
    expect(buildForkTemplate(prompt)).toBe("");
  });
});
