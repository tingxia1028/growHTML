// Unit coverage for the Anchor Focus board PURE model (N6 / D12). The two layouts +
// the filters are asserted in isolation (no React), the same way noteCards.test.ts guards
// the note-list exclusion. The component test (AnchorFocusBoard.test.tsx) then proves the
// wiring; here we prove the transforms.
import { describe, expect, it } from "vitest";
import type { AnyAnchor, NoteRecord, StudyLayerRecord } from "../data/entityClient";
import { BOOKMARK_CONTENT_TYPE } from "../../core/notes/contentTypes";
import {
  boardNotesFrom,
  boardStageColumns,
  buildAnchorRows,
  buildLayerColumns,
  noteMatchesQuery,
  UNLAYERED_COLUMN_ID
} from "./anchorBoardModel";

function anchor(id: string, quote: string): AnyAnchor {
  return { id, anchorKind: "html_selection", quote } as unknown as AnyAnchor;
}

function note(id: string, anchorIds: string[], layerIds: string[], content: unknown, contentType = "markdown"): NoteRecord {
  return { id, anchorIds, conceptIds: [], layerIds, content, contentType, visibility: "private" } as unknown as NoteRecord;
}

function layer(id: string, title: string, order: number, enabled = true, color?: string): StudyLayerRecord {
  return { id, title, order, enabled, color, importMode: "owned", visibility: "private" } as unknown as StudyLayerRecord;
}

function byAnchor(notes: NoteRecord[]): Map<string, NoteRecord[]> {
  const map = new Map<string, NoteRecord[]>();
  for (const n of notes) for (const a of n.anchorIds) map.set(a, [...(map.get(a) ?? []), n]);
  return map;
}

describe("boardNotesFrom", () => {
  it("excludes bookmarks (markers, not content cards)", () => {
    const kept = boardNotesFrom([
      note("n1", ["a1"], [], "keep"),
      note("b1", ["a1"], [], { label: "x" }, BOOKMARK_CONTENT_TYPE)
    ]);
    expect(kept.map((n) => n.id)).toEqual(["n1"]);
  });
});

describe("layout A — buildAnchorRows (document order)", () => {
  const anchors = [anchor("a1", "First passage"), anchor("a2", "Second passage"), anchor("a3", "Third")];
  const notes = [note("n1", ["a1"], [], "note one"), note("n2", ["a2"], [], "note two")];

  it("renders anchors in document order, each with its notes", () => {
    const rows = buildAnchorRows(anchors, byAnchor(notes));
    expect(rows.map((r) => r.anchor.id)).toEqual(["a1", "a2", "a3"]);
    expect(rows[0].quote).toBe("First passage");
    expect(rows[0].notes.map((e) => e.note.id)).toEqual(["n1"]);
    expect(rows[1].notes.map((e) => e.note.id)).toEqual(["n2"]);
    expect(rows[2].notes).toHaveLength(0); // an anchor with no notes still shows its passage
  });

  it("search narrows the notes within a row (matching content or quote)", () => {
    const rows = buildAnchorRows(anchors, byAnchor(notes), { query: "note two" });
    expect(rows.find((r) => r.anchor.id === "a1")!.notes).toHaveLength(0);
    expect(rows.find((r) => r.anchor.id === "a2")!.notes.map((e) => e.note.id)).toEqual(["n2"]);
  });

  it("hideEmpty drops anchors with no surviving notes", () => {
    const rows = buildAnchorRows(anchors, byAnchor(notes), { query: "note one", hideEmpty: true });
    expect(rows.map((r) => r.anchor.id)).toEqual(["a1"]);
  });
});

describe("layout B — buildLayerColumns (stage-layer buckets)", () => {
  const layers = [layer("L2", "学习", 2, true, "#0a0"), layer("L1", "预习", 1, true, "#00a")];
  const notes = [
    note("n1", ["a1"], ["L1"], "preview note"),
    note("n2", ["a1"], ["L2"], "study note"),
    note("n3", ["a1"], ["L1", "L2"], "both note"),
    note("n4", ["a1"], [], "orphan note")
  ];

  it("columns are DATA-DRIVEN from the source's enabled layers, ordered by `order`", () => {
    const cols = boardStageColumns(layers);
    expect(cols.map((c) => c.title)).toEqual(["预习", "学习"]); // order 1, then 2 — never hardcoded
  });

  it("buckets notes by layerId; a multi-layer note lands in every column it belongs to", () => {
    const cols = buildLayerColumns(notes, boardStageColumns(layers), { unlayeredTitle: "未分层" });
    const preview = cols.find((c) => c.id === "L1")!;
    const study = cols.find((c) => c.id === "L2")!;
    expect(preview.notes.map((e) => e.note.id)).toEqual(["n1", "n3"]);
    expect(study.notes.map((e) => e.note.id)).toEqual(["n2", "n3"]);
  });

  it("a note in no enabled column falls into the trailing 未分层 bucket (never lost)", () => {
    const cols = buildLayerColumns(notes, boardStageColumns(layers), { unlayeredTitle: "未分层" });
    const unlayered = cols.find((c) => c.id === UNLAYERED_COLUMN_ID)!;
    expect(unlayered.title).toBe("未分层");
    expect(unlayered.notes.map((e) => e.note.id)).toEqual(["n4"]);
  });

  it("only ENABLED layers become columns (只看当前Layer / Lens)", () => {
    const withDisabled = [...layers, layer("L3", "拓展", 3, false)];
    const cols = boardStageColumns(withDisabled);
    expect(cols.map((c) => c.id)).toEqual(["L1", "L2"]); // L3 disabled → no column
  });

  it("search narrows notes inside every column", () => {
    const cols = buildLayerColumns(notes, boardStageColumns(layers), { query: "study", unlayeredTitle: "未分层" });
    expect(cols.find((c) => c.id === "L1")!.notes.map((e) => e.note.id)).toEqual([]);
    expect(cols.find((c) => c.id === "L2")!.notes.map((e) => e.note.id)).toEqual(["n2"]);
  });
});

describe("noteMatchesQuery", () => {
  it("empty query matches everything", () => {
    expect(noteMatchesQuery({ note: note("n", [], [], "x"), haystack: "x" }, "  ")).toBe(true);
  });
  it("is case-insensitive over the haystack", () => {
    expect(noteMatchesQuery({ note: note("n", [], [], "x"), haystack: "hello world" }, "WORLD")).toBe(true);
  });
});
