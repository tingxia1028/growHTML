// Shell nav bus (SHELL-1/2) — the module-scope navigator seam: registered handler
// receives targets, unregistered bus reports false (standalone mounts never throw).

import { afterEach, describe, expect, it, vi } from "vitest";
import { navigateShell, registerShellNavigator, type ShellNavTarget } from "./shellNav";

afterEach(() => {
  registerShellNavigator(null);
});

describe("shellNav", () => {
  it("delivers targets to the registered navigator and reports true", () => {
    const seen: ShellNavTarget[] = [];
    registerShellNavigator((target) => seen.push(target));

    expect(navigateShell({ type: "pane", kind: "settings.hub" })).toBe(true);
    expect(navigateShell({ type: "onboarding", open: true })).toBe(true);
    expect(seen).toEqual([
      { type: "pane", kind: "settings.hub" },
      { type: "onboarding", open: true }
    ]);
  });

  it("reports false (and never throws) when no shell is listening", () => {
    expect(navigateShell({ type: "pane", kind: "library" })).toBe(false);
  });

  it("last registration wins; null unregisters", () => {
    const first = vi.fn();
    const second = vi.fn();
    registerShellNavigator(first);
    registerShellNavigator(second);
    navigateShell({ type: "pane", kind: "review.panel" });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);

    registerShellNavigator(null);
    expect(navigateShell({ type: "pane", kind: "review.panel" })).toBe(false);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
