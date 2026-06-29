import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// FULL manual dock-layout-engine flow against the REAL running app (web mode). Drives the
// phase-2 features end to end through the actual UI — no API shortcuts for the behaviour
// under test:
//
//   1. COLLAPSE / EXPAND — collapse a secondary pane (Sources/Library) via its chevron →
//      the panel is replaced by a thin rail → click the rail to expand → the panel returns.
//   2. LAYOUT SWITCH — switch the (now gear-menu) layout picker to "Textbook Learning" →
//      the bottom Practice panel appears (a nested column split the flat layouts can't
//      express) → switch back to "Study Vault" → the right-column Anchor pane returns.
//   3. RESPONSIVE — shrink the viewport below the breakpoint (1280px) → the secondary
//      side panes (Sources) auto-collapse to rails while the reader stays → widen → restore.
//
// R1: the always-on secondary COLUMNS (Concepts/Layers/Bookmarks/Operations) moved behind
// the IconRail, so the default Study Vault layout is now Library | Reader | right column
// (Anchor over Study). The layout picker moved from the reader-header into the TopBar gear.
//
// It only touches the dock chrome (.dock-collapse-btn / .dock-rail / .layout-select) and
// the pane container classes.

import { openGearMenu } from "./helpers";

const SERVER = "http://127.0.0.1:4177";

async function seedHtmlSource(request: APIRequestContext, title: string, body: string) {
  const res = await request.post(`${SERVER}/api/sources/html`, { data: { title, content: body } });
  expect(res.ok(), `seed source failed: ${res.status()}`).toBeTruthy();
  return (await res.json()).source as { id: string; title: string };
}

// The default Study Vault layout (R1) shows these regions: Library | Reader | right column
// (Anchor over Study). Library is the auto-collapsing secondary side pane.
async function expectStudyVaultExpanded(page: Page) {
  await expect(page.locator(".library-panel")).toBeVisible();
  await expect(page.locator(".reader-panel")).toBeVisible();
  await expect(page.locator(".study-panel")).toBeVisible();
  await expect(page.locator(".anchor-panel")).toBeVisible();
}

test("collapse → rail → expand restores a secondary pane", async ({ page, request }) => {
  await seedHtmlSource(request, `Layout Collapse ${Date.now()}`, "<article><p>Body.</p></article>");
  await page.goto("/");
  await expectStudyVaultExpanded(page);

  // Collapse the Sources/Library pane via its chevron (faint until pane hover, clickable).
  await page.getByRole("button", { name: "Collapse Sources" }).click();

  // The panel is gone; a rail with an Expand affordance stands in its place.
  await expect(page.locator(".library-panel")).toHaveCount(0);
  const rail = page.getByRole("button", { name: "Expand Sources" });
  await expect(rail).toBeVisible();
  // The reader (flex spine) is never collapsible — it stays.
  await expect(page.locator(".reader-panel")).toBeVisible();

  // Expand again → the panel returns, the rail is gone.
  await rail.click();
  await expect(page.locator(".library-panel")).toBeVisible();
  await expect(page.getByRole("button", { name: "Expand Sources" })).toHaveCount(0);
});

test("layout switch: Study Vault ⇄ Textbook Learning (bottom Practice panel)", async ({ page, request }) => {
  await seedHtmlSource(request, `Layout Switch ${Date.now()}`, "<article><p>Body.</p></article>");
  await page.goto("/");
  await expectStudyVaultExpanded(page);
  // Study Vault has no Practice panel.
  await expect(page.locator(".practice-panel")).toHaveCount(0);

  // Switch to the Textbook Learning preset via the TopBar gear-menu layout picker (R1).
  await openGearMenu(page);
  await page.getByLabel("Workspace layout").selectOption({ label: "Textbook Learning" });

  // The nested column split surfaces the Practice panel under the reader; the right-column
  // Anchor pane (only in Study Vault) is gone.
  await expect(page.locator(".practice-panel")).toBeVisible();
  await expect(page.locator(".reader-panel")).toBeVisible();
  await expect(page.locator(".anchor-panel")).toHaveCount(0);

  // Switch back → Study Vault restored, Practice panel gone, Anchor pane returns.
  await openGearMenu(page);
  await page.getByLabel("Workspace layout").selectOption({ label: "Study Vault" });
  await expect(page.locator(".practice-panel")).toHaveCount(0);
  await expect(page.locator(".anchor-panel")).toBeVisible();
});

test("responsive: narrow viewport auto-collapses secondary panes, widening restores", async ({ page, request }) => {
  await seedHtmlSource(request, `Layout Responsive ${Date.now()}`, "<article><p>Body.</p></article>");
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");
  await expectStudyVaultExpanded(page);

  // Shrink below the 1280 breakpoint → the secondary side pane (Sources) collapses to a rail.
  await page.setViewportSize({ width: 1100, height: 900 });
  await expect(page.locator(".library-panel")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Expand Sources" })).toBeVisible();
  // The reader never auto-collapses.
  await expect(page.locator(".reader-panel")).toBeVisible();

  // Widen again → the secondary pane restores automatically.
  await page.setViewportSize({ width: 1400, height: 900 });
  await expect(page.locator(".library-panel")).toBeVisible();
});
