import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { SERVER } from "./harness";

// SEARCH-2 end-to-end (docs/design/global-search.md §3): the Cmd/Ctrl+K palette against
// the REAL app — filters narrow the result families, pinyin finds a CJK-titled source by
// its romanization, and a settled query is remembered as a recent for one-click redo.
// SEARCH-1's palette/hotkey/opening is covered by shell-smoke + the component tests; this
// spec proves the SEARCH-2 additions travel the whole stack (palette → GET /api/search
// with filter params → ranked hits).

async function seedHtmlSource(request: APIRequestContext, title: string, body: string) {
  const res = await request.post(`${SERVER}/api/sources/html`, { data: { title, content: body } });
  expect(res.ok(), `seed source failed: ${res.status()}`).toBeTruthy();
  return (await res.json()).source as { id: string; title: string };
}

/** Open the global-search palette via the Ctrl+K hotkey and wait for its input. The
 *  hotkey lives on a window keydown, so ensure the shell has focus first. */
async function openPalette(page: Page) {
  await page.locator(".library-panel").click();
  await page.keyboard.press("Control+k");
  await expect(page.locator(".global-search-input")).toBeVisible();
}

const rowIds = (page: Page) =>
  page.locator(".global-search-row[data-row-id]").evaluateAll((els) => els.map((el) => el.getAttribute("data-row-id")));

test("filters narrow families, pinyin finds a CJK source, and recents redo a query", async ({ page, request }) => {
  const stamp = Date.now();
  const cjkTitle = `浮力实验讲义 ${stamp}`; // pinyin: fu li shi yan jiang yi → initials "flsyjy"
  const latinTitle = `Buoyancy Lab ${stamp}`;
  const cjkSource = await seedHtmlSource(request, cjkTitle, "<article><p>关于浮力与压强的讲义。</p></article>");
  await seedHtmlSource(request, latinTitle, "<article><p>Notes about buoyancy.</p></article>");

  await page.goto("/");
  await expect(page.locator(".library-panel")).toBeVisible();

  // —— literal CJK search finds the source ——
  await openPalette(page);
  await page.locator(".global-search-input").fill("浮力");
  await expect(page.locator(`.global-search-row[data-row-id="${cjkSource.id}"]`)).toBeVisible();

  // —— the filter bar renders 全部 / 笔记 / 文档; narrowing to 笔记 hides the source hit ——
  const filters = page.locator(".global-search-filter");
  await expect(filters).toHaveText(["全部", "笔记", "文档"]);
  await filters.filter({ hasText: "笔记" }).click();
  // A note-only filter drops the source row (server-side narrowing over the real vault).
  await expect(page.locator(`.global-search-row[data-row-id="${cjkSource.id}"]`)).toHaveCount(0);
  // Back to 文档 → the source returns.
  await filters.filter({ hasText: "文档" }).click();
  await expect(page.locator(`.global-search-row[data-row-id="${cjkSource.id}"]`)).toBeVisible();

  // —— pinyin: type the full pinyin of the CJK title → it still surfaces (additive tier).
  // Wait for the fuli REQUEST to complete so the query is recorded as a recent (the row
  // may briefly show stale 浮力 hits; the response wait pins us to the fresh fetch). ——
  await filters.filter({ hasText: "全部" }).click();
  const fuliResponse = page.waitForResponse((res) => res.url().includes("/api/search") && res.url().includes("fuli"));
  await page.locator(".global-search-input").fill("fuli"); // 全拼 of 浮力…
  await fuliResponse;
  await expect(page.locator(`.global-search-row[data-row-id="${cjkSource.id}"]`)).toBeVisible();
  expect(await rowIds(page)).toContain(cjkSource.id);

  // —— recents: close, reopen empty → the last query is offered and re-runs on click ——
  await page.keyboard.press("Escape");
  await openPalette(page);
  const recent = page.locator(".global-search-group[data-family='recent'] [data-recent='fuli']");
  await expect(recent).toBeVisible();
  await recent.click();
  await expect(page.locator(".global-search-input")).toHaveValue("fuli");
  await expect(page.locator(`.global-search-row[data-row-id="${cjkSource.id}"]`)).toBeVisible();
});
