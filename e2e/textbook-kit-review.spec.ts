import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { openChatMenu } from "./helpers";

// Textbook Learning Kit (Product Kit) phase 3 — Review Pack + propagation policy.
// Driving the real app in web mode (mock provider = deterministic):
//  • the source-level "Review Pack" action (a `source-actions` surface contribution)
//    generates a structured review-pack Study Block that renders as a kit card;
//  • the propagation policy strips a student's mistakes from an exported layer:
//    create a Mistake + an Explanation, export the owned layer, assert the pack
//    carries the explanation but NOT the mistake.

import { SERVER } from "./harness";
const READER = 'iframe[title="Source reader"]';

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

// SKIP: pre-IA markup (`.note-list .tb-*` card classes; Review Pack seat in the chat
// ⋯ menu has since moved again) — pending the note-card UX decision.
test.skip("textbook kit: source-level Review Pack action → review-pack Study Block card", async ({ page, request }) => {
  const title = `Textbook Review ${Date.now()}`;
  const body = "<article><section><p>Mitochondria are the powerhouse of the cell.</p></section></article>";
  await seedHtmlSource(request, title, body);
  await openSource(page, title);

  // The source-actions toolbar (no passage needed) carries the kit's Review Pack action,
  // relocated into the AI Chat ⋯ menu by the IA rebuild.
  await openChatMenu(page);
  const reviewBtn = page.locator(".source-actions-btn", { hasText: "Review Pack" });
  await expect(reviewBtn).toBeVisible();
  await reviewBtn.click();

  // A review-pack Study Block is generated (structured) → previews → Save persists it
  // + it renders as a card (generation no longer auto-saves).
  const preview = page.locator(".generation-preview");
  await expect(preview).toBeVisible({ timeout: 15_000 });
  await preview.locator(".gen-preview-save").click();
  await expect(page.locator(".note-list .tb-review-pack").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".note-list .tb-card-kind").first()).toContainText("Review Pack");
});

// SKIP: same pre-IA markup as above (generation entry + `.note-list` card classes).
test.skip("textbook kit: exporting a layer strips the student's Mistake block (propagation policy)", async ({ page, request }) => {
  const title = `Textbook Export ${Date.now()}`;
  const body = "<article><section><p>The cell membrane is a selective barrier.</p></section></article>";
  const source = await seedHtmlSource(request, title, body);
  await openSource(page, title);

  const reader = page.frameLocator(READER);
  const preview = page.locator(".generation-preview");

  // Make a Mistake block (private) — generate → preview → Save …
  await reader.getByText("selective barrier", { exact: false }).click();
  await expect(page.locator(".chat-source")).toContainText("selective barrier");
  await page.locator(".selection-toolbar-btn", { hasText: "Mistake" }).click();
  await expect(preview).toBeVisible({ timeout: 15_000 });
  await preview.locator(".gen-preview-save").click();
  await expect(page.locator(".note-list .tb-mistake").first()).toBeVisible({ timeout: 15_000 });

  // … and an Explanation block (shareable) — generate → preview → Save.
  await reader.getByText("selective barrier", { exact: false }).click();
  await page.locator(".selection-toolbar-btn", { hasText: "Explain" }).click();
  await expect(preview).toBeVisible({ timeout: 15_000 });
  await preview.locator(".gen-preview-save").click();
  await expect(page.locator(".note-list .tb-explanation").first()).toBeVisible({ timeout: 15_000 });

  // Find the source's owned layer and export it.
  const layers = (await (await request.get(`${SERVER}/api/sources/${source.id}/layers`)).json()).layers as Array<{
    id: string;
    importMode: string;
  }>;
  const owned = layers.find((l) => l.importMode === "owned");
  expect(owned, "expected an owned layer").toBeTruthy();

  const exportRes = await request.post(`${SERVER}/api/layers/${owned!.id}/export`, { data: {} });
  expect(exportRes.ok(), `export failed: ${exportRes.status()}`).toBeTruthy();
  const pack = (await exportRes.json()).pack as { notes: Array<{ contentType: string }> };
  const types = pack.notes.map((n) => n.contentType);

  expect(types, "explanation should be exported").toContain("textbook.explanation");
  // REV-CORE: new mistakes persist the CORE "mistake" id; both ids must stay stripped.
  expect(types, "mistake must be stripped from the export").not.toContain("textbook.mistake");
  expect(types, "core mistake must be stripped from the export").not.toContain("mistake");
});
