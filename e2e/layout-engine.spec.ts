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

test("dock panes do not expose collapse rails or collapse buttons", async ({ page, request }) => {
  await seedHtmlSource(request, `Layout No Rails ${Date.now()}`, "<article><p>Body.</p></article>");
  await page.goto("/");
  await expectStudyVaultVisible(page);

  await expect(page.locator(".dock-rail")).toHaveCount(0);
  await expect(page.locator(".dock-collapse-btn")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Expand Sources|Collapse Sources/ })).toHaveCount(0);
});

test("narrow viewport keeps panes visible instead of showing collapsed rails", async ({ page, request }) => {
  await seedHtmlSource(request, `Layout Narrow No Rails ${Date.now()}`, "<article><p>Body.</p></article>");
  await page.setViewportSize({ width: 900, height: 900 });
  await page.goto("/");

  await expect(page.locator(".library-panel")).toBeVisible();
  await expect(page.locator(".reader-panel")).toBeVisible();
  await expect(page.locator(".dock-rail")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Expand Sources" })).toHaveCount(0);
});
