import { expect, test } from "@playwright/test";
// Canonical dict (pure TS): the Library labels — the app boots in the zh DEFAULT locale.
import { libraryMessages } from "../src/client/workspace/libraryMessages";

// E2E-DEBT-001 smoke for today's two biggest chrome surfaces (2026-07):
//   • LIB-2 Library rebuild — the old kebab (⋯ "Library actions") is GONE; the pane is
//     header (title / search / refresh icon) + registered SECTIONS (core seeds
//     最近/文档/文件夹) + ONE unified `+` add menu (导入 / 新建 groups).
//   • TopBar — the center segmented control is exactly 笔记叠层 (Notes Overlay) +
//     锚点聚焦 (Anchor Focus) — the "Document" tab was removed, user decision 2026-07-04.

test("Library: core sections render and the ONE unified + menu opens (kebab is gone)", async ({ page }) => {
  await page.goto("/");
  const library = page.locator(".library-panel");
  await expect(library).toBeVisible();

  // The three CORE sections render (kits may register more — assert at least these).
  for (const id of ["core.recent", "core.documents", "core.folders"]) {
    await expect(library.locator(`.library-section[data-section-id="${id}"]`)).toBeVisible();
  }

  // The old kebab (⋯ "Library actions") menu trigger must not resurface.
  await expect(library.getByRole("button", { name: "Library actions" })).toHaveCount(0);

  // The ONE `+` menu (trigger aria-label = libraryMessages.add, zh default locale)
  // opens with the registered 导入 + 新建 groups. The popover is PORTALED to <body>
  // (PanelMenu createPortal), so it is NOT a descendant of .library-panel.
  await library.getByRole("button", { name: libraryMessages.add.zh, exact: true }).click();
  const popover = page.locator(".panel-menu-popover");
  await expect(popover).toBeVisible();
  await expect(popover.locator('.library-add-group[data-add-group="import"]')).toBeVisible();
  await expect(popover.locator('.library-add-group[data-add-group="create"]')).toBeVisible();
  await expect(popover.locator('[data-add-action="core.import-web"]')).toBeVisible();
});

test("TopBar: the reading-mode control is exactly Notes Overlay + Anchor Focus", async ({ page }) => {
  await page.goto("/");
  const tabs = page.locator(".topbar-center .topbar-tab");
  // Exactly TWO tabs — this count is also what keeps the removed "Document" tab from
  // silently returning. Labels are the zh defaults (TopBar.tsx topBarMessages is
  // module-private: notesOverlay = 笔记叠层, anchorFocus = 锚点聚焦).
  await expect(tabs).toHaveCount(2);
  await expect(tabs.nth(0)).toContainText("笔记叠层");
  await expect(tabs.nth(1)).toContainText("锚点聚焦");
  // Notes Overlay is the default-active tab.
  await expect(tabs.nth(0)).toHaveClass(/active/);
});
