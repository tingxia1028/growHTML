// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { AnyAnchor, NoteRecord, StudyLayerRecord } from "../data/entityClient";
import type { PaintAnchor } from "../surfaces/types";
import { BOOKMARK_CONTENT_TYPE } from "../../core/notes/contentTypes";
import { noteText } from "./WorkspaceContext";
import { renderAnnotationNotePreview } from "./annotationNotePreview";
import {
  buildPaintPipeline,
  enabledLayerIdsOf,
  notesForSource
} from "./paneSelectors";

// The pre-F1 inline mapping (copied VERBATIM from the WorkspaceContext memos as they were
// before extraction) — the regression lock compares buildPaintPipeline against THIS so any
// drift in the extracted pure builder fails the test.
function oldPipeline(
  visibleAnchors: AnyAnchor[],
  notes: NoteRecord[],
  sourceLayers: StudyLayerRecord[],
  enabledLayerIds: Set<string>
): { paintAnchors: PaintAnchor[]; revealAnchors: PaintAnchor[] } {
  const visibleNotes = notes.filter(
    (note) => note.layerIds.length === 0 || note.layerIds.some((id) => enabledLayerIds.has(id))
  );
  const notesByAnchorId = new Map<string, NoteRecord[]>();
  for (const note of visibleNotes) {
    if ((note.contentType ?? "markdown") === BOOKMARK_CONTENT_TYPE) continue;
    for (const anchorId of note.anchorIds) {
      notesByAnchorId.set(anchorId, [...(notesByAnchorId.get(anchorId) ?? []), note]);
    }
  }
  const bookmarked = new Set<string>();
  const hasRealNote = new Set<string>();
  for (const note of notes) {
    const isBookmark = (note.contentType ?? "markdown") === BOOKMARK_CONTENT_TYPE;
    for (const anchorId of note.anchorIds) (isBookmark ? bookmarked : hasRealNote).add(anchorId);
  }
  const bookmarkOnly = new Set<string>();
  for (const id of bookmarked) if (!hasRealNote.has(id)) bookmarkOnly.add(id);

  const map = (anchor: AnyAnchor): PaintAnchor => {
    const anchorNotes = notesByAnchorId.get(anchor.id) ?? [];
    return {
      id: anchor.id,
      anchorKind: anchor.anchorKind,
      quote: "quote" in anchor ? anchor.quote : undefined,
      contextBefore: "contextBefore" in anchor ? anchor.contextBefore : undefined,
      contextAfter: "contextAfter" in anchor ? anchor.contextAfter : undefined,
      studyId: "studyId" in anchor ? anchor.studyId : undefined,
      page: "page" in anchor ? anchor.page : undefined,
      rect: "rect" in anchor ? anchor.rect : undefined,
      note: anchorNotes.map((note) => noteText(note.content)).join("\n\n"),
      notePreviews: anchorNotes.map((note) => ({
        id: note.id,
        contentType: note.contentType ?? "markdown",
        text: noteText(note.content),
        html: renderAnnotationNotePreview(note, anchor, sourceLayers)
      }))
    };
  };
  return {
    paintAnchors: visibleAnchors.filter((a) => !bookmarkOnly.has(a.id)).map(map),
    revealAnchors: visibleAnchors.map(map)
  };
}

function htmlAnchor(id: string, sourceId: string, quote: string): AnyAnchor {
  return { id, sourceId, anchorKind: "html_selection", studyId: `sid-${id}`, selector: "p", quote };
}
function note(over: Partial<NoteRecord>): NoteRecord {
  return {
    id: "n",
    sourceId: "s1",
    anchorIds: [],
    conceptIds: [],
    layerIds: [],
    contentType: "markdown",
    content: "body",
    visibility: "private",
    ...over
  } as NoteRecord;
}

describe("paneSelectors — the extracted paint pipeline (regression lock)", () => {
  const layers: StudyLayerRecord[] = [];

  it("REGRESSION LOCK: buildPaintPipeline == the old inline paint/reveal mapping (byte-equal)", () => {
    const anchors = [htmlAnchor("a1", "s1", "First"), htmlAnchor("a2", "s1", "Second")];
    const notes = [note({ id: "n1", anchorIds: ["a1"], content: "note one" })];
    const enabled = new Set<string>();
    const got = buildPaintPipeline({ visibleAnchors: anchors, notes, sourceLayers: layers, enabledLayerIds: enabled });
    const old = oldPipeline(anchors, notes, layers, enabled);
    expect(got).toEqual(old);
  });

  it("REGRESSION LOCK holds with a bookmark-only anchor excluded from paint but kept in reveal", () => {
    const anchors = [htmlAnchor("a1", "s1", "Real"), htmlAnchor("bmk", "s1", "Bookmarked")];
    const notes = [
      note({ id: "n1", anchorIds: ["a1"], content: "real note" }),
      note({ id: "b1", anchorIds: ["bmk"], contentType: BOOKMARK_CONTENT_TYPE, content: { label: "x" } })
    ];
    const enabled = new Set<string>();
    const got = buildPaintPipeline({ visibleAnchors: anchors, notes, sourceLayers: layers, enabledLayerIds: enabled });
    const old = oldPipeline(anchors, notes, layers, enabled);
    expect(got).toEqual(old);
    // The bookmark-only anchor is absent from paint, present in reveal.
    expect(got.paintAnchors.map((p) => p.id)).toEqual(["a1"]);
    expect(got.revealAnchors.map((p) => p.id)).toEqual(["a1", "bmk"]);
  });

  it("CROSS-SOURCE: a shared note paints in notesForSource(A) AND notesForSource(B)", () => {
    // One note whose anchorIds span sources A and B (anchor a1 in A, b1 in B).
    const shared = note({ id: "shared", sourceId: "A", anchorIds: ["a1", "b1"], content: "shared" });
    // Source A's own bundle: its anchor a1 + the shared note (it references a1).
    const notesA = [shared];
    const anchorsA = [htmlAnchor("a1", "A", "Alpha passage")];
    // Source B's own bundle: its anchor b1 + the same shared note (it references b1).
    const notesB = [shared];
    const anchorsB = [htmlAnchor("b1", "B", "Beta passage")];
    const enabled = new Set<string>();

    const paintA = buildPaintPipeline({ visibleAnchors: anchorsA, notes: notesA, sourceLayers: layers, enabledLayerIds: enabled });
    const paintB = buildPaintPipeline({ visibleAnchors: anchorsB, notes: notesB, sourceLayers: layers, enabledLayerIds: enabled });

    // The shared note's text paints on A's anchor a1 AND on B's anchor b1 — cross-doc
    // painting is emergent from resolving paint per pane.
    expect(paintA.paintAnchors.find((p) => p.id === "a1")?.note).toBe("shared");
    expect(paintB.paintAnchors.find((p) => p.id === "b1")?.note).toBe("shared");
    // And notesForSource surfaces the shared note under both sources' note lists.
    expect(notesForSource(notesA, enabled).some((n) => n.id === "shared")).toBe(true);
    expect(notesForSource(notesB, enabled).some((n) => n.id === "shared")).toBe(true);
  });

  it("FOCUSED-PANE layer filter: a note in a disabled layer does not paint; enabling shows it", () => {
    const sourceLayers: StudyLayerRecord[] = [
      { id: "L1", enabled: false } as StudyLayerRecord
    ];
    const anchors = [htmlAnchor("a1", "s1", "Passage")];
    const notes = [note({ id: "n1", anchorIds: ["a1"], layerIds: ["L1"], content: "layered note" })];

    // Disabled → the note is filtered out → the anchor paints with empty note text.
    const disabled = buildPaintPipeline({
      visibleAnchors: anchors,
      notes,
      sourceLayers,
      enabledLayerIds: enabledLayerIdsOf(sourceLayers)
    });
    expect(disabled.paintAnchors.find((p) => p.id === "a1")?.note).toBe("");

    // Enable the layer → the note text paints.
    const enabledLayers: StudyLayerRecord[] = [{ id: "L1", enabled: true } as StudyLayerRecord];
    const enabled = buildPaintPipeline({
      visibleAnchors: anchors,
      notes,
      sourceLayers: enabledLayers,
      enabledLayerIds: enabledLayerIdsOf(enabledLayers)
    });
    expect(enabled.paintAnchors.find((p) => p.id === "a1")?.note).toBe("layered note");
  });

  it("notesForSource keeps a no-layer note always (never orphaned)", () => {
    const notes = [note({ id: "n1", layerIds: [] })];
    expect(notesForSource(notes, new Set<string>()).map((n) => n.id)).toEqual(["n1"]);
  });
});
