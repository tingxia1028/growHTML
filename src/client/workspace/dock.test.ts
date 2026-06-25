import { describe, expect, it } from "vitest";
import {
  childInitialPx,
  clampDockPx,
  dockLeafIds,
  dockRoot,
  flexFor,
  gutterTarget,
  isCollapsibleLeaf,
  isFlexChild,
  isPaneCollapsed,
  leaf,
  paneLabel,
  RESPONSIVE_BREAKPOINT_PX,
  split,
  type DockChild
} from "./dock";
import { studentLearningLayout } from "./presets";

describe("dock model", () => {
  it("dockLeafIds returns leaves depth-first, left→right (incl. nested splits)", () => {
    const tree = split("row", [
      { size: 300, node: leaf("a") },
      { size: "flex", node: split("column", [{ node: leaf("b") }, { size: 200, node: leaf("c") }]) },
      { size: 380, node: leaf("d") }
    ]);
    expect(dockLeafIds(tree)).toEqual(["a", "b", "c", "d"]);
  });

  it("isFlexChild: 'flex' and unset are flexible, a number is fixed", () => {
    expect(isFlexChild({ size: "flex", node: leaf("x") })).toBe(true);
    expect(isFlexChild({ node: leaf("x") })).toBe(true);
    expect(isFlexChild({ size: 300, node: leaf("x") })).toBe(false);
  });

  it("flexFor: fixed → basis px, flex → grow/absorb", () => {
    expect(flexFor({ size: 300, node: leaf("x") }, 300)).toBe("0 0 300px");
    expect(flexFor({ size: "flex", node: leaf("x") }, 0)).toBe("1 1 0");
  });

  it("childInitialPx returns the px size, falling back for flex children", () => {
    expect(childInitialPx({ size: 250, node: leaf("x") })).toBe(250);
    expect(childInitialPx({ size: "flex", node: leaf("x") })).toBe(320);
  });

  it("clampDockPx clamps to [200, 760]", () => {
    expect(clampDockPx(50)).toBe(200);
    expect(clampDockPx(900)).toBe(760);
    expect(clampDockPx(400)).toBe(400);
  });

  describe("gutterTarget", () => {
    const fixed = (id: string): DockChild => ({ size: 300, node: leaf(id) });
    const flex = (id: string): DockChild => ({ size: "flex", node: leaf(id) });

    it("fixed | flex → resize the left fixed pane, grow on drag-right/down", () => {
      expect(gutterTarget([fixed("a"), flex("b")], 0)).toEqual({ childIndex: 0, sign: 1 });
    });
    it("flex | fixed → resize the right fixed pane, shrink on drag-right/down", () => {
      expect(gutterTarget([flex("a"), fixed("b")], 0)).toEqual({ childIndex: 1, sign: -1 });
    });
    it("fixed | fixed → resize the right pane", () => {
      expect(gutterTarget([fixed("a"), fixed("b")], 0)).toEqual({ childIndex: 1, sign: -1 });
    });
    it("flex | flex → no handle (nothing fixed to resize)", () => {
      expect(gutterTarget([flex("a"), flex("b")], 0)).toBeNull();
    });
  });
});

describe("dock collapse + responsiveness", () => {
  const fixedLeaf: DockChild = { size: 300, node: leaf("x") };
  const flexLeaf: DockChild = { size: "flex", node: leaf("x") };

  describe("isCollapsibleLeaf", () => {
    it("a fixed-size leaf is collapsible", () => {
      expect(isCollapsibleLeaf(fixedLeaf, "library")).toBe(true);
    });
    it("the flex reader child is never collapsible", () => {
      expect(isCollapsibleLeaf(flexLeaf, "source.viewer")).toBe(false);
    });
    it("a fixed source.viewer is still excluded (reader is the spine)", () => {
      expect(isCollapsibleLeaf(fixedLeaf, "source.viewer")).toBe(false);
    });
    it("a nested split (non-leaf) is not collapsible", () => {
      const splitChild: DockChild = { size: 300, node: split("column", [{ node: leaf("a") }]) };
      expect(isCollapsibleLeaf(splitChild, "")).toBe(false);
    });
  });

  describe("isPaneCollapsed", () => {
    const wide = RESPONSIVE_BREAKPOINT_PX; // exactly at the breakpoint = still expanded (< is the rule)
    const narrow = RESPONSIVE_BREAKPOINT_PX - 1;

    it("an explicit user toggle collapses regardless of width", () => {
      expect(isPaneCollapsed("study", true, 2000)).toBe(true);
    });
    it("a secondary pane auto-collapses below the breakpoint", () => {
      expect(isPaneCollapsed("library", false, narrow)).toBe(true);
      expect(isPaneCollapsed("concept.list", false, narrow)).toBe(true);
      expect(isPaneCollapsed("layer.switcher", false, narrow)).toBe(true);
    });
    it("a secondary pane stays expanded at/above the breakpoint", () => {
      expect(isPaneCollapsed("library", false, wide)).toBe(false);
      expect(isPaneCollapsed("library", false, 1920)).toBe(false);
    });
    it("a non-secondary pane (study) does NOT auto-collapse when narrow", () => {
      expect(isPaneCollapsed("study", false, narrow)).toBe(false);
    });
  });

  describe("paneLabel", () => {
    it("maps known kinds to friendly labels", () => {
      expect(paneLabel({ id: "library", kind: "library" })).toBe("Sources");
      expect(paneLabel({ id: "p", kind: "practice" })).toBe("Practice");
    });
    it("prefers an explicit params.title", () => {
      expect(paneLabel({ id: "x", kind: "library", params: { title: "My Files" } })).toBe("My Files");
    });
    it("falls back to the raw kind for an unknown pane", () => {
      expect(paneLabel({ id: "x", kind: "mystery.pane" })).toBe("mystery.pane");
    });
  });

  it("the student layout's dock tree exposes the bottom Practice panel", () => {
    // nav | (reader / practice) | study — practice is the nested column split's lower leaf.
    expect(dockLeafIds(dockRoot(studentLearningLayout))).toEqual([
      "library",
      "source-viewer",
      "practice",
      "study"
    ]);
  });
});
