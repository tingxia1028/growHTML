import { describe, expect, it } from "vitest";
import { groupActions, ACTION_GROUP_ORDER, OTHER_GROUP } from "./actionGroups";
import type { ToolbarAction } from "./WorkspaceContext";

// A terse ToolbarAction factory — only the fields groupActions reads matter here.
function action(id: string, group?: string): ToolbarAction {
  return { id, title: id, group, kind: "builtin", scope: "anchor" };
}

describe("groupActions", () => {
  it("emits non-empty buckets in the fixed canonical order", () => {
    // Feed them out of order; output must follow ACTION_GROUP_ORDER.
    const items = [
      action("op1", "Custom Actions"),
      action("ai1", "AI Actions"),
      action("bm", "Create Note"),
      action("study1", "Study Actions")
    ];
    const groups = groupActions(items);
    expect(groups.map((g) => g.group)).toEqual([...ACTION_GROUP_ORDER]);
  });

  it("routes an unknown / missing group into the trailing Other bucket", () => {
    const items = [action("bm", "Create Note"), action("weird", "Nonsense"), action("nogroup")];
    const groups = groupActions(items);
    expect(groups.map((g) => g.group)).toEqual(["Create Note", OTHER_GROUP]);
    const other = groups.find((g) => g.group === OTHER_GROUP)!;
    expect(other.items.map((i) => i.id)).toEqual(["weird", "nogroup"]);
  });

  it("omits empty buckets", () => {
    const groups = groupActions([action("ai1", "AI Actions")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].group).toBe("AI Actions");
  });

  it("preserves incoming item order within a bucket", () => {
    const items = [action("a", "AI Actions"), action("b", "AI Actions"), action("c", "AI Actions")];
    const groups = groupActions(items);
    expect(groups[0].items.map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("returns an empty array for no items", () => {
    expect(groupActions([])).toEqual([]);
  });
});
