import { expect, type Page } from "@playwright/test";

// R1 "Growte" shell helpers. The redesign moved the always-on secondary COLUMNS
// (Bookmarks / Concepts / Operations / Layers) behind the left IconRail: each is now
// reached by clicking its rail button, which swaps the left rail slot to that pane.
// These helpers open a pane the way a user would, so behavioral specs keep their intent
// (assert on the pane's own DOM) while matching the new structure.

// The IconRail button aria-labels (see src/client/workspace/IconRail.tsx RAIL_ENTRIES).
export const RAIL_LABELS = {
  library: "Library",
  bookmarks: "Anchors / Bookmarks",
  notes: "Notes",
  concepts: "Concepts",
  operations: "Operations",
  layers: "Layers"
} as const;

// Open a pane in the left rail slot via the IconRail, then wait for its panel selector.
// Scoped to the IconRail nav so labels shared with TopBar buttons (e.g. "Layers") don't
// match two elements.
export async function openRailPane(page: Page, label: string, paneSelector: string) {
  const rail = page.getByRole("navigation", { name: "Panels" });
  await rail.getByRole("button", { name: label, exact: true }).click();
  await expect(page.locator(paneSelector)).toBeVisible();
}

export const openConcepts = (page: Page) => openRailPane(page, RAIL_LABELS.concepts, ".concept-panel");
export const openLayers = (page: Page) => openRailPane(page, RAIL_LABELS.layers, ".layer-panel");
export const openBookmarks = (page: Page) => openRailPane(page, RAIL_LABELS.bookmarks, ".bookmark-panel");
export const openOperations = (page: Page) => openRailPane(page, RAIL_LABELS.operations, ".operation-panel");

// —— Panel ⋯ overflow menus (整体 IA 重建) ————————————————————————————————————————
// The structural rebuild relocated several controls behind a panel's ⋯ overflow menu
// (PanelMenu) instead of deleting them: the Reader's Product-Kit select + status pill,
// and the AI-Chat panel's Review-Pack / Edit-source-patch / AI-Terminal cluster. These
// helpers open the right menu by its trigger aria-label so a spec can then click the
// relocated control, preserving each test's original intent.

// Open the Library panel ⋯ menu (Refresh / Open File / Open Folder / Import .xmind /
// Import-from-URL / Open Live). Idempotent.
export async function openLibraryMenu(page: Page) {
  const refresh = page.getByRole("button", { name: "Refresh", exact: true });
  if (await refresh.isVisible().catch(() => false)) return;
  await page.getByRole("button", { name: "Library actions", exact: true }).click();
  await expect(page.locator(".library-panel .panel-menu-popover")).toBeVisible();
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

// Open the TopBar Settings gear menu (hosts the relocated theme + layout selects).
// Idempotent: the gear toggles, so only click when the menu isn't already showing.
export async function openGearMenu(page: Page) {
  const menu = page.locator(".topbar-gear-menu");
  if (await menu.isVisible().catch(() => false)) return;
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(menu).toBeVisible();
}
