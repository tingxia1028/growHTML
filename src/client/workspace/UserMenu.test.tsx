// @vitest-environment jsdom
// UserMenu (SHELL-1) — the bottom-left identity button + popover: identity fallback
// (本地用户) vs the Tier-A svpack name, every entry present, the aggregation clicks
// dispatching the right shell-nav targets, the disabled 账户/积分 stub with its
// honest tooltip, 帮助/新手引导 reopening onboarding, Esc + outside-mousedown close.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { UserMenu } from "./UserMenu";
import { setDataTrustIoForTests } from "./dataTrust";
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
  // TRUST-1/2 entries: hermetic IO (the real edges would fetch relative URLs).
  setDataTrustIoForTests({
    backupNow: async () => ({
      backup: { name: "vault-backup-20260704-010203-manual.zip", createdAt: "2026-07-04T01:02:03.000Z", reason: "manual", sizeBytes: 10 }
    }),
    fetchBackupStatus: async () => ({
      backups: [],
      lastBackupAt: null,
      nextDueAt: "2026-07-04T01:02:03.000Z",
      backupsDir: "X:/backups"
    }),
    fetchVaultInfo: async () => ({
      vault: { name: "Vault", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", schemaVersion: 1 },
      counts: {},
      rootDir: "X:/vault"
    }),
    exportVault: async () => ({ blob: new Blob(["zip"]), fileName: "vault-x.growte-vault.zip" }),
    importVault: async () => {
      throw new Error("not under test");
    }
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  setUserMenuIoForTests(null);
  setDataTrustIoForTests(null);
  registerShellNavigator(null);
  vi.restoreAllMocks();
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
    expect(ids).toEqual([
      "settings",
      "plugins",
      "profile",
      "share",
      "backup-now",
      "export-vault",
      "import-vault",
      "account",
      "onboarding",
      "feedback",
      "about"
    ]);

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

  it("数据 entries (TRUST-1/2) hit the RIGHT endpoints through the dataTrust IO seam", async () => {
    const backupNow = vi.fn(async () => ({
      backup: {
        name: "vault-backup-20260704-010203-manual.zip",
        createdAt: "2026-07-04T01:02:03.000Z",
        reason: "manual",
        sizeBytes: 10
      }
    }));
    const exportVault = vi.fn(async () => ({ blob: new Blob(["zip"]), fileName: "vault-x.growte-vault.zip" }));
    setDataTrustIoForTests({
      backupNow,
      exportVault,
      fetchBackupStatus: async () => ({
        backups: [
          { name: "vault-backup-20260704-010203-manual.zip", createdAt: "2026-07-04T01:02:03.000Z", reason: "manual", sizeBytes: 10 }
        ],
        lastBackupAt: "2026-07-04T01:02:03.000Z",
        nextDueAt: "2026-07-05T01:02:03.000Z",
        backupsDir: "X:/backups"
      })
    });
    const alerts: string[] = [];
    vi.spyOn(window, "alert").mockImplementation((message?: unknown) => {
      alerts.push(String(message));
    });
    // jsdom has no createObjectURL — stub the download plumbing for 导出全库.
    const createUrl = vi.fn(() => "blob:vault");
    const revokeUrl = vi.fn();
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = createUrl;
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = revokeUrl;
    const anchorClicks = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    try {
      await renderMenu();

      await openMenu();
      await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-entry-id="backup-now"]')!.click();
      });
      await act(async () => {}); // flush the chained backup→status→alert microtasks
      expect(backupNow).toHaveBeenCalledTimes(1);
      expect(alerts.some((message) => message.includes("已备份") && message.includes("共 1 份"))).toBe(true);

      await openMenu();
      await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-entry-id="export-vault"]')!.click();
      });
      await act(async () => {}); // flush the export→download microtasks
      expect(exportVault).toHaveBeenCalledTimes(1);
      expect(createUrl).toHaveBeenCalledTimes(1);
      expect(anchorClicks).toHaveBeenCalledTimes(1);

      // 导入全库 exists and opens a picker (the flow itself is dataTrust.test.ts).
      await openMenu();
      expect(container.querySelector('[data-entry-id="import-vault"]')).not.toBeNull();
      expect(targets).toEqual([]); // none of the 数据 entries dispatch shell-nav
    } finally {
      delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
      delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
    }
  });

  it("反馈问题 opens the GitHub issues URL in a new tab/external browser and closes the menu", async () => {
    const opened: Array<{ url: string; target: string | undefined }> = [];
    const originalOpen = window.open;
    (window as { open: unknown }).open = (url?: string | URL, target?: string) => {
      opened.push({ url: String(url), target });
      return null;
    };
    try {
      await renderMenu();
      await openMenu();
      await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-entry-id="feedback"]')!.click();
      });
      expect(opened).toEqual([
        { url: "https://github.com/tingxia1028/growHTML/issues", target: "_blank" }
      ]);
      expect(container.querySelector(".shell-menu-pop")).toBeNull(); // closed after acting
      expect(targets).toEqual([]); // no shell-nav dispatch — it is an external link
    } finally {
      window.open = originalOpen;
    }
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
