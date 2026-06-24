import { describe, expect, it } from "vitest";
import type { HtmlSelectionAnchor, PatchRecord } from "../../core/schema";
import { fixtureAnchor, fixtureHtmlBody, fixturePatch, fixtureTimestamp } from "../../core/fixtures/golden";
import { applyHtmlPatch, injectStudyIds, materializeHtml } from "./core";

const htmlFixtureAnchor = fixtureAnchor as HtmlSelectionAnchor;

function patch(overrides: Partial<PatchRecord>): PatchRecord {
  return {
    ...fixturePatch,
    id: overrides.id ?? fixturePatch.id,
    updatedAt: fixtureTimestamp,
    ...overrides
  };
}

function anchor(overrides: Partial<HtmlSelectionAnchor>): HtmlSelectionAnchor {
  return {
    ...htmlFixtureAnchor,
    ...overrides
  };
}

const sectionAnchor = anchor({
  studyId: "sec-render-thread",
  selector: '[data-study-id="sec-render-thread"]',
  quote: "Render Thread"
});

describe("HTML core adapter", () => {
  it("injects data-study-id attributes idempotently without changing tagged elements", () => {
    const input = `<article><section data-study-id="existing-section"><h1>Render Thread</h1><p>Commands are submitted.</p></section></article>`;

    const first = injectStudyIds(input);
    const second = injectStudyIds(first.content);

    expect(first.added).toBe(3);
    expect(first.ids).toEqual(["study-1", "study-2", "study-3"]);
    expect(first.content).toContain('<section data-study-id="existing-section">');
    expect(first.content).toContain('<article data-study-id="study-1">');
    expect(first.content).toContain('<h1 data-study-id="study-2">Render Thread</h1>');
    expect(first.content).toContain('<p data-study-id="study-3">Commands are submitted.</p>');
    expect(second.added).toBe(0);
    expect(second.content).toBe(first.content);
  });

  it("replaces the selected element", () => {
    const result = applyHtmlPatch(fixtureHtmlBody, htmlFixtureAnchor, fixturePatch);

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Render Thread prepares GPU-facing rendering commands.");
    expect(result.content).not.toContain("Render Thread submits rendering commands.");
  });

  it("inserts content before and after the selected element", () => {
    const before = applyHtmlPatch(
      fixtureHtmlBody,
      htmlFixtureAnchor,
      patch({
        action: "insert_before_selection",
        newContent: '<p data-study-id="p-before">Before the selection.</p>'
      })
    );
    const after = applyHtmlPatch(
      fixtureHtmlBody,
      htmlFixtureAnchor,
      patch({
        action: "insert_after_selection",
        newContent: '<p data-study-id="p-after">After the selection.</p>'
      })
    );

    expect(before.ok).toBe(true);
    expect(before.content.indexOf("Before the selection.")).toBeLessThan(
      before.content.indexOf("Render Thread submits rendering commands.")
    );
    expect(after.ok).toBe(true);
    expect(after.content.indexOf("After the selection.")).toBeGreaterThan(
      after.content.indexOf("Render Thread submits rendering commands.")
    );
  });

  it("appends content to the selected section", () => {
    const result = applyHtmlPatch(
      fixtureHtmlBody,
      sectionAnchor,
      patch({
        action: "append_to_section",
        newContent: '<p data-study-id="p-extra">Extra render-thread detail.</p>'
      })
    );

    expect(result.ok).toBe(true);
    expect(result.content).toContain('<p data-study-id="p-extra">Extra render-thread detail.</p>');
    expect(result.content.indexOf("Extra render-thread detail.")).toBeGreaterThan(
      result.content.indexOf("Render Thread submits rendering commands.")
    );
    expect(result.content.indexOf("Extra render-thread detail.")).toBeLessThan(
      result.content.indexOf("</section>")
    );
  });

  it("rewrites the selected section", () => {
    const result = applyHtmlPatch(
      fixtureHtmlBody,
      sectionAnchor,
      patch({
        action: "rewrite_section",
        newContent:
          '<section data-study-id="sec-render-thread"><h1>Render Thread Updated</h1><p data-study-id="p-render-thread">Updated body.</p></section>'
      })
    );

    expect(result.ok).toBe(true);
    expect(result.content).toContain("<h1>Render Thread Updated</h1>");
    expect(result.content).toContain("Updated body.");
    expect(result.content).not.toContain("Render Thread submits rendering commands.");
  });

  it("materializes applied patches in order and skips pending patches", () => {
    const pendingInsert = patch({
      id: "patch_01ARZ3NDEKTSV4RRFFQ69G5FB1",
      action: "insert_after_selection",
      status: "pending",
      newContent: '<p data-study-id="p-pending">Pending detail.</p>'
    });
    const appliedReplace = patch({
      id: "patch_01ARZ3NDEKTSV4RRFFQ69G5FB2",
      status: "applied",
      newContent: '<p data-study-id="p-render-thread">Applied replacement.</p>'
    });

    const result = materializeHtml(
      fixtureHtmlBody,
      { [htmlFixtureAnchor.id]: htmlFixtureAnchor },
      [pendingInsert, appliedReplace]
    );

    expect(result.content).toContain("Applied replacement.");
    expect(result.content).not.toContain("Pending detail.");
    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toMatchObject({ kind: "skipped", patchId: pendingInsert.id, status: "pending" });
    expect(result.results[1]).toMatchObject({ kind: "applied", patchId: appliedReplace.id });
  });

  it("returns a typed failure when the target cannot be found", () => {
    const result = applyHtmlPatch(
      fixtureHtmlBody,
      anchor({
        studyId: "missing-study-id",
        selector: '[data-study-id="missing-study-id"]'
      }),
      fixturePatch
    );

    expect(result).toMatchObject({
      kind: "failed",
      ok: false,
      reason: "target_not_found",
      content: fixtureHtmlBody
    });
  });

  it("returns a typed failure for unsupported HTML patch actions", () => {
    const result = applyHtmlPatch(
      fixtureHtmlBody,
      htmlFixtureAnchor,
      patch({
        action: "add_annotation",
        newContent: "Annotation-only patches are not HTML mutations."
      })
    );

    expect(result).toMatchObject({
      kind: "failed",
      ok: false,
      reason: "unsupported_action",
      content: fixtureHtmlBody
    });
  });
});
