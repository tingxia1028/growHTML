import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// Generation preview (generate → preview → edit → save). A kit AI action no longer
// auto-saves: it parks the generated draft in the GenerationPreview seam (a SEPARATE
// DOM subtree from `.note-list`). Driving the real app (web mode, mock provider =
// deterministic): select a passage → Explain → the preview appears with NOTHING in the
// note list yet → Edit the draft → Save persists it as a kit card → a fresh draft can
// be Regenerated (still pending, nothing new saved) and Discarded (preview gone, count
// unchanged). Proves nothing crosses into `.note-list` until Save.

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

test.skip("generation preview: Explain → preview (nothing saved) → edit + Save → Regenerate stays pending → Discard", async ({
  page,
  request
}) => {
  const title = `Gen Preview ${Date.now()}`;
  const body = "<article><section><p>Osmosis is the diffusion of water across a membrane.</p></section></article>";
  await seedHtmlSource(request, title, body);
  await openSource(page, title);

  const reader = page.frameLocator(READER);
  const preview = page.locator(".generation-preview");
  const savedCards = page.locator(".note-list .tb-explanation");

  // —— Explain → a draft is generated and parked in the preview, NOT saved ——
  await reader.getByText("Osmosis is the diffusion", { exact: false }).click();
  await expect(page.locator(".chat-source")).toContainText("Osmosis");
  await page.locator(".selection-toolbar-btn", { hasText: "Explain" }).click();

  await expect(preview).toBeVisible({ timeout: 15_000 });
  await expect(preview.locator(".generation-preview-type")).toHaveText("textbook.explanation");
  // Crucially: the preview is rendering, but no note has crossed into the list yet.
  await expect(savedCards).toHaveCount(0);

  // —— Edit the draft: toggle the editor and set a unique sentinel title ——
  const sentinel = `Sentinel ${Date.now()}`;
  await preview.locator(".gen-preview-edit").click(); // "Edit" → "Done editing"
  const titleInput = preview.locator(".tb-explanation-title");
  await expect(titleInput).toBeVisible();
  await titleInput.fill(sentinel);

  // —— Save → the edited draft persists and now appears in the note list ——
  await preview.locator(".gen-preview-save").click();
  await expect(savedCards).toHaveCount(1);
  await expect(savedCards.first()).toContainText(sentinel);
  // The preview seam clears once the draft is saved.
  await expect(preview).toHaveCount(0);

  // —— Explain again → a new draft previews; Regenerate keeps it pending ——
  await reader.getByText("Osmosis is the diffusion", { exact: false }).click();
  await page.locator(".selection-toolbar-btn", { hasText: "Explain" }).click();
  await expect(preview).toBeVisible({ timeout: 15_000 });

  await preview.locator(".gen-preview-regenerate").click();
  // Still previewing (mock is deterministic — do NOT assert the content changed) and no
  // NEW note has been saved: the count is unchanged from the single saved card.
  await expect(preview).toBeVisible();
  await expect(savedCards).toHaveCount(1);

  // —— Discard → the preview disappears and the saved count is unchanged ——
  await preview.locator(".gen-preview-discard").click();
  await expect(preview).toHaveCount(0);
  await expect(savedCards).toHaveCount(1);
});
