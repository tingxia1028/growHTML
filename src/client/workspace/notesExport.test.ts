import { describe, expect, it } from "vitest";
import type { AnyAnchor, NoteRecord, SourceRecord } from "../data/entityClient";
import "../../core/notes/contentTypes"; // register builtin specs (toSearchText)
import { buildNotesExport, notesExportToMarkdown, safeExportFileName } from "./notesExport";

const source: Pick<SourceRecord, "id" | "title" | "sourceType"> = {
  id: "src_1",
  title: "Physics Ch. 3",
  sourceType: "pdf"
};

const anchorA: AnyAnchor = {
  id: "anchor_a",
  sourceId: "src_1",
  anchorKind: "pdf_selection",
  page: 4,
  quote: "  Force equals   mass times acceleration  ",
  contextBefore: "",
  contextAfter: ""
};

const note = (over: Partial<NoteRecord>): NoteRecord => ({
  id: "note_1",
  sourceId: "src_1",
  anchorIds: ["anchor_a"],
  conceptIds: [],
  contentType: "markdown",
  content: "Newton's second law.",
  visibility: "private",
  layerIds: [],
  ...over
});

describe("buildNotesExport", () => {
  const now = () => new Date("2026-07-04T00:00:00.000Z");

  it("pins the export envelope shape (app/kind/source/anchors/notes)", () => {
    const model = buildNotesExport(source, [anchorA], [note({})], now);
    expect(model).toMatchObject({
      app: "ai-study-vault",
      kind: "source-notes-export",
      exportedAt: "2026-07-04T00:00:00.000Z",
      source: { id: "src_1", title: "Physics Ch. 3", sourceType: "pdf" }
    });
    expect(model.anchors).toEqual([
      { id: "anchor_a", anchorKind: "pdf_selection", quote: anchorA.quote, page: 4, rect: undefined }
    ]);
    expect(model.notes).toHaveLength(1);
  });

  it("reduces content to readable text via the note type's toSearchText", () => {
    const model = buildNotesExport(
      source,
      [anchorA],
      [note({ contentType: "flashcard", content: { front: "Q?", back: "A!" } })],
      now
    );
    expect(model.notes[0].text).toBe("Q? A!");
    // The verbatim content is preserved (round-trippable).
    expect(model.notes[0].content).toEqual({ front: "Q?", back: "A!" });
  });

  it("carries note.display (D10 positions) verbatim, omitting it when absent", () => {
    const withDisplay = note({
      id: "note_pinned",
      display: { open: true, offset: { dx: 12, dy: -4 }, size: { w: 300, h: 180 } }
    });
    const plain = note({ id: "note_plain" });
    const model = buildNotesExport(source, [anchorA], [withDisplay, plain], now);
    expect(model.notes[0].display).toEqual({ open: true, offset: { dx: 12, dy: -4 }, size: { w: 300, h: 180 } });
    expect(model.notes[1].display).toBeUndefined();
  });

  it("drops a stray/partial display record to just its valid keys", () => {
    const model = buildNotesExport(
      source,
      [anchorA],
      // offset missing dy → dropped; only `open` survives.
      [note({ display: { open: false, offset: { dx: 5 } as unknown as { dx: number; dy: number } } })],
      now
    );
    expect(model.notes[0].display).toEqual({ open: false });
  });
});

describe("notesExportToMarkdown", () => {
  const now = () => new Date("2026-07-04T00:00:00.000Z");

  it("renders a heading per source, a section per anchor (quote), and flags pinned notes", () => {
    const model = buildNotesExport(
      source,
      [anchorA],
      [note({ display: { open: true } }), note({ id: "note_2", content: "Also see friction." })],
      now
    );
    const md = notesExportToMarkdown(model);
    expect(md).toContain("# Physics Ch. 3");
    // Quote is whitespace-collapsed into the section heading.
    expect(md).toContain("## Force equals mass times acceleration");
    expect(md).toContain("*Page 4*");
    expect(md).toContain("- **markdown** 📌"); // the pinned note carries the pin flag
    expect(md).toContain("Newton's second law.");
    expect(md).toContain("Also see friction.");
  });

  it("groups unanchored notes under their own section", () => {
    const model = buildNotesExport(
      source,
      [],
      [note({ id: "n_free", anchorIds: [], content: "A standalone thought." })],
      now
    );
    const md = notesExportToMarkdown(model);
    expect(md).toContain("## Unanchored notes");
    expect(md).toContain("A standalone thought.");
  });
});

describe("safeExportFileName", () => {
  it("strips path-hostile characters and falls back to 'notes'", () => {
    expect(safeExportFileName('Ch:3/Force<>?')).toBe("Ch_3_Force___");
    expect(safeExportFileName("   ")).toBe("notes");
    expect(safeExportFileName("")).toBe("notes");
  });
});
