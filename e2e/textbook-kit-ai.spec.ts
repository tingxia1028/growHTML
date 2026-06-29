import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// Textbook Learning Kit (Product Kit) phase 2 — the AI learning loop. Driving the real
// app in web mode (mock provider = deterministic): select a passage → the kit's
// selection toolbar (Explain / Practice / Mistake) appears → clicking an action runs
// the kit command, which generates STRUCTURED content (server-validated against the
// kit's NoteContentSpec) and saves it as a Study Block that renders as a kit card.
// Proves: structured generation + kit commands + selection-toolbar contribution, all
// register-only (no core changes).

const SERVER = "http://127.0.0.1:4177";
const READER = 'iframe[title="Source reader"]';

async function seedHtmlSource(request: APIRequestContext, title: string, body: string) {
  const res = await request.post(`${SERVER}/api/sources/html`, { data: { title, content: body } });
  expect(res.ok(), `seed source failed: ${res.status()}`).toBeTruthy();
  return (await res.json()).source as { id: string; title: string };
}

async function openSource(page: Page, title: string) {
  await page.goto("/");
  await page.locator(".source-item-open", { hasText: title }).click();
  await expect(page.locator(".reader-tab-title")).toHaveText(title);
}

test("textbook kit: select passage → Explain/Practice toolbar → generated Study Block cards", async ({ page, request }) => {
  const title = `Textbook AI ${Date.now()}`;
  const body = "<article><section><p>Photosynthesis converts light into chemical energy.</p></section></article>";
  await seedHtmlSource(request, title, body);
  await openSource(page, title);

  // Select the passage in the reader → fills the source chip (a focus draft).
  const reader = page.frameLocator(READER);
  await reader.getByText("Photosynthesis converts", { exact: false }).click();
  await expect(page.locator(".chat-source")).toContainText("Photosynthesis");

  // The kit's selection toolbar appears on the focused passage.
  const explain = page.locator(".selection-toolbar-btn", { hasText: "Explain" });
  await expect(explain).toBeVisible();

  // Explain → structured explanation generated → previews → Save persists it → it
  // renders as a kit card (generation no longer auto-saves; Save is the seam).
  const preview = page.locator(".generation-preview");
  await explain.click();
  await expect(preview).toBeVisible({ timeout: 15_000 });
  await preview.locator(".gen-preview-save").click();
  const explanationCard = page.locator(".note-list .record-card .tb-explanation");
  await expect(explanationCard.first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".note-list .tb-card-kind").first()).toContainText("Explanation");

  // Practice → an Exercise Study Block on the same passage (via the same preview Save).
  const practice = page.locator(".selection-toolbar-btn", { hasText: "Practice" });
  await expect(practice).toBeVisible();
  await practice.click();
  await expect(preview).toBeVisible({ timeout: 15_000 });
  await preview.locator(".gen-preview-save").click();
  await expect(page.locator(".note-list .tb-exercise").first()).toBeVisible({ timeout: 15_000 });
});
