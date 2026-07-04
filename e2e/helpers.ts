import { expect, type Page } from "@playwright/test";

// R1 "Growte" shell helpers. The redesign moved the always-on secondary COLUMNS
// (Bookmarks / Concepts / Operations / Layers) behind the left IconRail: each is now
// reached by clicking its rail button, which swaps the left rail slot to that pane.
// These helpers open a pane the way a user would, so behavioral specs keep their intent
// (assert on the pane's own DOM) while matching the new structure.

// The IconRail button aria-labels (see src/client/workspace/IconRail.tsx RAIL_ENTRIES).
// The rail is down to 6 icons (commit daf3c57 dropped Anchors/Bookmarks, AI Chat and
// Layers — they duplicate the right sidebar's tabs); Notes/Layers now live as
// right-sidebar TABS (openNotesTab / openLayers below).
export const RAIL_LABELS = {
  library: "Library",
  concepts: "Concepts",
  operations: "Operations",
  pluginManager: "Kit & Plugin",
  review: "复习 (Review)",
  profile: "画像 (Profile)"
} as const;

// Open a pane in the left rail slot via the IconRail, then wait for its panel selector.
// Scoped to the IconRail nav so labels shared with TopBar buttons don't match two elements.
export async function openRailPane(page: Page, label: string, paneSelector: string) {
  const rail = page.getByRole("navigation", { name: "Panels" });
  await rail.getByRole("button", { name: label, exact: true }).click();
  await expect(page.locator(paneSelector)).toBeVisible();
}

export const openConcepts = (page: Page) => openRailPane(page, RAIL_LABELS.concepts, ".concept-panel");
export const openOperations = (page: Page) => openRailPane(page, RAIL_LABELS.operations, ".operation-panel");

// Activate a right-sidebar TAB (Anchor / Notes / Layers / AI Chat — RightSidebarTabs)
// and wait for its panel. The tabs share ONE group: activating a tab hides the previous
// one, so specs that used to see two always-on panes must now switch back and forth.
export async function openRightTab(page: Page, label: string, paneSelector: string) {
  const panel = page.locator(paneSelector);
  if (await panel.isVisible().catch(() => false)) return;
  await page.locator(".right-tabs-tab", { hasText: label }).click();
  await expect(panel).toBeVisible();
}

// Layers moved from the left rail to the right sidebar's "Layers" tab (layer.switcher).
export const openLayers = (page: Page) => openRightTab(page, "Layers", ".layer-panel");

// The standalone bookmark.list pane (.bookmark-panel) lost its chrome entry point in the
// rail slim-down; today's bookmark surface is the reader-toolbar BookmarkIndex popover.
// Only the (skipped) bookmark.spec.ts still references this pane.
export const openBookmarks = async (_page: Page) => {
  throw new Error("bookmark.list pane has no chrome entry point in today's UI (rail icon removed)");
};

// —— Panel ⋯ overflow menus (整体 IA 重建) ————————————————————————————————————————
// The structural rebuild relocated several controls behind a panel's ⋯ overflow menu
// (PanelMenu) instead of deleting them: the Reader's Product-Kit select + status pill,
// and the AI-Chat panel's Review-Pack / Edit-source-patch / AI-Terminal cluster. These
// helpers open the right menu by its trigger aria-label so a spec can then click the
// relocated control, preserving each test's original intent.

// LIB-2 replaced the Library kebab (⋯ "Library actions") with ONE unified `+` add menu
// (trigger aria-label 添加到资料库 under the zh default locale; groups 导入/新建).
// This opens it; the import/create actions live inside as [data-add-action] items.
export async function openLibraryMenu(page: Page) {
  const popover = page.locator(".library-panel .panel-menu-popover");
  if (await popover.isVisible().catch(() => false)) return;
  await page.getByRole("button", { name: "添加到资料库", exact: true }).click();
  await expect(popover).toBeVisible();
}

// Open the Reader chrome ⋯ menu (Product Kit select + status). Idempotent.
export async function openReaderMenu(page: Page) {
  const kit = page.locator(".kit-select");
  if (await kit.isVisible().catch(() => false)) return;
  await page.getByRole("button", { name: "Reader actions", exact: true }).click();
  await expect(page.locator(".panel-menu-popover")).toBeVisible();
}

// Open the AI-Chat panel ⋯ menu (Review Pack / Edit source patch / AI Terminal).
// Idempotent: opens only when the menu's body (the patch fold) isn't already showing.
export async function openChatMenu(page: Page) {
  const fold = page.locator(".chat-box .panel-menu-popover .patch-fold");
  if (await fold.isVisible().catch(() => false)) return;
  await page.getByRole("button", { name: "AI Chat actions", exact: true }).click();
  await expect(fold).toBeVisible();
}

// —— Right sidebar TAB group (整体 IA 重建) ————————————————————————————————————————
// The right column is now a single TABBED panel (right.tabs): sub-pages Anchor / Notes /
// Layers, with AI Chat popped into the bottom split pane by default. The note list is the
// always-open FULL-PANEL variant behind the "Notes" tab (the old collapsible
// `.note-list-head` fold is no longer mounted). This helper activates the Notes tab and
// waits for the always-open panel, replacing the obsolete expand-the-fold step.
export const openNotesTab = (page: Page) => openRightTab(page, "Notes", ".note-list-panel-tab");

// Open the TopBar Settings gear menu (hosts the relocated theme + layout selects).
// Idempotent: the gear toggles, so only click when the menu isn't already showing.
export async function openGearMenu(page: Page) {
  const menu = page.locator(".topbar-gear-menu");
  if (await menu.isVisible().catch(() => false)) return;
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(menu).toBeVisible();
}
