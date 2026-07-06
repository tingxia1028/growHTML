// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { AnyAnchor, NoteRecord, StudyLayerRecord } from "../data/entityClient";
import "../notes/builtinNoteTypes";
import "../../kits/clientKits";
import { renderAnnotationNotePreview } from "./annotationNotePreview";

const anchor = {
  id: "a1",
  sourceId: "s1",
  anchorKind: "pdf_selection",
  page: 25,
  quote: "write the number"
} as AnyAnchor;

const layers = [{ id: "L1", title: "My Notes", enabled: true } as StudyLayerRecord];

function note(overrides: Partial<NoteRecord>): NoteRecord {
  return {
    id: "n1",
    sourceId: "s1",
    anchorIds: ["a1"],
    conceptIds: [],
    contentType: "markdown",
    content: "plain note",
    visibility: "private",
    layerIds: ["L1"],
    ...overrides
  };
}

describe("renderAnnotationNotePreview", () => {
  it("wraps the reader preview body in a compact typed mini-card", () => {
    const html = renderAnnotationNotePreview(note({ content: "## Pressure\nbody" }), anchor, layers);
    document.body.innerHTML = html;

    expect(document.querySelector(".sv-annotation-preview-card")).toBeTruthy();
    expect(document.querySelector(".sv-annotation-preview-head")?.textContent).toContain("Markdown");
    expect(document.querySelector(".sv-annotation-preview-chip")).toBeNull();
    expect(document.querySelector(".sv-annotation-preview-head")?.textContent).not.toContain("My Notes");
    expect(document.querySelector(".sv-note-content .note-rendered")?.textContent).toContain("Pressure");
  });

  it("keeps kit note card rendering while adding type chrome", () => {
    const html = renderAnnotationNotePreview(
      note({
        contentType: "textbook.exercise",
        content: {
          question: "1053600",
          type: "single-choice",
          answer: "A",
          explanation: "place value",
          difficulty: "medium"
        }
      }),
      anchor,
      layers
    );

    document.body.innerHTML = html;
    expect(document.querySelector(".sv-annotation-preview-head")?.textContent).toContain("Practice");
    expect(document.querySelector(".sv-annotation-preview-chip")).toBeNull();
    expect(document.querySelector(".sv-annotation-preview-head")?.textContent).not.toContain("medium");
    expect(document.querySelector(".tb-exercise-preview")?.textContent).toContain("1053600");
    expect(html).not.toContain("<textarea");
  });
});
