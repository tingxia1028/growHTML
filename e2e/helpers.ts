import { expect, type Page } from "@playwright/test";
// Canonical message dictionaries (pure TS, exported from src/client) — importing them
// keeps these selectors self-updating when copy changes. The app boots in the zh
// DEFAULT locale (I18N, commit 301a190), so every label-based selector uses `.zh`.
import { libraryMessages } from "../src/client/workspace/libraryMessages";

// R1 "Growte" shell helpers. The redesign moved the always-on secondary COLUMNS
// (Bookmarks / Concepts / Operations / Layers) behind the left IconRail: each is now
// reached by clicking its rail button, which swaps the left rail slot to that pane.
// These helpers open a pane the way a user would, so behavioral specs keep their intent
// (assert on the pane's own DOM) while matching the new structure.

// The IconRail button labels (src/client/workspace/IconRail.tsx railMessages — a
// module-private dict, hence zh literals here). SHELL-4 slimmed the rail to
// Library / Review / Concepts / Profile; Operations, Kit & Plugin, Settings, Trash,
// Onboarding and ShortcutHelp moved into the centered shell MODAL (openShellModal).
export const RAIL_LABELS = {
  library: "资料库", // railMessages.library
  concepts: "知元", // railMessages.concepts
  review: "复习", // railMessages.review
  profile: "画像" // railMessages.profile
} as const;

// Open a pane in the left rail slot via the IconRail, then wait for its panel selector.
// Scoped to the structural nav.icon-rail (its aria-label 面板 is localized).
export async function openRailPane(page: Page, label: string, paneSelector: string) {
  const rail = page.locator("nav.icon-rail");
  await rail.getByRole("button", { name: label, exact: true }).click();
  await expect(page.locator(paneSelector)).toBeVisible();
}

export const openConcepts = (page: Page) => openRailPane(page, RAIL_LABELS.concepts, ".concept-panel");

// —— SHELL-4 shell modals ————————————————————————————————————————————————————————
// Settings / Kit & Plugin / Operations / Share-Identity / Trash / Onboarding /
// ShortcutHelp lost their rail/pane entry points: they now open through the UserMenu
// (bottom-left avatar) via navigateShell({type:"modal"}) into the centered modal host
// (WorkspaceShell .shell-modal-*). These helpers drive that flow the way a user would.

// Open the bottom-left UserMenu popover (structural .shell-menu-* classes). Idempotent.
export async function openUserMenu(page: Page) {
  const pop = page.locator(".shell-menu-pop");
  if (await pop.isVisible().catch(() => false)) return;
  await page.locator(".shell-menu-trigger").click();
  await expect(pop).toBeVisible();
}

// Open a shell modal from its UserMenu entry (data-entry-id is structural: settings /
// plugins / operations / share / trash / onboarding / shortcuts / about) and wait for
// `paneSelector` to render inside the modal body.
export async function openShellModal(page: Page, entryId: string, paneSelector: string) {
  await openUserMenu(page);
  await page.locator(`.shell-menu-pop .shell-menu-item[data-entry-id="${entryId}"]`).click();
  await expect(page.locator(".shell-modal-dialog")).toBeVisible();
  await expect(page.locator(`.shell-modal-body ${paneSelector}`)).toBeVisible();
}

// Close the shell modal the way the product does (Esc; the × button and a backdrop
// mousedown are equivalent paths).
export async function closeShellModal(page: Page) {
  const dialog = page.locator(".shell-modal-dialog");
  if (!(await dialog.isVisible().catch(() => false))) return;
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
}

// The operation manager is a shell MODAL now (SHELL-4) — UserMenu 操作, not a rail icon.
export const openOperations = (page: Page) => openShellModal(page, "operations", ".operation-panel");
// Settings Hub (SHELL-4 modal; hosts the 语言/Language section the locale-flip spec drives).
export const openSettings = (page: Page) => openShellModal(page, "settings", ".settings-hub");

// —— right sidebar TABS ————————————————————————————————————————————————————————————
// Activate a right-sidebar TAB (Anchor / Notes / Layers / AI Chat — RightSidebarTabs)
// and wait for its panel. The tabs share ONE group: activating a tab hides the previous
// one, so specs that used to see two always-on panes must now switch back and forth.
// Tab labels (RightSidebarTabs.tsx rightSidebarMessages — module-private, hence the zh
// literals; the tabs carry no per-kind data attribute).
export const RIGHT_TAB_LABELS = {
  anchor: "锚点", // rightSidebarMessages.anchor
  notes: "笔记", // rightSidebarMessages.notes
  layers: "层", // rightSidebarMessages.layers
  aiChat: "AI 对话" // rightSidebarMessages.aiChat
} as const;

export async function openRightTab(page: Page, label: string, paneSelector: string) {
  const panel = page.locator(paneSelector);
  if (await panel.isVisible().catch(() => false)) return;
  await page.locator(".right-tabs-tab", { hasText: label }).click();
  await expect(panel).toBeVisible();
}

// Layers moved from the left rail to the right sidebar's 层 tab (layer.switcher).
export const openLayers = (page: Page) => openRightTab(page, RIGHT_TAB_LABELS.layers, ".layer-panel");
// The focused-anchor detail tab (the e2e-electron harness resets focus through it).
export const openAnchorTab = (page: Page) => openRightTab(page, RIGHT_TAB_LABELS.anchor, ".anchor-panel");

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
// NOTE: the popover is PORTALED to <body> (PanelMenu createPortal) — never scope
// `.panel-menu-popover` under the owning panel; only one menu is open at a time.

// LIB-2 replaced the Library kebab (⋯ "Library actions") with ONE unified `+` add menu
// (trigger aria-label = libraryMessages.add; groups 导入/新建).
// This opens it; the import/create actions live inside as [data-add-action] items.
export async function openLibraryMenu(page: Page) {
  const popover = page.locator(".panel-menu-popover");
  if (await popover.isVisible().catch(() => false)) return;
  await page.getByRole("button", { name: libraryMessages.add.zh, exact: true }).click();
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
  const fold = page.locator(".panel-menu-popover .patch-fold");
  if (await fold.isVisible().catch(() => false)) return;
  await page.getByRole("button", { name: "AI Chat actions", exact: true }).click();
  await expect(fold).toBeVisible();
}

// —— Right sidebar TAB group (整体 IA 重建) ————————————————————————————————————————
// The right column is now a single TABBED panel (right.tabs): sub-pages Anchor / Notes /
// Layers, with AI Chat popped into the bottom split pane by default. The note list is the
// always-open FULL-PANEL variant behind the 笔记 tab (the old collapsible
// `.note-list-head` fold is no longer mounted). This helper activates the Notes tab and
// waits for the always-open panel, replacing the obsolete expand-the-fold step.
export const openNotesTab = (page: Page) => openRightTab(page, RIGHT_TAB_LABELS.notes, ".note-list-panel-tab");
