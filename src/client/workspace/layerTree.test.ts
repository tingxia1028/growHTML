import { describe, expect, it } from "vitest";
import {
  buildLayerTree,
  countNotesInLayers,
  coveredLayerIds,
  descendantLeafIds,
  parentToggleState,
  type LayerNode
} from "./layerTree";
import type { NoteRecord, StudyLayerRecord } from "../data/entityClient";

// Minimal layer/note factories — only the fields the helpers read.
const L = (id: string, over: Partial<StudyLayerRecord> = {}): StudyLayerRecord =>
  ({ id, title: id, visibility: "private", importMode: "owned", enabled: true, ...over }) as StudyLayerRecord;
const N = (layerIds: string[], contentType = "markdown"): NoteRecord =>
  ({ anchorIds: [], layerIds, contentType } as unknown as NoteRecord);

const byId = (nodes: LayerNode[]) => new Map(nodes.map((n) => [n.layer.id, n]));

describe("buildLayerTree", () => {
  it("nests children under their parentId; top-level layers are roots", () => {
    const roots = buildLayerTree([L("p"), L("a", { parentId: "p" }), L("b", { parentId: "p" }), L("top")]);
    expect(roots.map((n) => n.layer.id).sort()).toEqual(["p", "top"]);
    const p = byId(roots).get("p")!;
    expect(p.children.map((c) => c.layer.id)).toEqual(["a", "b"]);
  });

  it("treats a parentId pointing outside the set as a root (never drops the layer)", () => {
    const roots = buildLayerTree([L("a", { parentId: "ghost" })]);
    expect(roots.map((n) => n.layer.id)).toEqual(["a"]);
  });

  it("breaks a parent cycle instead of looping", () => {
    const roots = buildLayerTree([L("a", { parentId: "b" }), L("b", { parentId: "a" })]);
    // One of them becomes a root; the other nests — but no infinite loop, all present.
    const ids = roots.flatMap(function collect(n): string[] {
      return [n.layer.id, ...n.children.flatMap(collect)];
    });
    expect(ids.sort()).toEqual(["a", "b"]);
  });
});

describe("descendantLeafIds", () => {
  it("returns the covered layer ids: parent itself plus descendants", () => {
    const [p] = buildLayerTree([L("p"), L("a", { parentId: "p" }), L("b", { parentId: "p" })]);
    expect(coveredLayerIds(p).sort()).toEqual(["a", "b", "p"]);
    expect(descendantLeafIds(p).sort()).toEqual(["a", "b", "p"]);
    expect(descendantLeafIds(p.children[0])).toEqual(["a"]);
  });
});

describe("parentToggleState", () => {
  const [p] = buildLayerTree([L("p"), L("a", { parentId: "p" }), L("b", { parentId: "p" })]);
  it("on when all covered layers are enabled, off when none, mixed otherwise", () => {
    expect(parentToggleState(p, new Set(["p", "a", "b"]))).toBe("on");
    expect(parentToggleState(p, new Set())).toBe("off");
    expect(parentToggleState(p, new Set(["a"]))).toBe("mixed");
  });
});

describe("countNotesInLayers", () => {
  it("counts DISTINCT non-bookmark notes whose membership intersects the layer set", () => {
    const notes = [N(["a"]), N(["a", "b"]), N(["b"]), N(["c"]), N(["a"], "bookmark")];
    // Roll-up over {a,b}: notes 1,2,3 (note 2 counted once; bookmark excluded; c outside).
    expect(countNotesInLayers(notes, ["a", "b"], "bookmark")).toBe(3);
    expect(countNotesInLayers(notes, ["c"], "bookmark")).toBe(1);
    expect(countNotesInLayers(notes, new Set(["a"]), "bookmark")).toBe(2);
  });
});
