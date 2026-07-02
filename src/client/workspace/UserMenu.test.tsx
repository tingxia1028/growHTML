// @vitest-environment jsdom
// UserMenu (SHELL-1) — the bottom-left identity button + popover: identity fallback
// (本地用户) vs the Tier-A svpack name, every entry present, the aggregation clicks
// dispatching the right shell-nav targets, the disabled 账户/积分 stub with its
// honest tooltip, 帮助/新手引导 reopening onboarding, Esc + outside-mousedown close.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { UserMenu } from "./UserMenu";
import { setUserMenuIoForTests } from "./userMenuIo";
import { registerShellNavigator, type ShellNavTarget } from "./shellNav";

let container: HTMLDivElement;
let root: Root;
let targets: ShellNavTarget[];

beforeEach(() => {
  targets = [];
  registerShellNavigator((target) => targets.push(target));
  setUserMenuIoForTests({
    fetchIdentity: async () => ({ identity: null }),
    fetchAbout: async () => ({ app: "ai-study-vault", version: "0.1.0" })
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  setUserMenuIoForTests(null);
  registerShellNavigator(null);
});

async function renderMenu() {
  await act(async () => {
    root.render(<UserMenu />);
  });
}

async function openMenu() {
  await act(async () => {
    container.querySelector<HTMLButtonElement>(".shell-menu-trigger")!.click();
  });
}

describe("UserMenu", () => {
  it("falls back to 本地用户 when no svpack identity exists (and when the read fails)", async () => {
    await renderMenu();
    expect(container.querySelector(".shell-menu-avatar-label")!.textContent).toBe("本地用户");

    // A failing endpoint (degraded transport) keeps the same fallback.
    setUserMenuIoForTests({
      fetchIdentity: async () => {
        throw new Error("offline");
      },
      fetchAbout: async () => {
        throw new Error("offline");
      }
    });
    act(() => root.unmount());
    root = createRoot(container);
    await renderMenu();
    expect(container.querySelector(".shell-menu-avatar-label")!.textContent).toBe("本地用户");
  });

  it("shows the Tier-A identity display name + id when one exists", async () => {
    setUserMenuIoForTests({
      fetchIdentity: async () => ({ identity: { id: "pubf_a7k2qf3z", displayName: "王老师 · 高一物理" } }),
      fetchAbout: async () => ({ app: "ai-study-vault", version: "0.1.0" })
    });
    act(() => root.unmount());
    root = createRoot(container);
    await renderMenu();

    expect(container.querySelector(".shell-menu-avatar-label")!.textContent).toBe("王老师 · 高一物理");
    await openMenu();
    expect(container.querySelector(".shell-menu-identity-name")!.textContent).toBe("王老师 · 高一物理");
    expect(container.querySelector(".shell-menu-identity-id")!.textContent).toBe("pubf_a7k2qf3z");
  });

  it("renders every entry; 账户/积分 is DISABLED with the 等待托管上线 tooltip", async () => {
    await renderMenu();
    await openMenu();

    const ids = Array.from(container.querySelectorAll(".shell-menu-item")).map((el) => el.getAttribute("data-entry-id"));
    expect(ids).toEqual(["settings", "plugins", "profile", "share", "account", "onboarding", "about"]);

    const account = container.querySelector<HTMLButtonElement>('[data-entry-id="account"]')!;
    expect(account.disabled).toBe(true);
    expect(account.title).toBe("等待托管上线");

    // 关于 carries the version readout.
    expect(container.querySelector('[data-entry-id="about"]')!.textContent).toBe("关于 · v0.1.0");
  });

  it("entries dispatch the RIGHT shell-nav targets (aggregation, no re-implementation) and close the menu", async () => {
    await renderMenu();

    const clickEntry = async (id: string) => {
      await openMenu();
      await act(async () => {
        container.querySelector<HTMLButtonElement>(`[data-entry-id="${id}"]`)!.click();
      });
      expect(container.querySelector(".shell-menu-pop")).toBeNull(); // closed after acting
    };

    await clickEntry("settings");
    await clickEntry("plugins");
    await clickEntry("profile");
    await clickEntry("share");
    await clickEntry("onboarding");
    await clickEntry("about");

    expect(targets).toEqual([
      { type: "pane", kind: "settings.hub" },
      { type: "pane", kind: "plugin.manager" },
      { type: "pane", kind: "profile.panel" },
      { type: "pane", kind: "layer.switcher" },
      { type: "onboarding", open: true },
      { type: "pane", kind: "settings.hub" }
    ]);
  });

  it("Esc closes the popover and restores focus to the trigger", async () => {
    await renderMenu();
    await openMenu();
    expect(container.querySelector(".shell-menu-pop")).not.toBeNull();
    // Focus moved into the menu (first enabled item).
    expect(document.activeElement?.getAttribute("data-entry-id")).toBe("settings");

    await act(async () => {
      document.activeElement!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
      );
    });
    expect(container.querySelector(".shell-menu-pop")).toBeNull();
    expect(document.activeElement).toBe(container.querySelector(".shell-menu-trigger"));
  });

  it("a mousedown OUTSIDE the menu closes it; one inside does not", async () => {
    await renderMenu();
    await openMenu();

    await act(async () => {
      container.querySelector(".shell-menu-identity")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(container.querySelector(".shell-menu-pop")).not.toBeNull();

    await act(async () => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(container.querySelector(".shell-menu-pop")).toBeNull();
  });
});
