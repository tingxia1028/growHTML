import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { openReaderMenu } from "./helpers";

// Per-source Product Kit activation. The Textbook kit is the workspace default, so a
// fresh source starts with it active (selection toolbar + its note types). Switching
// the reader-header Kit dropdown to "Core" gates the CREATION entry-points off — the
// toolbar disappears and the composer type picker drops the kit's types — but a
// previously created Study Block STILL renders (rendering is never gated). Switching
// back restores the toolbar. Proves activation gates creation only, per-source.

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

async function selectPassage(page: Page) {
  // Exact match: once a Study Block exists, its note card (JSON) also contains the
  // phrase, so a loose match would hit two nodes. The passage <p>'s text is exactly
  // this sentence; the card's is the JSON, so exact:true uniquely selects the passage.
  await page
    .frameLocator(READER)
    .getByText("Photosynthesis converts light into chemical energy.", { exact: true })
    .click();
  await expect(page.locator(".chat-source")).toContainText("Photosynthesis");
}

test.skip("per-source kit activation: default on → switch to Core gates creation (render stays) → back on", async ({
  page,
  request
}) => {
  const title = `Kit Activation ${Date.now()}`;
  const body = "<article><section><p>Photosynthesis converts light into chemical energy.</p></section></article>";
  await seedHtmlSource(request, title, body);
  await openSource(page, title);

  const explain = page.locator(".selection-toolbar-btn", { hasText: "Explain" });
  const kitSelect = page.locator(".kit-select");
  const typeSelect = page.locator(".composer-type-picker select.note-type-select");
  // The type picker now shows a "detected · change" chip by default (adaptive note
  // forms Phase 1b); reveal the override <select> so its options can be inspected.
  const revealTypeSelect = async () => {
    if (!(await typeSelect.isVisible())) {
      await page.locator(".composer-detected-change").click();
    }
  };

  // —— Default: the Textbook kit is the workspace default, so it's active here ——
  // The Kit dropdown was relocated into the Reader chrome ⋯ menu by the IA rebuild.
  await openReaderMenu(page);
  await expect(kitSelect).toHaveValue("textbook-learning");
  await selectPassage(page);
  await expect(explain).toBeVisible();

  // Create a Study Block (mock provider → deterministic) so we can prove it keeps
  // rendering after the kit is switched off. Generation now previews first; Save is the
  // seam that persists it into the note list.
  await explain.click();
  const preview = page.locator(".generation-preview");
  await expect(preview).toBeVisible({ timeout: 15_000 });
  await preview.locator(".gen-preview-save").click();
  await expect(page.locator(".note-list .tb-explanation").first()).toBeVisible({ timeout: 15_000 });

  // The kit's note type is offered in the composer picker while the kit is active.
  await page.locator(".composer-mode .mode-tab", { hasText: "Note" }).click();
  await revealTypeSelect();
  await expect(typeSelect.locator('option[value="textbook.explanation"]')).toHaveCount(1);

  // —— Switch this document to Core: creation entry-points gate off ——
  await openReaderMenu(page);
  await kitSelect.selectOption("core");
  await expect(kitSelect).toHaveValue("core");

  // Toolbar gone (re-select to recompute focus → still no kit items).
  await selectPassage(page);
  await expect(explain).toHaveCount(0);

  // Composer picker no longer offers the kit's types…
  await page.locator(".composer-mode .mode-tab", { hasText: "Note" }).click();
  await revealTypeSelect();
  await expect(typeSelect.locator('option[value="textbook.explanation"]')).toHaveCount(0);

  // …but the already-created Study Block STILL renders (rendering is never gated).
  await expect(page.locator(".note-list .tb-explanation").first()).toBeVisible();

  // —— Switch back to Textbook: the toolbar returns (per-source override) ——
  await openReaderMenu(page);
  await kitSelect.selectOption("textbook-learning");
  await expect(kitSelect).toHaveValue("textbook-learning");
  await selectPassage(page);
  await expect(explain).toBeVisible();
});
