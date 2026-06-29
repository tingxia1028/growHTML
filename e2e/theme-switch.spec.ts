import { expect, test } from "@playwright/test";

test("topbar settings/theme controls are hidden in the simplified UI", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("button", { name: "Settings", exact: true })).toHaveCount(0);
  await expect(page.locator(".topbar-gear-menu")).toHaveCount(0);
  await expect(page.locator("select.theme-select")).toHaveCount(0);
  await expect(page.locator("select.layout-select")).toHaveCount(0);
});
