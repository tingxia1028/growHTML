import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// Textbook Learning Kit (Product Kit) phase 1 — the kit registers its note types into
// the SAME composer + note-list registries as the built-ins, with NO core changes. We
// drive the real app (web mode): pick the kit's "Explanation" type in the composer,
// author a Study Block via its structured editor, save, and assert it renders as the
// kit's Explanation card in the note list (proving register-only end to end).

import { SERVER } from "./harness";

async function seedHtmlSource(request: APIRequestContext, title: string, body: string) {
  const res = await request.post(`${SERVER}/api/sources/html`, { data: { title, content: body } });
  expect(res.ok(), `seed source failed: ${res.status()}`).toBeTruthy();
  return (await res.json()).source as { id: string; title: string };
}

async function openSource(page: Page, title: string) {
  await page.goto("/");
  await page.locator(".source-item-open", { hasText: title }).first().click();
  await expect(page.locator(".reader-tab-title")).toHaveText(title);
}

test.skip("textbook kit: composer creates an Explanation Study Block → renders as a kit card", async ({ page, request }) => {
  const title = `Textbook Kit ${Date.now()}`;
  await seedHtmlSource(request, title, "<article><p>Body about photosynthesis.</p></article>");
  await openSource(page, title);

  // The kit's content type is available in the composer's (registry-fed) type picker,
  // labelled with the kit's domain name "Explanation".
  await page.locator(".composer-mode .mode-tab", { hasText: "Note" }).click();
  // The type picker defaults to a "detected · change" chip (adaptive note forms Phase
  // 1b); reveal the override <select> to pick the kit's type.
  await page.locator(".composer-detected-change").click();
  const select = page.locator(".composer-type-picker select.note-type-select");
  await expect(select.locator('option[value="textbook.explanation"]')).toHaveText("Explanation");
  await select.selectOption("textbook.explanation");

  // Author via the kit's structured editor (not the shared text textarea).
  const editor = page.locator(".composer-note-editor");
  await editor.locator(".tb-explanation-title").fill("Photosynthesis");
  await editor.locator(".tb-explanation-level").selectOption("simple");
  await editor.locator(".tb-explanation-text").fill("Plants make **food** from light.");
  await editor.locator(".tb-explanation-keypoints").fill("needs light\nneeds chlorophyll");
  await page.getByRole("button", { name: "Save Note" }).click();

  // The saved note renders as the kit's Explanation card in the note list.
  const card = page.locator(".note-list .record-card", { hasText: "Photosynthesis" });
  await expect(card).toBeVisible();
  await expect(card.locator(".tb-explanation")).toBeVisible();
  await expect(card.locator(".tb-card-kind")).toContainText("Explanation");
  await expect(card.locator(".tb-badge").first()).toContainText("simple");
  // Prose rendered as sanitized markdown (bold) — scope to the nested prose container
  // so we don't match the section header <strong>s.
  await expect(card.locator(".tb-explanation .note-rendered strong")).toContainText("food");
  await expect(card.locator(".tb-section li").first()).toContainText("needs light");
});
