import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { SERVER } from "./harness";

async function seedHtmlSource(request: APIRequestContext, title: string, body: string) {
  const res = await request.post(`${SERVER}/api/sources/html`, { data: { title, content: body } });
  expect(res.ok(), `seed source failed: ${res.status()}`).toBeTruthy();
}

async function expectStudyVaultVisible(page: Page) {
  await expect(page.locator(".library-panel")).toBeVisible();
  await expect(page.locator(".reader-panel")).toBeVisible();
  await expect(page.locator(".study-panel")).toBeVisible();
  await expect(page.locator(".anchor-panel")).toBeVisible();
}

test("active left rail icon toggles the left sidebar", async ({ page, request }) => {
  await seedHtmlSource(request, `Layout Left Toggle ${Date.now()}`, "<article><p>Body.</p></article>");
  await page.goto("/");
  await expectStudyVaultVisible(page);

  const railButtons = page.locator(".icon-rail-entries .icon-rail-btn");
  const library = railButtons.first();
  const concepts = railButtons.nth(2);

  await library.click();
  await expect(page.locator(".library-panel")).toHaveCount(0);
  await expect(page.locator(".reader-panel")).toBeVisible();
  await expect(page.locator(".dock-rail:visible")).toHaveCount(0);
  await expect(page.locator(".dock-collapse-btn:visible")).toHaveCount(0);

  await library.click();
  await expect(page.locator(".library-panel")).toBeVisible();

  await library.click();
  await concepts.click();
  await expect(page.locator(".concept-panel")).toBeVisible();
  await expect(page.locator(".library-panel")).toHaveCount(0);
});

test("narrow viewport keeps panes visible instead of showing collapsed rails", async ({ page, request }) => {
  await seedHtmlSource(request, `Layout Narrow No Rails ${Date.now()}`, "<article><p>Body.</p></article>");
  await page.setViewportSize({ width: 900, height: 900 });
  await page.goto("/");

  await expect(page.locator(".library-panel")).toBeVisible();
  await expect(page.locator(".reader-panel")).toBeVisible();
  await expect(page.locator(".dock-rail:visible")).toHaveCount(0);
  await expect(page.locator(".dock-collapse-btn:visible")).toHaveCount(0);
});
