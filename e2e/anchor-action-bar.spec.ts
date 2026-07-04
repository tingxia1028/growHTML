import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// Anchor Action Bar (R6.1) end-to-end (web mode). The redesigned right-sidebar "Anchor"
// pane (anchor.excerpt view) mounts a reusable icon-grid of anchor-scope actions
// (.anchor-action-bar > .action-grid > .action-grid-btn) between the excerpt card and the
// linked-notes block. It only TRIGGERS actions (runAction) — no result renders here; a
// custom op's output still flows through the existing GenerationPreview. This proves the
// bar's enable/disable contract:
//   • the core "Bookmark" action (data-action-id="bookmark.add", NOT kit-gated) is always
//     a button in the bar.
//   • with NOTHING focused, the buttons are DISABLED (the bar shows but is inert).
//   • after focusing a passage (its quote fills .anchor-excerpt-quote), the buttons ENABLE.
//
// Modeled on e2e/streaming-chat.spec.ts (shared e2e SERVER, reader iframe, select→focus flow).

import { SERVER } from "./harness";
const READER = 'iframe[title="Source reader"]';

async function seedHtmlSource(request: APIRequestContext, title: string, body: string) {
  const res = await request.post(`${SERVER}/api/sources/html`, { data: { title, content: body } });
  expect(res.ok(), `seed source failed: ${res.status()}`).toBeTruthy();
  return (await res.json()).source as { id: string; title: string };
}

// Open a freshly seeded source from the library by its per-run-unique TITLE — the LIB
// row's visible text is the title only (the id rides the row's tooltip, so an id-based
// hasText filter matches nothing). Titles carry a uid() stamp, so rows stay unambiguous.
async function openSource(page: Page, source: { id: string; title: string }) {
  await page.goto("/");
  await page.locator(".source-item-open").filter({ hasText: source.title }).first().click();
  await expect(page.locator(".reader-tab-title")).toHaveText(source.title);
}

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

test("anchor action bar: bookmark button is disabled with no focus, enabled after focusing a passage", async ({
  page,
  request
}) => {
  const stamp = uid();
  const title = `Anchor Action Bar ${stamp}`;
  const passage = `Focus this passage ${stamp}`;
  const body = `<article><section><p>${passage}</p></section></article>`;
  const source = await seedHtmlSource(request, title, body);

  // Wide viewport so the right-sidebar Anchor pane stays expanded.
  await page.setViewportSize({ width: 1400, height: 900 });
  await openSource(page, source);

  // The Anchor Action Bar mounts the core "Bookmark" action (not kit-gated). With nothing
  // focused, the empty-state bar shows but its buttons are DISABLED.
  const bookmarkBtn = page.locator('.anchor-action-bar .action-grid-btn[data-action-id="bookmark.add"]');
  await expect(bookmarkBtn).toBeVisible();
  await expect(bookmarkBtn).toBeDisabled();

  // Focus the passage → its quote fills the excerpt; the action-bar buttons ENABLE.
  await page.frameLocator(READER).getByText(passage, { exact: false }).click();
  await expect(page.locator(".anchor-excerpt-quote")).toContainText(passage);
  await expect(bookmarkBtn).toBeEnabled();
});
