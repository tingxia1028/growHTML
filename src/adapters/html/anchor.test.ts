import { describe, expect, it } from "vitest";
import type { HtmlSelectionAnchor, PatchRecord } from "../../core/schema";
import { fixtureAnchor, fixtureHtmlBody, fixturePatch } from "../../core/fixtures/golden";
import { applyHtmlPatchWithGuard, createHtmlSelectionAnchor, resolveHtmlAnchor } from "./anchor";

const htmlAnchor = fixtureAnchor as HtmlSelectionAnchor;

function patch(overrides: Partial<PatchRecord>): PatchRecord {
  return {
    ...fixturePatch,
    ...overrides
  };
}

describe("HTML anchor resolver", () => {
  it("creates schema-valid HTML selection anchors", () => {
    const anchor = createHtmlSelectionAnchor({
      sourceId: fixtureAnchor.sourceId,
      studyId: "p-render-thread",
      quote: "Render Thread submits rendering commands.",
      createdAt: "2026-06-23T00:00:00.000Z"
    });

    expect(anchor.anchorKind).toBe("html_selection");
    expect(anchor.selector).toBe('[data-study-id="p-render-thread"]');
  });

  it("resolves by study id first", () => {
    const result = resolveHtmlAnchor(fixtureHtmlBody, htmlAnchor);

    expect(result).toMatchObject({ ok: true, matchedBy: "studyId" });
    if (result.ok) {
      expect(result.text).toBe("Render Thread submits rendering commands.");
    }
  });

  it("falls back to selector when study id changes", () => {
    const anchor = {
      ...htmlAnchor,
      studyId: "missing",
      selector: "section > p"
    };

    expect(resolveHtmlAnchor(fixtureHtmlBody, anchor)).toMatchObject({ ok: true, matchedBy: "selector" });
  });

  it("falls back to quote when ids and selector drift", () => {
    const anchor = {
      ...htmlAnchor,
      studyId: "missing",
      selector: "[data-study-id=\"missing\"]"
    };

    expect(resolveHtmlAnchor(fixtureHtmlBody, anchor)).toMatchObject({ ok: true, matchedBy: "quote" });
  });

  it("applies a patch when expected text matches", () => {
    const result = applyHtmlPatchWithGuard(fixtureHtmlBody, htmlAnchor, {
      ...fixturePatch,
      status: "applied"
    });

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Render Thread prepares GPU-facing rendering commands.");
  });

  it("returns conflict without mutation when expected text drifts", () => {
    const result = applyHtmlPatchWithGuard(
      fixtureHtmlBody,
      htmlAnchor,
      patch({
        status: "applied",
        oldText: "This text is gone."
      })
    );

    expect(result).toMatchObject({
      kind: "conflict",
      ok: false,
      conflict: true,
      reason: "text_mismatch",
      content: fixtureHtmlBody
    });
  });

  it("returns conflict when the anchor cannot be resolved", () => {
    const result = applyHtmlPatchWithGuard(
      "<main><p>Different text.</p></main>",
      {
        ...htmlAnchor,
        studyId: "missing",
        selector: "[data-study-id=\"missing\"]",
        quote: "Gone"
      },
      fixturePatch
    );

    expect(result).toMatchObject({
      kind: "conflict",
      ok: false,
      reason: "anchor_not_found"
    });
  });
});

