import { describe, expect, it } from "vitest";
import {
  closePane,
  focusPane,
  focusedPane,
  openOrFocusPane,
  paneIdFor,
  prunePanes,
  sourceOfPane,
  type PanesState
} from "./panes";

const EMPTY: PanesState = { openPanes: [], focusedPaneId: "" };

describe("panes — pure open-panes model", () => {
  it("paneIdFor is deterministic (single-instance-per-source)", () => {
    expect(paneIdFor("s1")).toBe("pane:s1");
    expect(paneIdFor("s1")).toBe(paneIdFor("s1"));
  });

  it("openOrFocusPane opens a new pane + focuses it", () => {
    const next = openOrFocusPane(EMPTY, "s1");
    expect(next.openPanes).toHaveLength(1);
    expect(next.openPanes[0]).toEqual({ paneId: "pane:s1", sourceId: "s1", viewState: {} });
    expect(next.focusedPaneId).toBe("pane:s1");
  });

  it("openOrFocusPane DEDUPES the same source to a focus flip (no duplicate)", () => {
    const a = openOrFocusPane(EMPTY, "s1");
    const b = openOrFocusPane(a, "s2");
    expect(b.openPanes).toHaveLength(2);
    expect(b.focusedPaneId).toBe("pane:s2");
    // Re-open s1 → still two panes, just focus flips back.
    const c = openOrFocusPane(b, "s1");
    expect(c.openPanes).toHaveLength(2);
    expect(c.focusedPaneId).toBe("pane:s1");
  });

  it("openOrFocusPane is a no-op for an empty sourceId", () => {
    expect(openOrFocusPane(EMPTY, "")).toBe(EMPTY);
  });

  it("openOrFocusPane returns the same state when re-focusing the already-focused source", () => {
    const a = openOrFocusPane(EMPTY, "s1");
    expect(openOrFocusPane(a, "s1")).toBe(a);
  });

  it("focusPane flips focus among open panes; ignores stale ids", () => {
    const a = openOrFocusPane(openOrFocusPane(EMPTY, "s1"), "s2");
    const focused = focusPane(a, "pane:s1");
    expect(focused.focusedPaneId).toBe("pane:s1");
    expect(focused.openPanes).toBe(a.openPanes);
    // Unknown id → unchanged.
    expect(focusPane(a, "pane:nope")).toBe(a);
  });

  it("closePane removes a pane and flips focus to the neighbour", () => {
    const a = openOrFocusPane(openOrFocusPane(openOrFocusPane(EMPTY, "s1"), "s2"), "s3");
    // focus is s3; close the focused one → focus falls to the previous neighbour.
    const closed = closePane(a, "pane:s3");
    expect(closed.openPanes.map((p) => p.sourceId)).toEqual(["s1", "s2"]);
    expect(closed.focusedPaneId).toBe("pane:s2");
  });

  it("closePane keeps focus when a non-focused pane closes", () => {
    const a = openOrFocusPane(openOrFocusPane(EMPTY, "s1"), "s2"); // focus s2
    const closed = closePane(a, "pane:s1");
    expect(closed.openPanes.map((p) => p.sourceId)).toEqual(["s2"]);
    expect(closed.focusedPaneId).toBe("pane:s2");
  });

  it("closePane the last pane leaves an empty workspace", () => {
    const a = openOrFocusPane(EMPTY, "s1");
    const closed = closePane(a, "pane:s1");
    expect(closed.openPanes).toHaveLength(0);
    expect(closed.focusedPaneId).toBe("");
  });

  it("closePane a middle focused pane flips to the pane that took its slot", () => {
    let s = openOrFocusPane(EMPTY, "s1");
    s = openOrFocusPane(s, "s2");
    s = openOrFocusPane(s, "s3");
    s = focusPane(s, "pane:s2");
    const closed = closePane(s, "pane:s2");
    // s3 slides into index 1, taking focus.
    expect(closed.openPanes.map((p) => p.sourceId)).toEqual(["s1", "s3"]);
    expect(closed.focusedPaneId).toBe("pane:s3");
  });

  it("prunePanes drops panes whose source is gone (delta 4) and re-homes focus", () => {
    let s = openOrFocusPane(EMPTY, "s1");
    s = openOrFocusPane(s, "s2");
    s = openOrFocusPane(s, "s3"); // focus s3
    const pruned = prunePanes(s, new Set(["s1", "s2"]));
    expect(pruned.openPanes.map((p) => p.sourceId)).toEqual(["s1", "s2"]);
    // Focused pane (s3) was pruned → focus falls to the first surviving pane.
    expect(pruned.focusedPaneId).toBe("pane:s1");
  });

  it("prunePanes keeps focus when the focused pane survives", () => {
    let s = openOrFocusPane(EMPTY, "s1");
    s = openOrFocusPane(s, "s2");
    s = focusPane(s, "pane:s1");
    const pruned = prunePanes(s, new Set(["s1"]));
    expect(pruned.openPanes.map((p) => p.sourceId)).toEqual(["s1"]);
    expect(pruned.focusedPaneId).toBe("pane:s1");
  });

  it("prunePanes is a no-op when nothing is removed", () => {
    const s = openOrFocusPane(openOrFocusPane(EMPTY, "s1"), "s2");
    expect(prunePanes(s, new Set(["s1", "s2"]))).toBe(s);
  });

  it("prunePanes to nothing leaves an empty workspace", () => {
    const s = openOrFocusPane(EMPTY, "s1");
    const pruned = prunePanes(s, new Set<string>());
    expect(pruned.openPanes).toHaveLength(0);
    expect(pruned.focusedPaneId).toBe("");
  });

  it("focusedPane resolves the focused pane; falls back to the first on a stale id", () => {
    const s = openOrFocusPane(openOrFocusPane(EMPTY, "s1"), "s2");
    expect(focusedPane(s.openPanes, "pane:s2")?.sourceId).toBe("s2");
    // Stale focus id → first pane.
    expect(focusedPane(s.openPanes, "pane:gone")?.sourceId).toBe("s1");
    expect(focusedPane([], "")).toBeNull();
  });

  it("sourceOfPane inverts paneId → sourceId", () => {
    const s = openOrFocusPane(EMPTY, "s1");
    expect(sourceOfPane(s.openPanes, "pane:s1")).toBe("s1");
    expect(sourceOfPane(s.openPanes, "pane:missing")).toBe("");
  });

  // SHIM IDENTITY (the migration keystone): a single open pane ⇒ activeSourceId (the
  // derived focusedPane.sourceId) equals the old single `activeSourceId` value.
  it("SHIM IDENTITY: single pane ⇒ derived activeSourceId == the old single value", () => {
    const oldActiveSourceId = "s1";
    const s = openOrFocusPane(EMPTY, oldActiveSourceId);
    const derived = focusedPane(s.openPanes, s.focusedPaneId)?.sourceId ?? "";
    expect(derived).toBe(oldActiveSourceId);
  });
});
