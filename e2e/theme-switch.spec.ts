import { expect, test, type Page } from "@playwright/test";
import { openGearMenu } from "./helpers";

// Theme V1 end-to-end against the REAL running app (web mode). Drives the whole-app
// re-skin through the actual control — R1 relocated the theme dropdown from the
// reader-header into the TopBar Settings gear menu — no JS shortcuts for the behaviour
// under test:
//
//   1. DEFAULT ON LOAD — with no persisted choice the app boots on the default theme
//      (<html data-theme="default">) and the .theme-select shows "Default".
//   2. SWITCH TO DARK — picking "Dark" flips <html data-theme="dark"> + color-scheme and
//      a token-driven computed style (document.body background, which reads var(--sv-bg))
//      changes away from the default paper colour.
//   3. SWITCH BACK — picking "Default" restores both the attribute and the background.
//
// It only touches the theme chrome (the gear menu's .theme-select) + <html> data-theme;
// the theme switcher is a strict SIBLING of the layout switcher and never reads its state,
// so the dock layout is untouched here.

// Computed background-color of document.body (reads var(--sv-bg)); compared before/after a
// theme flip to prove the token layer actually re-skins the app, not just the attribute.
async function bodyBackground(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.body).backgroundColor);
}

test("default theme on load, switch to Dark re-skins the app, switch back restores it", async ({ page }) => {
  await page.goto("/");

  // The theme switcher now lives in the TopBar Settings gear menu (R1).
  await openGearMenu(page);
  const themeSelect = page.locator("select.theme-select");
  await expect(themeSelect).toBeVisible();

  // 1. Boots on the default theme (applied before React mounts — the FOUC guard).
  await expect(page.locator("html")).toHaveAttribute("data-theme", "default");
  const defaultBg = await bodyBackground(page);
  // Default app bg is #f3f4f6 → rgb(243, 244, 246).
  expect(defaultBg).toBe("rgb(243, 244, 246)");

  // 2. Switch to Dark → the attribute flips and the token-driven body background changes.
  await themeSelect.selectOption({ label: "Dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveJSProperty("style.colorScheme", "dark");
  const darkBg = await bodyBackground(page);
  expect(darkBg).not.toBe(defaultBg);
  // Dark app bg is #0b0d11 → rgb(11, 13, 17).
  expect(darkBg).toBe("rgb(11, 13, 17)");

  // 3. Switch back to Default → attribute + background restored.
  await themeSelect.selectOption({ label: "Default" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "default");
  await expect(page.locator("html")).toHaveJSProperty("style.colorScheme", "light");
  expect(await bodyBackground(page)).toBe(defaultBg);
});

test("the chosen theme persists across a reload", async ({ page }) => {
  await page.goto("/");
  await openGearMenu(page);
  const themeSelect = page.locator("select.theme-select");

  await themeSelect.selectOption({ label: "Dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  // Reload: the persisted id (localStorage "sv-active-theme") is applied before mount,
  // so the app comes back dark with no flash beyond default→chosen.
  await page.reload();
  await openGearMenu(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("select.theme-select")).toHaveValue("dark");
});
