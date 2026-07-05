// commandEntries (SEARCH-1) — the STATIC NAV_COMMANDS palette list. V1 derivation is a
// plain function, so a focused unit test pins the launch entries a core view relies on to
// surface in Cmd+K. mistake.book left the rail (SHELL-4 "rail 只留4项") and is now reached
// ONLY through this palette entry (the report.list / bookmark.list core precedent — a CORE
// view has no kit commands.ts, so its NAV_COMMANDS entry IS the full launch pattern). The
// navigateShell edge is mocked (the reviewPush.test / teachback launch.test idiom).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigateShell = vi.hoisted(() => vi.fn(() => true));
vi.mock("../workspace/shellNav", () => ({ navigateShell }));

import { searchCommandEntries } from "./commandEntries";

beforeEach(() => navigateShell.mockClear());
afterEach(() => vi.clearAllMocks());

describe("commandEntries — the 错题本 (mistake.book) launch", () => {
  it("surfaces an open:mistake.book command that deep-links the pane on run()", () => {
    const entry = searchCommandEntries().find((e) => e.id === "open:mistake.book");
    expect(entry, "mistake.book command missing from the STATIC palette list").toBeTruthy();
    // A pane target (not a modal) — the switchable left slot, like review.panel/report.list.
    expect(entry!.target).toEqual({ type: "pane", kind: "mistake.book" });
    // aliases include 错题本/错题 so the palette matches natural zh queries.
    expect(entry!.aliases).toContain("错题本");
    expect(entry!.run()).toBe(true);
    expect(navigateShell).toHaveBeenCalledWith({ type: "pane", kind: "mistake.book" });
  });
});
